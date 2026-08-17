import { google } from 'googleapis'
import type { Exercise, ProgramDocument, Session, SyncState } from '../shared/types.ts'
import { docHash } from './hash.ts'

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
  if (ex.notes) line += ` (${ex.notes})`
  return line
}

function eventDescription(doc: ProgramDocument, session: Session): string {
  const lines = [
    doc.goal ?? doc.name,
    session.focus ? `Focus: ${session.focus}` : null,
    session.notes ? `Notes: ${session.notes}` : null,
    '',
    ...session.exercises.flatMap((ex) => {
      const rows = [exerciseLine(ex)]
      if (ex.coachNote) rows.push(`  🎯 ${ex.coachNote}`)
      return rows
    }),
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

async function createCalendar(client: ReturnType<typeof google.calendar>, doc: ProgramDocument) {
  const cal = await client.calendars.insert({
    requestBody: {
      summary: doc.name,
      description: `${doc.name} — ${doc.weeks} weeks from ${doc.startDate}`,
    },
  })
  const calendarId = cal.data.id!
  return { calendarId, addLink: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(calendarId)}` }
}

async function makePublic(client: ReturnType<typeof google.calendar>, calendarId: string) {
  const { data } = await client.acl.list({ calendarId })
  const hasPublic = (data.items ?? []).some((rule) => rule.scope?.type === 'default')
  if (!hasPublic) {
    await client.acl.insert({
      calendarId,
      requestBody: { role: 'reader', scope: { type: 'default' } },
    })
  }
}

export async function syncProgram(doc: ProgramDocument): Promise<SyncState> {
  const client = getCalendarClient()
  const { calendarId, addLink } = await createCalendar(client, doc)
  await makePublic(client, calendarId)
  const events = await insertEvents(client, calendarId, doc)
  return {
    syncedHash: docHash(doc),
    syncedAt: new Date().toISOString(),
    calendarId,
    addLink,
    events,
  }
}

export async function resyncProgram(doc: ProgramDocument, prev: SyncState | null): Promise<SyncState> {
  const client = getCalendarClient()

  let calendarId = prev?.calendarId

  if (calendarId) {
    try {
      await client.events.list({ calendarId, maxResults: 1 })
    } catch {
      calendarId = undefined
    }
  }

  if (!calendarId) {
    const created = await createCalendar(client, doc)
    calendarId = created.calendarId
  }

  await makePublic(client, calendarId)

  await client.calendars.patch({
    calendarId,
    requestBody: {
      summary: doc.name,
      description: `${doc.name} — ${doc.weeks} weeks from ${doc.startDate}`,
    },
  })

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
