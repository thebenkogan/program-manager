// Verifier for manage-alternation-fix: strict C&J/Clean alternation with a
// shared +5/appearance counter; squat untouched.
import {
  arrNumEq,
  findExercise,
  getArgs,
  intensitiesOf,
  loadProgram,
  mkCheck,
  normalizePull,
  parseIntensity,
  report,
  standardChecks,
  type Check,
} from "../../lib/verify-helpers.ts";

const PROGRAM_ID = "ella-pull-fix";
const EXPECTED_DATES = ["2026-09-14", "2026-09-16", "2026-09-19", "2026-09-21"];
const EXPECTED_PULL = ["cj", "clean", "cj", "clean"] as const;
const EXPECTED_PULL_W = [115, 120, 125, 130];
const EXPECTED_SQUAT = [150, 150, 150, 150];

const { root, baselineSha } = getArgs();
const checks: Check[] = [];
const { found, file, doc } = loadProgram(root, PROGRAM_ID);
checks.push(mkCheck("program file exists", found, true, found));

if (file && doc) {
  checks.push(mkCheck("file id", file.id === PROGRAM_ID, PROGRAM_ID, file.id));
  checks.push(mkCheck("still 4 sessions", doc.sessions.length === 4, 4, doc.sessions.length));
  const dates = doc.sessions.map((s) => s.date);
  checks.push(mkCheck("dates unchanged", JSON.stringify(dates) === JSON.stringify(EXPECTED_DATES), EXPECTED_DATES, dates));

  // Exactly one pull movement per session; classify via normalizePull so
  // "Clean & Jerk" / "Clean and Jerk" / "C&J" all count as cj.
  const pulls = doc.sessions.map((s) => {
    const kinds = s.exercises.map((e) => normalizePull(e.name)).filter((k) => k !== "other");
    const w = s.exercises.map((e) => (normalizePull(e.name) !== "other" ? parseIntensity(e.intensity) : null)).filter((v) => v !== null);
    return { kinds, w };
  });
  checks.push(
    mkCheck("one pull per session", pulls.every((p) => p.kinds.length === 1), "exactly 1 pull/session", pulls.map((p) => p.kinds)),
  );
  const kinds = pulls.map((p) => p.kinds[0] ?? "other");
  checks.push(mkCheck("names [C&J,Clean,C&J,Clean]", JSON.stringify(kinds) === JSON.stringify([...EXPECTED_PULL]), [...EXPECTED_PULL], kinds));
  const weights = pulls.map((p) => p.w[0] ?? null);
  checks.push(mkCheck("intensities [115,120,125,130]", arrNumEq(weights, EXPECTED_PULL_W), EXPECTED_PULL_W, weights));

  // Sessions 0 and 3 are both Mondays: strict alternation requires them to
  // differ, which rejects the common day-pinned failure (C&J on Mon, Clean else).
  checks.push(mkCheck("not weekday-pinned (Mon sessions differ)", kinds[0] !== kinds[3], "different", [kinds[0], kinds[3]]));

  // Titles must name the programmed pull: Jerk iff C&J session.
  const titlesOk = doc.sessions.every((s, i) => {
    const hasJerk = /jerk/i.test(s.title);
    const hasClean = /clean/i.test(s.title);
    if (!hasClean) return false;
    return kinds[i] === "cj" ? hasJerk : !hasJerk;
  });
  checks.push(mkCheck("titles updated with pull", titlesOk, "Clean always; Jerk iff C&J", doc.sessions.map((s) => s.title)));

  // Squat untouched.
  const squat = intensitiesOf(doc, "Back Squat");
  checks.push(mkCheck("squat unchanged [150,150,150,150]", arrNumEq(squat, EXPECTED_SQUAT), EXPECTED_SQUAT, squat));

  // Pull scheme still 5x3.
  const schemeOk = doc.sessions.every((s) => {
    const ex = findExercise(s, (n) => normalizePull(n) !== "other");
    return ex?.sets === 5 && ex?.reps === "3";
  });
  checks.push(mkCheck("pull 5x3", schemeOk, true, schemeOk));

  const notes = doc.notes ?? "";
  // Concept check (deterministic, synonym-tolerant): rotation counts as
  // "shared" or "alternating"; start weight stays strict.
  const notesOk = /(shared|alternat)/i.test(notes) && /115/.test(notes);
  checks.push(mkCheck("notes document alternation", notesOk, "shared/alternating, 115", notes.slice(0, 200)));
} else {
  checks.push(mkCheck("program doc present", false));
}

checks.push(...standardChecks(root, PROGRAM_ID, baselineSha));
report(checks.every((c) => c.pass), checks);
