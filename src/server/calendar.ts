import { google } from 'googleapis'
import type { Exercise, ProgramDocument, Session, SyncState } from '../shared/types'
import { docHash } from './hash'

let cachedClient: ReturnType<typeof google.calendar> | null = null

export function getCalendarClient(): ReturnType<typeof google.calendar> {
  if (cachedClient) return cachedClient

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64

  if (!email || !keyB64) {
    throw new Error(
      'Missing Google service account credentials. ' +
      'Set GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64 in .env',
    )
  }

  const key = Buffer.from(keyB64, 'base64').toString('utf-8')

  const jwt = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })

  cachedClient = google.calendar({ version: 'v3', auth: jwt })
  return cachedClient
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return dt.toISOString().split('T')[0]
}

function exerciseLine(ex: Exercise): string {
  let line = `${ex.name} — ${ex.sets}×${ex.reps}`
  if (ex.intensity) line += ` @ ${ex.intensity}`
  if (ex.rest) line += ` · rest ${ex.rest}`
  if (ex.notes) line += ` (${ex.notes})`
  return line
}

function eventDescription(doc: ProgramDocument, session: Session): string {
  const lines = [
    doc.goal ?? doc.name,
    session.focus ? `Focus: ${session.focus}` : null,
    session.notes ? `Notes: ${session.notes}` : null,
    '',
    ...session.exercises.map(exerciseLine),
  ].filter((l): l is string => l !== null)
  return lines.join('\n')
}

async function insertEvents(
  client: ReturnType<typeof google.calendar>,
  calendarId: string,
  doc: ProgramDocument,
): Promise<SyncState['events']> {
  const events: SyncState['events'] = []
  for (const session of doc.sessions) {
    const created = await client.events.insert({
      calendarId,
      requestBody: {
        summary: `🏋️ ${session.title}`,
        description: eventDescription(doc, session),
        start: { date: session.date },
        end: { date: addDays(session.date, 1) },
      },
    })
    events.push({ date: session.date, eventId: created.data.id!, link: created.data.htmlLink ?? '' })
  }
  return events
}

async function createCalendarAndShare(
  client: ReturnType<typeof google.calendar>,
  doc: ProgramDocument,
  email: string,
): Promise<{ calendarId: string; addLink: string }> {
  const cal = await client.calendars.insert({
    requestBody: {
      summary: doc.name,
      description: `${doc.name} — ${doc.weeks} weeks from ${doc.startDate}`,
    },
  })
  const calendarId = cal.data.id!
  await client.acl.insert({
    calendarId,
    requestBody: { role: 'reader', scope: { type: 'user', value: email } },
  })
  return { calendarId, addLink: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(calendarId)}` }
}

export async function syncProgram(doc: ProgramDocument, clientEmail: string): Promise<SyncState> {
  const client = getCalendarClient()
  const { calendarId, addLink } = await createCalendarAndShare(client, doc, clientEmail)
  const events = await insertEvents(client, calendarId, doc)
  return {
    syncedHash: docHash(doc),
    syncedAt: new Date().toISOString(),
    calendarId,
    sharedWithEmail: clientEmail,
    addLink,
    events,
  }
}

export async function resyncProgram(
  doc: ProgramDocument,
  clientEmail: string,
  prev: SyncState | null,
): Promise<SyncState> {
  const client = getCalendarClient()

  let calendarId = prev?.calendarId
  let sharedWithEmail = prev?.sharedWithEmail

  if (calendarId) {
    try {
      await client.events.list({ calendarId, maxResults: 1 })
    } catch {
      calendarId = undefined
    }
  }

  if (!calendarId) {
    const created = await createCalendarAndShare(client, doc, clientEmail)
    calendarId = created.calendarId
    sharedWithEmail = clientEmail
  } else if (sharedWithEmail && sharedWithEmail !== clientEmail) {
    try {
      await client.acl.delete({ calendarId, ruleId: `user:${sharedWithEmail}` })
    } catch {
      // old share rule may already be gone
    }
    await client.acl.insert({
      calendarId,
      requestBody: { role: 'reader', scope: { type: 'user', value: clientEmail } },
    })
    sharedWithEmail = clientEmail
  }

  let pageToken: string | undefined
  do {
    const listRes = await client.events.list({
      calendarId,
      maxResults: 250,
      singleEvents: true,
      pageToken,
    })
    for (const ev of listRes.data.items ?? []) {
      try {
        await client.events.delete({ calendarId, eventId: ev.id! })
      } catch {
        // event may already be gone
      }
    }
    pageToken = listRes.data.nextPageToken ?? undefined
  } while (pageToken)

  const events = await insertEvents(client, calendarId, doc)
  return {
    syncedHash: docHash(doc),
    syncedAt: new Date().toISOString(),
    calendarId,
    sharedWithEmail: sharedWithEmail ?? clientEmail,
    addLink: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(calendarId)}`,
    events,
  }
}

export async function deleteCalendar(calendarId: string): Promise<void> {
  try {
    const client = getCalendarClient()
    await client.calendars.delete({ calendarId })
  } catch {
    // calendar already gone
  }
}
