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
- `data/programs/{programId}.json` — one file per client, shape
  `{ id, clientId, doc }`.
- `data/state/pending/{programId}.json` — gitignored Apply-box default
  message, shape `{ "message": "..." }`.
- `data/state/sync/{programId}.json` — gitignored calendar sync state.

Use the program file's `id` (the filename stem) for pending/sync paths, not
the client's `clientId`. For example, Tanya's program is
`tanya-starting-strength`, even though her client id is `tanya`. The headless
sync script looks up the pending message by program id.

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
- `backoff?`: back-off work after the top sets, written display-ready as
  `"<sets>x<reps> @ <weight> lb"`, e.g. `"2x5 @ 125 lb"`. It renders as its own
  line under the top set. Top set + back-off is ONE exercise — never split them
  into two exercises. Only use separate exercises for genuinely different movements.
- `supersetWith?`: string.
- `notes?`: keep empty unless the user says otherwise.
- `coachNote?`: coaching cue, shown under the exercise in calendar events.
- Optional missed-workout exceptions: `progressionGroup` links different
  exercise names that share one progression counter, or separates same-name
  lifts with independent counters. `intensityFormula` records a derived load.
  Ordinary lifts need no extra metadata; the scripts match them by exercise name.

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
6. Add optional `progressionGroup` tags only for shared counters or same-name lifts with separate counters. Add `intensityFormula` only for derived loads (e.g. light squat from heavy squat). Ordinary same-name progressions require no extra metadata.
7. Verify weekdays, validate, write the pending message, then STOP.

## Math rules

- Weights round to the nearest 2.5 lb — including back-off weights.
- Intensities are strings like `"205 lb"` (number + space + `lb`).
- Back-off progressions behave like the top lift unless told otherwise
  (same increment, same rounding); document the back-off rule in `doc.notes`.
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

## Missed workout commands

Use separate deterministic commands; both write a proposed program + pending
message only. They never commit or sync the calendar:

```bash
bun run skip-workout <programId> <YYYY-MM-DD> [--dry-run]
bun run defer-workout <programId> <YYYY-MM-DD> [--dry-run]
```

- `skip-workout`: removes that dated session and shifts the concrete
  `sets`/`reps`/`intensity`/`backoff` values forward through later occurrences
  of the same exercise name. `progressionGroup` is optional and only needed
  when differently named lifts share a counter (e.g. clean and clean & jerk) or
  same-name lifts need separate counters.
- `defer-workout`: moves the target workout to the next scheduled date and
  shifts later sessions into the next existing dates, preserving gaps. It
  infers the recurring weekdays from the program's dated sessions to append one
  final slot. Update weekday titles, start date/weeks, and formula-derived loads.
- `intensityFormula` is optional and only for derived loads. It names exactly
  one source (`sourceExercise` or `sourceProgressionGroup`), a `sourceScope`
  (`sameWeek` or `previous`), `factor`, and `roundToLb`. Use it for cases such
  as light squat loads derived from heavy squat.
- When shared counters or derived loads are in the human-readable notes, add
  the corresponding optional metadata so scripts can handle those exceptions
  deterministically. Ordinary same-name progressions require no annotations.
  For a legacy program missing exception metadata, prepare and apply that small
  metadata-only update first; the command refuses dirty program files.
- Commands fail closed on malformed formulas, dirty program files, or an
  existing pending proposal. `--dry-run` prints the proposal without writing.

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

## Workflow: edit, then stop for review

1. Edit `data/programs/{id}.json`.
2. From the repo root, run validation:

```bash
pwd && bun run validate
```

3. Write the pending message to
   `data/state/pending/{programId}.json` (where `programId` is the program
   file's `id`, not `clientId`) as `{ "message": "..." }`.
4. STOP. Leave the working tree dirty for user review.
5. Never run `git commit` or `git add` on program files on your own
   initiative. The uncommitted file is what the UI renders as a proposed
   change with a diff view; committing hides the Apply UI because the
   diff/Apply/Discard controls vanish when there is no pending change.

### Headless mode (Ben's explicit approval)

When — and only when — Ben explicitly approves the change ("go ahead",
"apply it", "commit it"), the commit + calendar steps may be done without
the UI, via:

```bash
cd /home/benkogan/code/coach
bun run scripts/sync-program.ts <programId> --dry-run   # inspect diff + pending message
bun run scripts/sync-program.ts <programId>             # commit + resync calendar
```

The script validates, commits the program file using the pending message
as the commit message (so Versions history stays meaningful), then calls
`resyncProgram()` and writes `data/state/sync/{programId}.json`. It mirrors the
UI's Apply + Resync. Commit must precede resync — the API rejects a
resync while a pending diff exists.

Always show Ben the diff (dry run) and get explicit approval before the
non-dry run.

Check the dry-run `message:` line before applying: it must be the intended
changelog text. If it says the generic `Update program <name>`, the pending
file was not found under the program id; fix the filename and rerun the dry
run. After syncing, verify the affected Google Calendar events by fetching
their event IDs from `data/state/sync/{programId}.json` and checking the
exercise lines and weights in each event description.

### Card renderer — the default way to show Ben a change

Ben does not use the UI and prefers PICTURES. On every program change, render
and send a card; never fall back to a text diff unless he asks.

```bash
cd /home/benkogan/code/coach
uv run --with Pillow python scripts/render_card.py <programId>         # program card only
uv run --with Pillow python scripts/render_card.py <programId> --diff  # optional separate diff image
```

Output is `.cache/<programId>.png` — send it as a `MEDIA:` path, but ONLY if
the run printed `self-check: OK`. The renderer self-checks for text overflow,
clipped boxes, oversized content and ragged week rows, and writes no png if
anything fails. Ben has authorised skipping a separate visual check; rely on
the self-check. Re-run `bun run render:test` after touching the renderer. The layout (portrait week-rows,
that week's sessions side by side, tinted lift strips, backoff as a nested
sub-strip) is Ben's chosen format. Do not redesign it unasked, and do not
fall back to landscape week-columns.

Delete the rendered PNG after the reply carrying it has been sent:

```bash
cd /home/benkogan/code/coach && rm -f .cache/*.png && rmdir .cache 2>/dev/null; true
```

Ben asked not to accumulate images. Do this on a LATER turn than the one that
sends the card — deleting too early leaves nothing to attach.

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
