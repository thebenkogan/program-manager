# Coach

Local app for managing your training clients' programs: view them, review AI-proposed edits as diffs, apply them as versions, and sync to Google Calendar.

**The AI (opencode) is the "API"** — you ask it to create/edit programs and it edits the files in `data/` directly. This app just reads those files and does calendar sync.

## Setup

```bash
bun install
cp .env.example .env   # then fill in your Google service account creds
git init && git add -A && git -c user.name=Coach -c user.email=coach@local commit -m "Init"
bun run dev            # open http://localhost:5173
```

## How it works

- `data/clients.json` — the people you train.
- `data/programs/{id}.json` — `{ id, clientId, doc }` where `doc` is a fully-resolved program schedule.
- `data/state/sync/{id}.json` (gitignored) — calendar sync state, including the hash of the last synced program.

**Each client has exactly one program.** A new program replaces the previous file — old versions stay in git history.

The coach repo is a git repo. **Every commit is a program version.**

### Program create/edit loop

1. Tell opencode what you want (e.g. "Andi: 4 weeks of 5/3/1, training max squat 315").
2. opencode writes the program file but **does not commit** → the UI shows it as a *proposed change*.
3. In the UI: review the diff, click **Apply** (creates a version, deletes the diff) or **Discard**.
4. Click **Sync to Google Calendar** → creates a calendar with all-day workout events and gives you a **share link**. Open it (or copy it) to add the calendar yourself or pass it to the client — anyone with the link can add it.
5. Later edits to the doc bump the hash → the UI offers **Resync**, which updates the events in place.

### Sync status

- **Not synced** — no calendar yet → Sync button.
- **Synced** — `syncedHash` matches the current doc → up to date, share link available.
- **Changed** — the doc changed since the last sync → Resync to update the calendar.

## Conventions

- opencode edits program files **without committing** so you can review the diff first.
- Run `bun run validate` after generating/editing programs.
- Deleting a program from the UI removes the file, its git history entry, and its Google Calendar.

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | start the app |
| `bun run validate` | validate all program files in `data/programs/` |
