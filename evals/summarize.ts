// evals/summarize.ts — read evals/results/results.jsonl, print per-task
// pass rate + median wall time.
//
// Usage: bun evals/summarize.ts [--results <path>]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Row {
  taskId: string;
  pass: boolean;
  checksPassed: number;
  checksTotal: number;
  wallClockMs: number;
  model: string;
  timestamp: string;
  timedOut?: boolean;
}

function resultsPath(): string {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--results");
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return join(import.meta.dir, "results", "results.jsonl");
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function main(): void {
  const path = resultsPath();
  if (!existsSync(path)) {
    console.log(`No results yet: ${path}`);
    return;
  }
  const rows = readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Row);

  const byTask = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, []);
    byTask.get(r.taskId)!.push(r);
  }

  const header = ["task", "runs", "passed", "pass rate", "median wall", "models"];
  const lines: string[][] = [header];
  let totalRuns = 0;
  let totalPassed = 0;
  for (const [taskId, rs] of [...byTask.entries()].sort()) {
    const passed = rs.filter((r) => r.pass).length;
    totalRuns += rs.length;
    totalPassed += passed;
    const models = [...new Set(rs.map((r) => r.model))].join(",");
    lines.push([
      taskId,
      String(rs.length),
      String(passed),
      `${Math.round((100 * passed) / rs.length)}%`,
      fmtMs(median(rs.map((r) => r.wallClockMs))),
      models,
    ]);
  }
  const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
  for (const l of lines) console.log(l.map((c, i) => c.padEnd(widths[i])).join("  "));
  console.log(`\nOverall: ${totalPassed}/${totalRuns} passed (${totalRuns ? Math.round((100 * totalPassed) / totalRuns) : 0}%).`);
}

main();
