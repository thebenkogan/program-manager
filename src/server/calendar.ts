import { google } from 'googleapis'
import type { Exercise, ProgramDocument, Session, SyncState } from '../shared/types.ts'
import { docHash } from './hash.ts'
import { desiredEvents, planSync, type RemoteEvent } from './sync-plan.ts'

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
  const dt = new Date(`${dateStr}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + days)
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
      if (ex.backoff) rows.push(`  ${ex.backoff}`)
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

async function listEvents(
  client: ReturnType<typeof google.calendar>,
  calendarId: string,
): Promise<RemoteEvent[]> {
  const out: RemoteEvent[] = []
  let pageToken: string | undefined
  do {
    const res = await client.events.list({
      calendarId,
      maxResults: 250,
      singleEvents: true,
      showDeleted: false,
      pageToken,
    })
    for (const ev of res.data.items ?? []) {
      if (!ev.id) continue
      out.push({
        id: ev.id,
        summary: ev.summary,
        description: ev.description,
        startDate: ev.start?.date ?? null,
        endDate: ev.end?.date ?? null,
      })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

/**
 * Reconcile the program with the calendar instead of rebuilding it: events
 * are matched by session date and patched in place, so IDs (and any manual
 * notes, reminders or attachments on the event) survive a resync. Only dates
 * that disappeared from the program are deleted.
 */
export async function resyncProgram(
  doc: ProgramDocument,
  prev: SyncState | null,
  log: (msg: string) => void = () => {},
): Promise<SyncState> {
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

  const remote = await listEvents(client, calendarId)
  const desired = desiredEvents(
    doc,
    (title) => `🏋️ ${title}`,
    (session) => eventDescription(doc, session),
    (date) => addDays(date, 1),
  )
  const plan = planSync(desired, remote, prev?.events ?? [])
  log(
    `calendar: ${plan.updates.length} updated, ${plan.unchanged.length} unchanged, ` +
      `${plan.inserts.length} added, ${plan.deletes.length} removed`,
  )

  for (const ev of plan.deletes) {
    try {
      await client.events.delete({ calendarId, eventId: ev.id })
    } catch {
      // event may already be gone
    }
  }

  const refs = new Map<string, SyncState['events'][number]>()

  for (const { eventId, body } of plan.updates) {
    const patched = await client.events.patch({
      calendarId,
      eventId,
      requestBody: {
        summary: body.summary,
        description: body.description,
        start: { date: body.date },
        end: { date: body.endDate },
      },
    })
    refs.set(body.date, { date: body.date, eventId, link: patched.data.htmlLink ?? '' })
  }

  for (const { eventId, date } of plan.unchanged) {
    const link = prev?.events.find((e) => e.eventId === eventId)?.link ?? ''
    refs.set(date, { date, eventId, link })
  }

  for (const body of plan.inserts) {
    const created = await client.events.insert({
      calendarId,
      requestBody: {
        summary: body.summary,
        description: body.description,
        start: { date: body.date },
        end: { date: body.endDate },
      },
    })
    refs.set(body.date, { date: body.date, eventId: created.data.id!, link: created.data.htmlLink ?? '' })
  }

  return {
    syncedHash: docHash(doc),
    syncedAt: new Date().toISOString(),
    calendarId,
    addLink: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(calendarId)}`,
    events: doc.sessions.map((session) => refs.get(session.date)!),
  }
}

/** Full rebuild: wipe every event on the program calendar and re-insert. */
export async function rebuildProgram(doc: ProgramDocument, prev: SyncState | null): Promise<SyncState> {
  const client = getCalendarClient()
  const calendarId = prev?.calendarId
  if (calendarId) {
    for (const ev of await listEvents(client, calendarId)) {
      try {
        await client.events.delete({ calendarId, eventId: ev.id })
      } catch {
        // already gone
      }
    }
  }
  return resyncProgram(doc, prev)
}

export async function deleteCalendar(calendarId: string): Promise<void> {
  try {
    const client = getCalendarClient()
    await client.calendars.delete({ calendarId })
  } catch {
    // calendar already gone
  }
}
