// Verifier for create-threshold-press: threshold press + linear squat control.
import {
  findExerciseFamily,
  getArgs,
  loadProgram,
  mkCheck,
  report,
  standardChecks,
  weekdayOf,
  type Check,
} from "../../lib/verify-helpers.ts";

const PROGRAM_ID = "bob-press-focus";
const EXPECTED_DATES = ["2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15"];
const EXPECTED_WEEKS = [1, 1, 2, 2];
// Press: 125 +5 to 135, then +2.5. Squat control: 150 +5/session.
const EXPECTED_PRESS = ["125 lb", "130 lb", "135 lb", "137.5 lb"];
const EXPECTED_SQUAT = ["150 lb", "155 lb", "160 lb", "165 lb"];

const { root, baselineSha } = getArgs();
const checks: Check[] = [];
const { found, file, doc } = loadProgram(root, PROGRAM_ID);
checks.push(mkCheck("program file exists", found, true, found));

if (file && doc) {
  checks.push(mkCheck("file id", file.id === PROGRAM_ID, PROGRAM_ID, file.id));
  checks.push(mkCheck("file clientId", file.clientId === "bob", "bob", file.clientId));
  checks.push(mkCheck("weeks == 2", doc.weeks === 2, 2, doc.weeks));
  checks.push(mkCheck("startDate", doc.startDate === "2026-10-06", "2026-10-06", doc.startDate));
  checks.push(mkCheck("4 sessions", doc.sessions.length === 4, 4, doc.sessions.length));

  const dates = doc.sessions.map((s) => s.date);
  checks.push(mkCheck("session dates", JSON.stringify(dates) === JSON.stringify(EXPECTED_DATES), EXPECTED_DATES, dates));

  const weeks = doc.sessions.map((s) => s.week);
  checks.push(mkCheck("week numbers", JSON.stringify(weeks) === JSON.stringify(EXPECTED_WEEKS), EXPECTED_WEEKS, weeks));

  // Exact intensity strings — the threshold math must be precisely right.
  // Family matching: "press"/"ohp"/"overhead press" all count as the press
  // lift (excluding bench), "squat"/"back squat" as the squat lift.
  const press = doc.sessions.map((s) => findExerciseFamily(s, ["press"], ["bench"])?.intensity ?? null);
  checks.push(mkCheck("press exact [125,130,135,137.5]", JSON.stringify(press) === JSON.stringify(EXPECTED_PRESS), EXPECTED_PRESS, press));
  const squat = doc.sessions.map((s) => findExerciseFamily(s, ["squat"])?.intensity ?? null);
  checks.push(mkCheck("squat exact [150,155,160,165]", JSON.stringify(squat) === JSON.stringify(EXPECTED_SQUAT), EXPECTED_SQUAT, squat));

  const schemesOk = doc.sessions.every((s) => {
    const p = findExerciseFamily(s, ["press"], ["bench"]);
    const q = findExerciseFamily(s, ["squat"]);
    return p?.sets === 3 && p?.reps === "5" && q?.sets === 3 && q?.reps === "5";
  });
  checks.push(mkCheck("set/rep schemes 3x5", schemesOk, true, schemesOk));

  const titlesOk = doc.sessions.every((s, i) => s.title.startsWith(weekdayOf(EXPECTED_DATES[i])));
  checks.push(mkCheck("titles prefix weekday", titlesOk, EXPECTED_DATES.map(weekdayOf), doc.sessions.map((s) => s.title)));

  const notes = doc.notes ?? "";
  const notesOk = /press/i.test(notes) && /135/.test(notes) && /2\.5/.test(notes) && /squat/i.test(notes);
  checks.push(mkCheck("notes contain threshold rule", notesOk, "press, 135, 2.5, squat", notes.slice(0, 200)));
} else {
  checks.push(mkCheck("program doc present", false));
}

checks.push(...standardChecks(root, PROGRAM_ID, baselineSha));
report(checks.every((c) => c.pass), checks);
