---
name: program-manager
description: Create and manage client training programs in data/programs, handling progression math, session scheduling, validation, and the pending-diff review workflow
---

# Program Manager

You are the API for a local training-coach app. When the user asks for a program change, you edit JSON files under `data/` directly. The app reads those files and shows your edit as a reviewable diff.

## When to use

- Creating a new client training program, or updating one (lifts, weights, schedule, progression rules).
- Fixing validation errors or date/weekday mistakes in a program file.

## Data layout

- `data/clients.json` — clients (each has `id`, `name`).
- `data/programs/{id}.json` — one file per client, shape `{ id, clientId, doc }`.
- `data/state/pending/{id}.json` — gitignored Apply-box default message,
  shape `{ "message": "..." }`.
- `data/state/sync/{id}.json` — gitignored Google Calendar sync state.

Each client has exactly one program. Replacing the file replaces the
program; old versions live in git history.

`data/` is its own git repo (the parent repo ignores it, so client info is
never pushed). The pending diff, Apply, and Versions history all read that
nested repo — the workflow below is unchanged, just scoped to `data/`.

## Program schema summary

Full source of truth: `src/shared/program.schema.json`. No extra
properties are allowed beyond what the schema defines.

`doc`:

- `version`: always `1`. `name`: string. `goal?`: string.
- `startDate`: `YYYY-MM-DD`, the FIRST session's date.
- `weeks`: positive integer. `notes?`: must document progression rules.
- `sessions`: array of Session.

Session:

- `date`: `YYYY-MM-DD`. `title`: includes weekday, e.g. `"Sat · Squat + Press + Clean"`.
- `week`: integer in `1..weeks`. `focus?`: e.g. `"Light squat day"`.
- `notes?`: string. `exercises`: array of Exercise.

Exercise:

- `name`: string.
- `sets`: positive integer.
- `reps`: string, e.g. `"4"` or `"10"`.
- `intensity?`: string, e.g. `"205 lb"`.
- `supersetWith?`: string.
- `notes?`: keep empty unless the user says otherwise.
- `coachNote?`: coaching cue, shown under the exercise in calendar events.

## Creating a program

1. Look up the client in `data/clients.json` by `id` or `name`.
2. If the client does not exist, ask the user for the client name, add it
   to `data/clients.json`, then create the program file.
3. Pick the program `id` (matches the filename `data/programs/{id}.json`)
   and set `clientId` to the client's `id`.
4. Set `doc.startDate` to the FIRST session's date, not the creation date.
5. Set `doc.weeks` to a positive integer; every session's `week` must be
   in `1..weeks`.
6. Build every session with concrete dates, weekday titles, and concrete
   intensities (see math rules below).
7. Follow the Workflow section to validate and write the pending message.

## Updating a program

1. Pin down the plan before editing. You need: weekly cadence (which weekdays),
   which exercises on which days, progression rules, starting weights, alternation patterns.
2. Ask for anything you cannot infer from the existing file or request.
   Do not guess starting weights or increments.
3. Apply the rules literally, including the math (see below).
4. Document the rule in `doc.notes`; keep notes consistent with sessions.
   Update session titles when the exercise set changes.
5. Keep exercise `notes` empty unless the user says otherwise. Reuse the
   existing exercise names when editing; when creating, prefer the names
   already used in `data/programs` (e.g. `High Bar Back Squat`).
6. Verify weekdays, validate, write the pending message, then STOP.

## Math rules

- Weights round to the nearest 2.5 lb.
- Intensities are strings like `"205 lb"` (number + space + `lb`).
- Apply rules literally:
  - `"10% lower than X"` means `X * 0.9`, then round to nearest 2.5 lb.
  - `"+5 lb each session"` means every occurrence goes up 5 lb, even if
    sessions are sparse. Never hold weights steady unless told.
- Every progression rule used in sessions must be documented in
  `doc.notes` so the client sees why the numbers are what they are.

## Progression patterns

Document the matching rule in `doc.notes` whenever you use one.

- **Linear:** start weight + increment x session number.
  Example: `Squat 3x5, +5 lb each session.`
- **Threshold:** increment shrinks once a weight is reached.
  Example: `Press 3x5, +5 lb up to 135, then +2.5.`
- **Shared:** two alternating lifts share one counter; advance it once
  per appearance in A, B, A, B order.
  Example: `Clean / clean & jerk share one counter from 150, +5 lb per appearance.`
- **Formula-derived:** compute from a reference lift and round per rule.
  Example: `Light squat at 80% of Monday's heavy squat, rounded to 5 lb marks.`
- **Deload/reset:** state the percentage and scope; sessions use the
  already-deloaded numbers.
  Example: `10% deload from vacation.`

## Alternation rule

Alternation means strictly alternating session-to-session: A, B, A, B, ...
across the relevant sessions. Never pin one movement to a fixed weekday
(e.g. X always Monday, Y always Wednesday) — that produces pairs, not
alternation. Progress each movement independently unless the rule says
they share a counter.

## Titles, notes, dates

- Session titles include the weekday: `"Sat · Squat + Press + Clean"`.
  Update the title whenever the exercise set changes.
- `doc.notes` must match the sessions: if you change a rule, update the
  notes in the same edit.
- `doc.notes` checklist: name EVERY programmed lift — one clause per rule
  (three rules → three clauses). Each clause gives the lift name
  (e.g. deadlift), scheme (setsxreps), and numbers (start weight,
  increment or %, rounding). Use the literal words "shared" for a shared
  counter and "alternate"/"alternating" for rotation; always include start
  weights when they apply.
- Verify dates land on the intended weekdays (use your actual dates):

```bash
pwd && bun -e 'for (const d of ["2026-08-03","2026-08-05","2026-08-08"]) console.log(d, new Date(d+"T00:00:00Z").toUTCString().slice(0,3))'
```

## Workflow: never commit program files yourself

1. Edit `data/programs/{id}.json`.
2. From the repo root, run validation:

```bash
pwd && bun run validate
```

3. Write the pending message to `data/state/pending/{id}.json` as
   `{ "message": "..." }` (gitignored Apply-box default text).
4. STOP. Leave the working tree dirty for user review.
5. Never run `git commit` or `git add` on program files. The uncommitted
   file is what the UI renders as a proposed change with a diff view;
   committing hides the Apply UI because the diff/Apply/Discard controls
   vanish when there is no pending change.

## Pending message style

The message becomes the git commit message and appears in the UI's
**Versions** list, so it must read as a meaningful changelog entry.

- One line, capitalized, no trailing period.
- Format: action + the lifts/dates affected + the relevant numbers.
- If you only changed program `notes`/`goal`, say so
  (e.g. `Update program notes`).
- Good:
  - `Alternate clean (155→175) and clean & jerk (140→155), +5 lb each session`
  - `Add clean & jerk on tricep days, +5 lb each session`
  - `Move squat to Mon/Wed/Sat, light Wed 2x4 at ~90%`
- Bad: `Adjust Ben's Starting Strength`, `Update program`, `Fix weights`.

## Calendar

Resync is blocked (400) while a pending diff exists — Apply first. Calendar sync is out of scope unless asked.
