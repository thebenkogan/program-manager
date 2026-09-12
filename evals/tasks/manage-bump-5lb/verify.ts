// Verifier for manage-bump-5lb: +5 lb on every squat, bench untouched.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  arrNumEq,
  getArgs,
  intensitiesOf,
  loadProgram,
  mkCheck,
  report,
  standardChecks,
  type Check,
} from "../../lib/verify-helpers.ts";

const PROGRAM_ID = "dave-squat-bench";
const EXPECTED_DATES = ["2026-09-14", "2026-09-16", "2026-09-19"];
const EXPECTED_SQUAT = [195, 200, 205];
const EXPECTED_BENCH = [140, 145, 150];

const { root, baselineSha } = getArgs();
const checks: Check[] = [];
const seed = JSON.parse(readFileSync(join(import.meta.dir, "fixture.json"), "utf-8")) as {
  program: { doc: { notes: string } };
};
const { found, file, doc } = loadProgram(root, PROGRAM_ID);
checks.push(mkCheck("program file exists", found, true, found));

if (file && doc) {
  checks.push(mkCheck("file id", file.id === PROGRAM_ID, PROGRAM_ID, file.id));
  checks.push(mkCheck("still 3 sessions", doc.sessions.length === 3, 3, doc.sessions.length));
  const dates = doc.sessions.map((s) => s.date);
  checks.push(mkCheck("dates unchanged", JSON.stringify(dates) === JSON.stringify(EXPECTED_DATES), EXPECTED_DATES, dates));

  const squat = intensitiesOf(doc, "High Bar Back Squat");
  checks.push(mkCheck("squat [195,200,205]", arrNumEq(squat, EXPECTED_SQUAT), EXPECTED_SQUAT, squat));
  const bench = intensitiesOf(doc, "Bench Press");
  checks.push(mkCheck("bench unchanged [140,145,150]", arrNumEq(bench, EXPECTED_BENCH), EXPECTED_BENCH, bench));

  // Each session still has exactly squat + bench, nothing added/removed.
  const shapeOk = doc.sessions.every(
    (s) =>
      s.exercises.length === 2 &&
      s.exercises[0].name === "High Bar Back Squat" &&
      s.exercises[1].name === "Bench Press",
  );
  checks.push(mkCheck("session shape unchanged", shapeOk, "squat + bench per session", shapeOk ? "ok" : doc.sessions.map((s) => s.exercises.map((e) => e.name))));

  // Notes must have been updated to reflect the new weights.
  const notes = doc.notes ?? "";
  checks.push(
    mkCheck("notes updated", notes !== seed.program.doc.notes && /195/.test(notes), `!= seed notes and mentions 195`, notes.slice(0, 200)),
  );
} else {
  checks.push(mkCheck("program doc present", false));
}

checks.push(...standardChecks(root, PROGRAM_ID, baselineSha));
report(checks.every((c) => c.pass), checks);
