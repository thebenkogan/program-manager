// Verifier for manage-deload-10pct: 10% deload (*0.9, nearest 2.5 lb) on
// squat + bench only; deadlift untouched.
import {
  arrNumEq,
  findExerciseByName,
  getArgs,
  intensitiesOf,
  isMultipleOf2_5,
  loadProgram,
  mkCheck,
  report,
  standardChecks,
  type Check,
} from "../../lib/verify-helpers.ts";

const PROGRAM_ID = "frank-deload";
const EXPECTED_DATES = ["2026-09-14", "2026-09-16", "2026-09-19"];
// 200*0.9=180, 205*0.9=184.5->185, 203*0.9=182.7->182.5
const EXPECTED_SQUAT = [180, 185, 182.5];
// 150*0.9=135, 147*0.9=132.3->132.5, 152*0.9=136.8->137.5
const EXPECTED_BENCH = [135, 132.5, 137.5];

const { root, baselineSha } = getArgs();
const checks: Check[] = [];
const { found, file, doc } = loadProgram(root, PROGRAM_ID);
checks.push(mkCheck("program file exists", found, true, found));

if (file && doc) {
  checks.push(mkCheck("file id", file.id === PROGRAM_ID, PROGRAM_ID, file.id));
  checks.push(mkCheck("still 3 sessions", doc.sessions.length === 3, 3, doc.sessions.length));
  const dates = doc.sessions.map((s) => s.date);
  checks.push(mkCheck("dates unchanged", JSON.stringify(dates) === JSON.stringify(EXPECTED_DATES), EXPECTED_DATES, dates));

  const squat = intensitiesOf(doc, "High Bar Back Squat");
  checks.push(mkCheck("squat [180,185,182.5]", arrNumEq(squat, EXPECTED_SQUAT), EXPECTED_SQUAT, squat));
  const bench = intensitiesOf(doc, "Bench Press");
  checks.push(mkCheck("bench [135,132.5,137.5]", arrNumEq(bench, EXPECTED_BENCH), EXPECTED_BENCH, bench));

  // Deadlift: still Wed-only at 300.
  const deads = doc.sessions.map((s) => findExerciseByName(s, "Deadlift")?.intensity ?? null);
  checks.push(
    mkCheck("deadlift unchanged Wed-only 300", deads[0] === null && deads[1] === "300 lb" && deads[2] === null, [null, "300 lb", null], deads),
  );

  // Every programmed weight is a multiple of 2.5 lb.
  const allW = [...squat, ...bench].filter((v): v is number => v !== null);
  checks.push(
    mkCheck("all weights % 2.5 == 0", allW.length === 6 && allW.every(isMultipleOf2_5), "6 values, all n/2.5 integer", allW),
  );

  const notes = doc.notes ?? "";
  const notesOk = /10%/.test(notes) && /deload/i.test(notes) && /squat/i.test(notes) && /bench/i.test(notes);
  checks.push(mkCheck("notes contain 10% deload", notesOk, "10%, deload, squat, bench", notes.slice(0, 250)));
} else {
  checks.push(mkCheck("program doc present", false));
}

checks.push(...standardChecks(root, PROGRAM_ID, baselineSha));
report(checks.every((c) => c.pass), checks);
