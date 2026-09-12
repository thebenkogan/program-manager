// Verifier for create-linear-2wk: 2-week Mon/Wed/Sat linear program for Alice.
import {
  arrNumEq,
  findExerciseFamily,
  getArgs,
  loadProgram,
  mkCheck,
  numEq,
  parseIntensity,
  report,
  standardChecks,
  weekdayOf,
  type Check,
} from "../../lib/verify-helpers.ts";

const PROGRAM_ID = "alice-linear-2wk";
const EXPECTED_DATES = ["2026-10-05", "2026-10-07", "2026-10-10", "2026-10-12", "2026-10-14", "2026-10-17"];
const EXPECTED_WEEKS = [1, 1, 1, 2, 2, 2];
const EXPECTED_SQUAT = [135, 140, 145, 150, 155, 160];
const EXPECTED_BENCH = [95, 100, 105, 110, 115, 120];

const { root, baselineSha } = getArgs();
const checks: Check[] = [];
const { found, file, doc } = loadProgram(root, PROGRAM_ID);
checks.push(mkCheck("program file exists", found, true, found));

if (file && doc) {
  checks.push(mkCheck("file id", file.id === PROGRAM_ID, PROGRAM_ID, file.id));
  checks.push(mkCheck("file clientId", file.clientId === "alice", "alice", file.clientId));
  checks.push(mkCheck("weeks == 2", doc.weeks === 2, 2, doc.weeks));
  checks.push(mkCheck("startDate", doc.startDate === "2026-10-05", "2026-10-05", doc.startDate));
  checks.push(mkCheck("6 sessions", doc.sessions.length === 6, 6, doc.sessions.length));

  const dates = doc.sessions.map((s) => s.date);
  checks.push(mkCheck("session dates", JSON.stringify(dates) === JSON.stringify(EXPECTED_DATES), EXPECTED_DATES, dates));

  const weeks = doc.sessions.map((s) => s.week);
  checks.push(mkCheck("week numbers", JSON.stringify(weeks) === JSON.stringify(EXPECTED_WEEKS), EXPECTED_WEEKS, weeks));

  // Lift-family matching: informal prompts don't pin exact exercise names
  // ("squat" vs "Back Squat"), so match on the lift family.
  const squat = doc.sessions.map((s) => {
    const ex = findExerciseFamily(s, ["squat"]);
    return ex ? parseIntensity(ex.intensity) : null;
  });
  checks.push(mkCheck("squat 135..160 step 5", arrNumEq(squat, EXPECTED_SQUAT), EXPECTED_SQUAT, squat));
  const bench = doc.sessions.map((s) => {
    const ex = findExerciseFamily(s, ["bench"]);
    return ex ? parseIntensity(ex.intensity) : null;
  });
  checks.push(mkCheck("bench 95..120 step 5", arrNumEq(bench, EXPECTED_BENCH), EXPECTED_BENCH, bench));

  // Deadlift Mondays only (sessions 0 and 3), +10/week.
  const deads = doc.sessions.map((s) => findExerciseFamily(s, ["deadlift"])?.intensity ?? null);
  checks.push(mkCheck("deadlift only sessions 0,3", deads[1] === null && deads[2] === null && deads[4] === null && deads[5] === null, [null, null], [deads[1], deads[2], deads[4], deads[5]]));
  checks.push(
    mkCheck(
      "deadlift [185,195]",
      numEq(parseIntensity(deads[0]), 185) && numEq(parseIntensity(deads[3]), 195),
      ["185 lb", "195 lb"],
      [deads[0], deads[3]],
    ),
  );

  // Schemes: squat/bench 3x5 every session, deadlift 1x5 where present.
  const schemesOk = doc.sessions.every((s) => {
    const sq = findExerciseFamily(s, ["squat"]);
    const bp = findExerciseFamily(s, ["bench"]);
    const dl = findExerciseFamily(s, ["deadlift"]);
    return sq?.sets === 3 && sq?.reps === "5" && bp?.sets === 3 && bp?.reps === "5" && (!dl || (dl.sets === 1 && dl.reps === "5"));
  });
  checks.push(mkCheck("set/rep schemes", schemesOk, "squat/bench 3x5, deadlift 1x5", schemesOk ? "ok" : "mismatch"));

  // Titles carry the correct weekday prefix.
  const titlesOk = doc.sessions.every((s, i) => s.title.startsWith(weekdayOf(EXPECTED_DATES[i])));
  checks.push(
    mkCheck("titles prefix weekday", titlesOk, EXPECTED_DATES.map(weekdayOf), doc.sessions.map((s) => s.title)),
  );

  // Notes document the rules.
  const notes = doc.notes ?? "";
  const notesOk =
    /squat/i.test(notes) && /bench/i.test(notes) && /deadlift/i.test(notes) && /135/.test(notes) && /(\+5|5 lb)/.test(notes);
  checks.push(mkCheck("notes contain rules", notesOk, "squat+bench+deadlift, 135, +5/5 lb", notes.slice(0, 200)));
} else {
  checks.push(mkCheck("program doc present", false));
}

checks.push(...standardChecks(root, PROGRAM_ID, baselineSha));
report(checks.every((c) => c.pass), checks);
