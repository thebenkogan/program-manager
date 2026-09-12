# evals/ — program-manager skill harness (bun-only)

Minimal eval harness for testing the program-manager skill. No Harbor, no
Docker — just bun, temp-dir repo copies, and Harbor's task contract
(`prompt.md` + verify). Zero new npm packages; only bun + `node:fs`.

## Layout

```
evals/
  run.ts                 # runner (see below)
  summarize.ts           # results.jsonl -> pass-rate + median wall-time table
  lib/verify-helpers.ts  # shared verifier helpers (checks, git, validate, ...)
  tasks/<id>/
    task.json            # {id, description, difficulty, timeout_s, programId, clientId}
    prompt.md            # exact instruction fed to `opencode run`
    fixture.json         # starting state: {clients: [...], program: {...} | null}
    verify.ts            # deterministic checks; prints JSON {pass, checks:[...]}
  results/               # gitignored: results.jsonl + per-run agent logs
```

## How to run

```bash
bun evals/run.ts --list                    # show available tasks
bun evals/run.ts --task create-linear-2wk  # one task
bun evals/run.ts                            # all tasks (sequential)
bun evals/run.ts --task <id> --model <m> --timeout <s> --keep-tmp
bun evals/summarize.ts                      # pass-rate + median wall-time table
```

Runner flow per task: `cp -a` the repo to `$(mktemp -d)/eval-<id>` (plain
copy, not a git worktree, to keep it simple) → strip `.env` + `data/state/`
from the copy → seed `data/clients.json` and the fixture program →
record baseline `HEAD` SHA → run
`opencode run "$(cat prompt.md)" --dir <copy> --model <model> --auto`
with timeout → run
`bun <task>/verify.ts --root <copy> --baseline-sha <sha>` → append one
JSONL record to `evals/results/results.jsonl`:

```
{taskId, pass, checksPassed, checksTotal, wallClockMs, model, timestamp,
 timedOut, agentExitCode, failedChecks}
```

`--keep-tmp` preserves the temp workdir for debugging (path is printed).
Full agent stdout/stderr goes to `evals/results/<task>-<stamp>.log`.

## Model string notes (`opencode run`)

- List what's available: `opencode models`.
- Default model: `$EVAL_MODEL` if set, else
  `opencode/muse-spark-1.3-contributor-free` (present in `opencode models`
  at time of writing; other known strings include
  `opencode/muse-spark-1.2-contributor-free`).
- Override per run: `bun evals/run.ts --task <id> --model <provider/model>`
  or `EVAL_MODEL=<provider/model> bun evals/run.ts`.
- `--model` takes `provider/model` form (see `opencode run --help`).
- The runner passes `--auto` so file edits in the throwaway copy are
  approved without an interactive prompt; without it a headless run stalls.
  The copy is temp-dir isolated, so this is contained.

## Metrics explained

- `pass` — all verify checks passed (domain checks + standard checks).
- `checksPassed/checksTotal` — granularity: which checks failed is in
  `failedChecks`; see the task's `verify.ts` for check names.
- `wallClockMs` — `performance.now()` around the `opencode run` spawn only
  (copy/seed/verify time excluded). `summarize.ts` reports the **median**
  across runs per task, since agent latency is noisy.
- `timedOut` / `agentExitCode` — whether the per-task `timeout_s`
  (overridable with `--timeout <s>`) killed the run. A timed-out run still
  verifies whatever state the agent left behind.
- Standard checks (every task, via `standardChecks()` in
  `lib/verify-helpers.ts`): `bun run scripts/validate.ts` passes in the
  copy, pending file exists at `data/state/pending/{programId}.json` with
  shape `{message: string}` and changelog style (len > 20, `^[A-Z]`, no
  trailing period, contains a digit or is notes-only), `HEAD` SHA unchanged
  (no commit), `git diff --cached` empty (nothing staged).

## How to add a task

1. `mkdir evals/tasks/<task-id>` and add four files:
   - `task.json` — `{id, description, difficulty ("easy"|"medium"|"hard"),
     timeout_s, programId, clientId}`. `timeout_s` budgets the agent run
     (easy ~600, medium ~900, hard ~1200).
    - `prompt.md` — the exact instruction for `opencode run`. Tell the agent
      to follow the program-manager skill workflow, pin exact client/program ids, dates, exercise
     names, and weights-or-rules, and require `bun run validate` + pending
     file + no commit/stage. Reference `data/state/pending/{programId}.json`
     by the same `programId` as `task.json`.
   - `fixture.json` — `{clients: [...], program: {id, clientId, doc} | null}`.
     `program: null` = create task (runner deletes any
     `data/programs/{programId}.json` in the copy so the agent starts
     clean). Non-null = manage task (runner writes it as the seed the agent
     must edit). Fixture programs must themselves pass `bun run validate`
     (watch `weeks` vs session dates: `sessions[i].date` must be in
     `[startDate, startDate + weeks*7d)`).
   - `verify.ts` — `import { ... } from "../../lib/verify-helpers.ts"`,
     parse CLI with `getArgs()` (`--root <copy> --baseline-sha <sha>`),
     load with `loadProgram(root, programId)`, push domain `mkCheck(...)`s,
     append `standardChecks(root, programId, baselineSha)`, finish with
     `report(checks.every(c => c.pass), checks)` which prints the JSON the
     runner parses. Available helpers: `parseIntensity("205 lb"→205)`,
     `numEq/arrEq/arrNumEq`, `weekdayOf("2026-10-05"→"Mon")`,
     `normalizePull` (`"Clean & Jerk"`→`"cj"`, `"Clean"`→`"clean"`),
     `findExercise(ByName)`, `intensitiesOf`, `isMultipleOf2_5`,
     `runValidate`, `checkPending`.
2. Test the verifier logic without spending agent time: copy the repo to
   `/tmp`, seed your fixture + a hand-written expected program, and run
   `bun evals/tasks/<id>/verify.ts --root <copy> --baseline-sha $(git -C <copy> rev-parse HEAD)`.
3. Run it for real: `bun evals/run.ts --task <id>`.
4. Constraints: fixtures live only in `evals/tasks/` (never touch `data/`,
   `src/`, `.opencode/`); verifiers must stay deterministic
   (exact dates/weights, tolerance float compare); keep everything
   dependency-free.
