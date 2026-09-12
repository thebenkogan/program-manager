// Shared deterministic helpers for eval task verifiers.
// Dependency-free: only node:fs / node:path / node:child_process.
// Each task's verify.ts imports these, runs its checks, and prints
// JSON { pass, checks: [...] } via report().
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export interface Check {
  name: string;
  pass: boolean;
  expected?: unknown;
  actual?: unknown;
}

export interface Args {
  root: string;
  baselineSha: string;
}

/** Parse `--root <dir> --baseline-sha <sha>` from verify.ts CLI args. */
export function getArgs(): Args {
  const argv = process.argv.slice(2);
  const at = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const root = at("--root");
  const baselineSha = at("--baseline-sha");
  if (!root || !baselineSha) {
    console.log(
      JSON.stringify({
        pass: false,
        checks: [
          {
            name: "args",
            pass: false,
            expected: "--root <dir> --baseline-sha <sha>",
            actual: argv.join(" "),
          },
        ],
      }),
    );
    process.exit(2);
  }
  return { root: root as string, baselineSha: baselineSha as string };
}

export function mkCheck(name: string, pass: boolean, expected?: unknown, actual?: unknown): Check {
  return { name, pass, expected, actual };
}

/** "205 lb" -> 205, "137.5 lb" -> 137.5, missing/garbage -> null. */
export function parseIntensity(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const m = /-?\d+(\.\d+)?/.exec(s);
  return m ? parseFloat(m[0]) : null;
}

export function numEq(a: number | null, b: number, eps = 1e-9): boolean {
  return a !== null && Math.abs(a - b) < eps;
}

export function arrEq(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function arrNumEq(a: (number | null)[], b: number[], eps = 1e-9): boolean {
  return a.length === b.length && a.every((v, i) => numEq(v, b[i], eps));
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-10-05" -> "Mon" (UTC, matches the skill's weekday check). */
export function weekdayOf(dateStr: string): string {
  return DAYS[new Date(dateStr + "T00:00:00Z").getUTCDay()];
}

/** Normalize pull-movement names: "Clean & Jerk"/"Clean and Jerk"/"C&J" -> "cj", "Clean" -> "clean". */
export function normalizePull(name: string): "cj" | "clean" | "other" {
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  if (n === "cj" || n.includes("jerk")) return "cj";
  if (n.includes("clean")) return "clean";
  return "other";
}

export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  intensity?: string;
  [k: string]: unknown;
}

export interface Session {
  date: string;
  title: string;
  week: number;
  exercises: Exercise[];
  [k: string]: unknown;
}

export interface ProgramDoc {
  name: string;
  startDate: string;
  weeks: number;
  notes?: string;
  sessions: Session[];
  [k: string]: unknown;
}

export interface LoadedProgram {
  found: boolean;
  file?: { id?: unknown; clientId?: unknown; doc?: ProgramDoc };
  doc?: ProgramDoc;
}

/** Read data/programs/{programId}.json from a workdir copy. Never throws. */
export function loadProgram(root: string, programId: string): LoadedProgram {
  const p = join(root, "data", "programs", `${programId}.json`);
  if (!existsSync(p)) return { found: false };
  try {
    const file = JSON.parse(readFileSync(p, "utf-8")) as LoadedProgram["file"];
    const doc = file?.doc;
    return { found: true, file, doc };
  } catch {
    return { found: true };
  }
}

export function findExercise(session: Session, match: (name: string) => boolean): Exercise | undefined {
  return session.exercises.find((e) => match(e.name));
}

export function findExerciseByName(session: Session, name: string): Exercise | undefined {
  const want = name.toLowerCase();
  return findExercise(session, (n) => n.toLowerCase() === want);
}

/**
 * Lift-family matching for create-tasks: informal prompts don't pin exact
 * exercise names ("squat" vs "Back Squat"), so match on required/forbidden
 * substrings instead. Still fully deterministic — no LLM judge.
 * e.g. family(s, ["press"], ["bench"]) matches "Overhead Press" but not
 * "Bench Press"; family(s, ["squat"]) matches "Squat" and "Back Squat".
 */
export function findExerciseFamily(session: Session, include: string[], exclude: string[] = []): Exercise | undefined {
  return findExercise(session, (n) => {
    const l = n.toLowerCase();
    return include.every((s) => l.includes(s)) && exclude.every((s) => !l.includes(s));
  });
}

/** Intensity numbers for the named exercise in each session, in order (null where missing). */
export function intensitiesOf(doc: ProgramDoc, name: string): (number | null)[] {
  return doc.sessions.map((s) => {
    const ex = findExerciseByName(s, name);
    return ex ? parseIntensity(ex.intensity) : null;
  });
}

/** True when n is a multiple of 2.5 (client weight increment). */
export function isMultipleOf2_5(n: number): boolean {
  return Math.abs(n / 2.5 - Math.round(n / 2.5)) < 1e-9;
}

function run(cmd: string, args: string[], cwd: string): { code: number; out: string } {
  try {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf-8", timeout: 120000 });
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    return { code: r.status ?? 1, out };
  } catch (e) {
    return { code: 1, out: String(e) };
  }
}

/** Run `bun run scripts/validate.ts` inside the workdir copy. */
export function runValidate(root: string): Check {
  const r = run("bun", ["run", "scripts/validate.ts"], root);
  return mkCheck("validate passes", r.code === 0, "exit 0", r.code === 0 ? "exit 0" : r.out.slice(-800));
}

/** Pending-file checks: exists, shape {message: string}, changelog style. */
export function checkPending(root: string, programId: string): Check[] {
  const p = join(root, "data", "state", "pending", `${programId}.json`);
  const exists = existsSync(p);
  const out: Check[] = [mkCheck("pending file exists", exists, p, exists ? p : "missing")];
  if (!exists) {
    out.push(mkCheck("pending shape {message:string}", false));
    out.push(mkCheck("pending message style", false));
    return out;
  }
  let msg: unknown;
  try {
    msg = (JSON.parse(readFileSync(p, "utf-8")) as { message?: unknown }).message;
  } catch {
    msg = undefined;
  }
  const shapeOk = typeof msg === "string";
  out.push(mkCheck("pending shape {message:string}", shapeOk, "{message: string}", typeof msg));
  if (!shapeOk) {
    out.push(mkCheck("pending message style", false));
    return out;
  }
  const m = msg as string;
  const reasons: string[] = [];
  if (!(m.length > 20)) reasons.push("len<=20");
  if (!/^[A-Z]/.test(m)) reasons.push("not capitalized");
  if (/\.\s*$/.test(m)) reasons.push("trailing period");
  if (!(/\d/.test(m) || /notes?/i.test(m))) reasons.push("no digit and not notes-only");
  out.push(
    mkCheck(
      "pending message style",
      reasons.length === 0,
      "len>20, ^[A-Z], no trailing period, digit or notes-only",
      reasons.length > 0 ? `${reasons.join("; ")} :: ${m}` : m,
    ),
  );
  return out;
}

/**
 * Checks every verifier must include: validate passes, pending file,
 * no commit (HEAD SHA unchanged), nothing staged.
 */
export function standardChecks(root: string, programId: string, baselineSha: string): Check[] {
  const out: Check[] = [runValidate(root), ...checkPending(root, programId)];
  // Client data lives in the nested data/ repo — check ITS head, not the parent's.
  const dataDir = join(root, "data");
  const sha = run("git", ["rev-parse", "HEAD"], dataDir);
  out.push(mkCheck("no commit (HEAD unchanged)", sha.out.trim() === baselineSha.trim(), baselineSha.trim(), sha.out.trim() || "git rev-parse failed"));
  const staged = run("git", ["diff", "--cached", "--name-only"], dataDir);
  out.push(mkCheck("nothing staged", staged.code === 0 && staged.out.trim() === "", "(empty)", staged.out.trim().slice(0, 300)));
  return out;
}

/** Print the final verdict JSON for the runner to parse. */
export function report(pass: boolean, checks: Check[]): void {
  console.log(JSON.stringify({ pass, checks }));
}
