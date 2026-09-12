#!/usr/bin/env bun
/**
 * evals/run.ts — minimal bun-only eval harness for the program-manager skill.
 *
 * Borrows Harbor's task contract (prompt.md + verify) without Harbor/Docker:
 * for each task dir in tasks/<id>/ it:
 *   1. copies the repo (cp -a, NOT git worktree) to a fresh temp dir,
 *   2. seeds data/clients.json + the fixture program into the copy,
 *   3. records baseline HEAD SHA,
 *   4. runs `opencode run` headless with a timeout, timing wall-clock,
 *   5. runs the task's verify.ts against the copy,
 *   6. appends a JSONL record to evals/results/results.jsonl.
 *
 * Usage:
 *   bun evals/run.ts --task <id> [--model <model>] [--timeout <s>] [--keep-tmp]
 *   bun evals/run.ts [--model <model>] [--timeout <s>]   # all tasks
 *   bun evals/run.ts --list
 *
 * Model default: $EVAL_MODEL, else opencode/muse-spark-1.3-contributor-free
 * (a model string from `opencode models`; override with --model).
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const EVALS_DIR = import.meta.dir;
const REPO_ROOT = resolve(EVALS_DIR, "..");
const TASKS_DIR = join(EVALS_DIR, "tasks");
const RESULTS_DIR = join(EVALS_DIR, "results");
const RESULTS_JSONL = join(RESULTS_DIR, "results.jsonl");
const DEFAULT_MODEL = process.env.EVAL_MODEL ?? "opencode/muse-spark-1.3-contributor-free";

interface TaskConfig {
  id: string;
  description: string;
  difficulty: string;
  timeout_s: number;
  programId: string;
  clientId: string;
}

interface Fixture {
  clients: unknown[];
  program: { id: string; clientId: string; doc: unknown } | null;
}

interface VerifyResult {
  pass: boolean;
  checks: { name: string; pass: boolean; expected?: unknown; actual?: unknown }[];
}

interface Cli {
  tasks: string[];
  model: string;
  timeout?: number;
  keepTmp: boolean;
  list: boolean;
  help: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = { tasks: [], model: DEFAULT_MODEL, keepTmp: false, list: false, help: false };
  const val = (flag: string): string | null => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
      if (argv[i].startsWith(flag + "=")) return argv[i].slice(flag.length + 1);
    }
    return null;
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--task" && i + 1 < argv.length) cli.tasks.push(argv[++i]);
    else if (argv[i].startsWith("--task=")) cli.tasks.push(argv[i].slice("--task=".length));
  }
  const model = val("--model");
  if (model) cli.model = model;
  const timeout = val("--timeout");
  if (timeout) cli.timeout = parseInt(timeout, 10);
  cli.keepTmp = argv.includes("--keep-tmp");
  cli.list = argv.includes("--list");
  cli.help = argv.includes("--help") || argv.includes("-h");
  return cli;
}

function streamText(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return Promise.resolve("");
  return new Response(stream).text();
}

async function spawnCapture(
  cmd: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    streamText(proc.stdout as ReadableStream<Uint8Array> | null),
    streamText(proc.stderr as ReadableStream<Uint8Array> | null),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Run the agent headless with a timeout. Returns exit code, timeout flag, wall time. */
async function runAgent(
  prompt: string,
  dir: string,
  model: string,
  timeoutS: number,
  logPath: string,
): Promise<{ code: number; timedOut: boolean; wallClockMs: number }> {
  const start = performance.now();
  const proc = Bun.spawn(["opencode", "run", prompt, "--dir", dir, "--model", model, "--auto"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const io = Promise.all([
    streamText(proc.stdout as ReadableStream<Uint8Array> | null),
    streamText(proc.stderr as ReadableStream<Uint8Array> | null),
    proc.exited,
  ]);
  let timedOut = false;
  let result: [string, string, number] | null = null;
  const winner = await Promise.race([io.then((r) => ({ done: true as const, r })), sleep(timeoutS * 1000).then(() => ({ done: false as const }))]);
  if (winner.done) {
    result = winner.r;
  } else {
    timedOut = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      /* already exited */
    }
    // Give it a grace period, then force-kill and collect output.
    const forced = await Promise.race([
      io.then((r) => ({ exited: true as const, r })),
      sleep(10000).then(() => ({ exited: false as const })),
    ]);
    if (forced.exited) {
      result = forced.r;
    } else {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* already exited */
      }
      result = await io;
    }
  }
  const wallClockMs = Math.round(performance.now() - start);
  const [stdout, stderr, code] = result;
  writeFileSync(
    logPath,
    `$ opencode run --dir ${dir} --model ${model} --auto\n[timedOut=${timedOut} exit=${code} wallClockMs=${wallClockMs}]\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`,
  );
  return { code, timedOut, wallClockMs };
}

/** Extract the verdict JSON from verify.ts stdout (tolerates extra log lines). */
function parseVerifyOut(stdout: string): VerifyResult {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`verify printed no JSON: ${stdout.slice(0, 300)}`);
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as VerifyResult;
  if (typeof parsed.pass !== "boolean" || !Array.isArray(parsed.checks)) {
    throw new Error(`verify JSON missing pass/checks: ${stdout.slice(0, 300)}`);
  }
  return parsed;
}

function discoverTasks(): string[] {
  return readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => existsSync(join(TASKS_DIR, n, "task.json")))
    .sort();
}

async function runTask(taskId: string, cli: Cli): Promise<{ taskId: string; pass: boolean }> {
  const taskDir = join(TASKS_DIR, taskId);
  const task = JSON.parse(readFileSync(join(taskDir, "task.json"), "utf-8")) as TaskConfig;
  const prompt = readFileSync(join(taskDir, "prompt.md"), "utf-8");
  const fixture = JSON.parse(readFileSync(join(taskDir, "fixture.json"), "utf-8")) as Fixture;
  const timeoutS = cli.timeout ?? task.timeout_s;

  // 1. Fresh temp copy of the repo (cp -a, not a worktree — keeps it simple).
  const tmp = mkdtempSync(join(tmpdir(), `eval-${taskId}-`));
  const work = join(tmp, `eval-${taskId}`);
  mkdirSync(work, { recursive: true });
  const cp = await spawnCapture(["cp", "-a", REPO_ROOT + "/.", work], "/");
  if (cp.code !== 0) throw new Error(`cp -a failed: ${cp.stderr.slice(0, 500)}`);
  // Isolate the copy: drop local-only state that must not leak into the eval
  // (.env creds, previous sync/pending state). data/state/ is gitignored so a
  // git worktree wouldn't carry it, but cp -a copies whatever is on disk.
  rmSync(join(work, ".env"), { force: true });
  rmSync(join(work, "data", "state"), { recursive: true, force: true });
  mkdirSync(join(work, "data", "state", "pending"), { recursive: true });

  try {
    // 2. Seed fixture: clients + program (or ensure target program is absent for create tasks).
    writeFileSync(join(work, "data", "clients.json"), JSON.stringify(fixture.clients, null, 2) + "\n");
    if (fixture.program) {
      writeFileSync(
        join(work, "data", "programs", `${fixture.program.id}.json`),
        JSON.stringify(fixture.program, null, 2) + "\n",
      );
    } else {
      rmSync(join(work, "data", "programs", `${task.programId}.json`), { force: true });
    }
    rmSync(join(work, "data", "state", "pending", `${task.programId}.json`), { force: true });

    // 3. Baseline SHA from the DATA repo (client data lives in its own nested
    // git repo under data/; the no-commit check compares against this).
    mkdirSync(join(work, "data", "programs"), { recursive: true });
    const dataDir = join(work, "data");
    let rev = await spawnCapture(["git", "rev-parse", "HEAD"], dataDir);
    if (rev.code !== 0) {
      // Fresh clone with no data history: init the nested repo around the seed.
      await spawnCapture(["git", "init"], dataDir);
      await spawnCapture(["git", "add", "clients.json", "programs"], dataDir);
      await spawnCapture(
        ["git", "-c", "user.name=Coach", "-c", "user.email=coach@local", "commit", "-m", "Seed eval data"],
        dataDir,
      );
      rev = await spawnCapture(["git", "rev-parse", "HEAD"], dataDir);
    }
    if (rev.code !== 0) throw new Error(`git rev-parse HEAD failed in data copy: ${rev.stderr.slice(0, 300)}`);
    const baselineSha = rev.stdout.trim();

    // 4. Headless agent run, timed. --auto approves file edits (workdir is a
    // throwaway copy, so this is contained); without it a headless run stalls.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(RESULTS_DIR, `${taskId}-${stamp}.log`);
    mkdirSync(RESULTS_DIR, { recursive: true });
    console.log(`[${taskId}] agent start (model=${cli.model} timeout=${timeoutS}s)`);
    const agent = await runAgent(prompt, work, cli.model, timeoutS, logPath);
    console.log(
      `[${taskId}] agent done exit=${agent.code} timedOut=${agent.timedOut} wallClockMs=${agent.wallClockMs} log=${logPath}`,
    );

    // 5. Verify against the copy.
    let verdict: VerifyResult;
    try {
      const v = await spawnCapture(
        ["bun", join(taskDir, "verify.ts"), "--root", work, "--baseline-sha", baselineSha],
        REPO_ROOT,
      );
      const combined = v.stdout + (v.code !== 0 && !v.stdout.trim() ? v.stderr : "");
      verdict = parseVerifyOut(combined);
    } catch (e) {
      verdict = {
        pass: false,
        checks: [{ name: "verify harness", pass: false, actual: String(e).slice(0, 500) }],
      };
    }
    const checksPassed = verdict.checks.filter((c) => c.pass).length;
    const failed = verdict.checks.filter((c) => !c.pass).map((c) => c.name);
    console.log(`[${taskId}] ${verdict.pass ? "PASS" : "FAIL"} ${checksPassed}/${verdict.checks.length}${failed.length ? ` failed: ${failed.join("; ")}` : ""}`);

    // 6. Append JSONL record.
    mkdirSync(RESULTS_DIR, { recursive: true });
    appendFileSync(
      RESULTS_JSONL,
      JSON.stringify({
        taskId,
        pass: verdict.pass,
        checksPassed,
        checksTotal: verdict.checks.length,
        wallClockMs: agent.wallClockMs,
        model: cli.model,
        timestamp: new Date().toISOString(),
        timedOut: agent.timedOut,
        agentExitCode: agent.code,
        failedChecks: failed,
      }) + "\n",
    );
    return { taskId, pass: verdict.pass };
  } finally {
    if (!cli.keepTmp) rmSync(tmp, { recursive: true, force: true });
    else console.log(`[${taskId}] kept tmp workdir: ${work}`);
  }
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  if (cli.help) {
    console.log(`Usage:
  bun evals/run.ts --task <id> [--model <model>] [--timeout <s>] [--keep-tmp]
  bun evals/run.ts [--model <model>] [--timeout <s>]   # all tasks
  bun evals/run.ts --list
Model default: $EVAL_MODEL, else ${DEFAULT_MODEL}`);
    return;
  }
  const available = discoverTasks();
  if (cli.list) {
    for (const id of available) {
      const t = JSON.parse(readFileSync(join(TASKS_DIR, id, "task.json"), "utf-8")) as TaskConfig;
      console.log(`${t.id}\t${t.difficulty}\t${t.description}`);
    }
    return;
  }
  const selected = cli.tasks.length > 0 ? cli.tasks : available;
  for (const id of selected) {
    if (!available.includes(id)) {
      console.error(`Unknown task: ${id} (available: ${available.join(", ")})`);
      process.exitCode = 1;
      continue;
    }
  }
  const results: { taskId: string; pass: boolean }[] = [];
  for (const id of selected.filter((t) => available.includes(t))) {
    try {
      results.push(await runTask(id, cli));
    } catch (e) {
      console.error(`[${id}] harness error: ${String(e).slice(0, 500)}`);
      mkdirSync(RESULTS_DIR, { recursive: true });
      appendFileSync(
        RESULTS_JSONL,
        JSON.stringify({
          taskId: id,
          pass: false,
          checksPassed: 0,
          checksTotal: 0,
          wallClockMs: 0,
          model: cli.model,
          timestamp: new Date().toISOString(),
          harnessError: String(e).slice(0, 500),
        }) + "\n",
      );
      results.push({ taskId: id, pass: false });
    }
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} tasks passed. Results: ${RESULTS_JSONL}`);
  if (passed !== results.length) process.exitCode = 1;
}

await main();
