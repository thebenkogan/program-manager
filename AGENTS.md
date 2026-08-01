# AGENTS.md — Coach

Local training-coach app. You (the agent) are the "API": when the user asks for a program change, you edit the JSON files under `data/` directly. The React app just reads those files, shows proposed changes as diffs, and syncs to Google Calendar. **You do not run the program for the user — you edit its data files.**

## Commands

```bash
bun run dev           # dev server → http://localhost:5173 (server + client HMR)
bun run validate      # validate every data/programs/*.json against src/shared/program.schema.json
bunx tsc --noEmit     # typecheck all TypeScript
```

Always run `bun run validate` after touching any program file, and `bunx tsc --noEmit` after touching `src/`. Always run them from the repo root; verify cwd with `pwd &&` before commands (the shell sometimes inherits a stale cwd).

## Data layout

- `data/clients.json` — clients (each has `id`, `name`).
- `data/programs/{id}.json` — one file per client, shape `{ id, clientId, doc }`.
- `data/state/sync/{id}.json` — gitignored Google Calendar sync state.

**Each client has exactly one program.** Replacing the file replaces the program; old versions live in git history.

## Program schema (`doc`)

```ts
{
  version: 1,
  name: string,
  goal?: string,
  startDate: string,        // YYYY-MM-DD, the FIRST session's date
  weeks: number,            // positive integer
  notes?: string,           // free-text coaching notes
  sessions: Session[]
}
Session {
  date: string,             // YYYY-MM-DD
  title: string,            // e.g. "Sat · Squat + Press + Clean"
  week: number,             // integer in 1..weeks
  focus?: string,           // e.g. "Light squat day"
  notes?: string,
  exercises: Exercise[]
}
Exercise {
  name: string,
  sets: number,             // positive integer
  reps: string,             // string, e.g. "4" or "10"
  intensity?: string,       // e.g. "205 lb"
  rest?: string,            // NOT USED — omit entirely
  supersetWith?: string,
  notes?: string            // optional free-text per-set note
}
```

## CRITICAL workflow: never commit program files yourself

1. Edit `data/programs/{id}.json` and run `bun run validate`.
2. **Do NOT `git commit` program files.** The uncommitted file is what the UI renders as a *proposed change* with a diff view. The user reviews it there and clicks **Apply** (which creates the git commit = a program version) or **Discard**.
3. Do not add program files to the git index either. Leave the working tree dirty.
4. If you touch `src/` code, that *is* committed, but only when the user asks — and the commit identity is `git -c user.name=Coach -c user.email=coach@local commit`.

Consequences of getting this wrong: committing a program file makes the UI think there's no pending change, so the diff/Apply/Discard controls vanish and the user can't review your work.

## Working with a client's program

- Treat the existing program file as ground truth for that client's conventions (exercises, cadence, progression, intensity units/rounding). Never assume a client trains like another client.
- Ask the user for specifics you can't infer from the file or their request: starting weights, progression rules, how many sessions per week, etc.
- Program `notes` should describe the progression rules (write them out; the app shows them to the client).
- Session titles typically include the weekday (e.g. `"Mon · Squat + Press"`). Match the existing program's title style.
- When dates are involved, confirm they land on the intended weekday before finishing. Quick check:

```bash
pwd && bun -e 'for (const d of ["2026-08-03","2026-08-05","2026-08-08"]) console.log(d, new Date(d+"T00:00:00Z").toUTCString().slice(0,3))'
```

## Sync / calendar behavior (don't touch unless asked)

- **Sync** (first time) creates a Google Calendar named after `doc.name`, makes it public, inserts one all-day event per session, and returns a share link.
- **Resync** replaces the events on the existing calendar and renames the calendar to the current `doc.name`. It is blocked (400) while a pending diff exists — Apply first.
- The UI decides "changed vs synced" by comparing the doc hash to the synced hash, but only when there is no pending diff.
- Renaming a program only reaches the calendar after a resync; the calendar name is not a source of truth.

## Environment quirks

- Dev server currently runs on port 5173. After editing `src/server/*` (vite-plugin, calendar, git, store), the dev server must be restarted — client-side HMR won't reload server modules. Restart: `pkill -f "[v]ite"` then `setsid -f zsh -c 'cd /home/benkogan/code/coach && exec bun run dev' > /tmp/opencode/coach-dev.log 2>&1`.
- The repo root is `/home/benkogan/code/coach`. Prefix shell commands with `pwd &&` because a stale cwd can leak in.
- Server endpoints under `__`: `/__data`, `/__program/:id/diff`, `/__program/:id/apply`, `/__program/:id/discard`, `/__program/:id/history`, `/__sync/:id`, `/__resync/:id`.
- Google creds come from `.env` (`GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64`). Never log or commit these.
