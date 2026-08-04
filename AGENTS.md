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
  notes?: string,           // optional free-text per-set note
  coachNote?: string        // optional coaching cue, shown under the exercise in Google Calendar events
}
```

## CRITICAL workflow: never commit program files yourself

1. Edit `data/programs/{id}.json` and run `bun run validate`.
2. Write an AI-generated commit message describing the change to `data/state/pending/{id}.json` as `{ "message": "..." }`. This is gitignored, so it won't appear in the diff — it's just the Apply box's default text.
3. **Do NOT `git commit` program files.** The uncommitted file is what the UI renders as a *proposed change* with a diff view. The user reviews it there and clicks **Apply** (which creates the git commit = a program version, using your message) or **Discard**.
4. Do not add program files to the git index either. Leave the working tree dirty.
5. If you touch `src/` code, that *is* committed, but only when the user asks — and the commit identity is `git -c user.name=Coach -c user.email=coach@local commit`.

Consequences of getting this wrong: committing a program file makes the UI think there's no pending change, so the diff/Apply/Discard controls vanish and the user can't review your work.

### Naming the proposed diff

The pending message becomes the git commit message and is shown in the UI's **Versions** list, so it must read as a meaningful changelog entry, not a boilerplate "Adjust X program".

- Describe **what changed in the training plan**, with the lifts and weight ranges. The user should be able to tell what a version did just from its name.
- Style: action + the lifts/dates affected + the relevant numbers. Concise (one line), capitalized, no trailing period.
- Good examples:
  - `Alternate clean (155→175) and clean & jerk (140→155), +5 lb each session`
  - `Add clean & jerk on tricep days, +5 lb each session`
  - `Move squat to Mon/Wed/Sat, light Wed 2x4 at ~90%`
- Bad: `Adjust Ben's Starting Strength`, `Update program`, `Fix weights`.
- If you only changed program `notes`/`goal`, say so (e.g. `Update program notes`).

## Updating a client's program — best practices

From past sessions, this is what makes a good update and avoids rework:

1. **Pin down the plan before editing.** You need: the weekly cadence (which weekdays), which exercises go on which days, progression rules (+N lb per session or per week), starting weights, and any alternation patterns (e.g. press/triceps every other session, clean/clean & jerk alternating). Ask for anything you can't infer from the existing file or the user's request.
2. **Apply the rules literally, including the math.** "10% lower than X" → `X * 0.9`, then round to the client's increment. "5 lb up for each" → every occurrence goes up 5 lb, even if sessions are sparse. Don't hold weights steady unless told.
3. **Alternation means strictly alternating session-to-session**, not "X on day A and Y on day B" (that produces pairs). If the user says two movements alternate, order them A, B, A, B, … across the relevant sessions and progress each independently.
4. **Weights round to the nearest 2.5 lb**, and intensities are strings like `"205 lb"`.
5. **Program `notes` should document the progression rules** (the app shows them to the client). If you change a rule, update the notes to match — keep notes and sessions consistent.
6. **Session titles include the weekday** (e.g. `"Sat · Squat + Press + Clean"`). Update titles when an exercise set changes (e.g. + `Clean & Jerk`).
7. **Verify dates land on the right weekdays** before finishing (see the check below), and run `bun run validate`.
8. **Write the pending message** (see above) whenever you touch a program file, so Apply has a good default.
9. Keep exercise `notes` empty unless the user says otherwise; omit `rest` entirely.

Verify dates land on the intended weekday before finishing:

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
