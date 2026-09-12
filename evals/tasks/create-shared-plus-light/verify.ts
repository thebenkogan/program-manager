// Verifier for create-shared-plus-light: heavy/light squat, shared clean
// alternation, flat Wednesday deadlift.
import {
  arrNumEq,
  findExerciseByName,
  findExerciseFamily,
  getArgs,
  loadProgram,
  mkCheck,
  parseIntensity,
  report,
  standardChecks,
  weekdayOf,
  type Check,
} from "../../lib/verify-helpers.ts";

const PROGRAM_ID = "cara-heavy-light";
const EXPECTED_DATES = ["2026-10-05", "2026-10-07", "2026-10-10", "2026-10-12", "2026-10-14", "2026-10-17"];
const EXPECTED_WEEKS = [1, 1, 1, 2, 2, 2];
// Heavy Mon+Sat share one counter: 200,205,210,215 on sessions 0,2,3,5.
const EXPECTED_HEAVY = [200, 205, 210, 215];
// Light Wed = 80% of that week's Monday, nearest 5 lb: 160, 170.
const EXPECTED_LIGHT = [160, 170];
// Shared alternation starting C&J: 115..140 step 5.
const EXPECTED_PULL_KIND = ["cj", "clean", "cj", "clean", "cj", "clean"] as const;
const EXPECTED_PULL_W = [115, 120, 125, 130, 135, 140];

const { root, baselineSha } = getArgs();
const checks: Check[] = [];
const { found, file, doc } = loadProgram(root, PROGRAM_ID);
checks.push(mkCheck("program file exists", found, true, found));

if (file && doc) {
  checks.push(mkCheck("file id", file.id === PROGRAM_ID, PROGRAM_ID, file.id));
  checks.push(mkCheck("file clientId", file.clientId === "cara", "cara", file.clientId));
  checks.push(mkCheck("weeks == 2", doc.weeks === 2, 2, doc.weeks));
  checks.push(mkCheck("startDate", doc.startDate === "2026-10-05", "2026-10-05", doc.startDate));
  checks.push(mkCheck("6 sessions", doc.sessions.length === 6, 6, doc.sessions.length));

  const dates = doc.sessions.map((s) => s.date);
  checks.push(mkCheck("session dates", JSON.stringify(dates) === JSON.stringify(EXPECTED_DATES), EXPECTED_DATES, dates));
  const weeks = doc.sessions.map((s) => s.week);
  checks.push(mkCheck("week numbers", JSON.stringify(weeks) === JSON.stringify(EXPECTED_WEEKS), EXPECTED_WEEKS, weeks));

  // Heavy squat on Mon+Sat sessions (0,2,3,5), 3x5.
  // Family matching: prompt says "squat", agent may write "Squat"/"Back Squat".
  const heavyIdx = [0, 2, 3, 5];
  const heavy = heavyIdx.map((i) => {
    const ex = findExerciseFamily(doc.sessions[i], ["squat"]);
    return ex ? parseIntensity(ex.intensity) : null;
  });
  checks.push(mkCheck("heavy squat [200,205,210,215]", arrNumEq(heavy, EXPECTED_HEAVY), EXPECTED_HEAVY, heavy));
  const heavyScheme = heavyIdx.every((i) => {
    const ex = findExerciseFamily(doc.sessions[i], ["squat"]);
    return ex?.sets === 3 && ex?.reps === "5";
  });
  checks.push(mkCheck("heavy squat 3x5", heavyScheme, true, heavyScheme));

  // Light squat on Wed sessions (1,4), 2x5.
  const lightIdx = [1, 4];
  const light = lightIdx.map((i) => {
    const ex = findExerciseFamily(doc.sessions[i], ["squat"]);
    return ex ? parseIntensity(ex.intensity) : null;
  });
  checks.push(mkCheck("light squat [160,170]", arrNumEq(light, EXPECTED_LIGHT), EXPECTED_LIGHT, light));
  const lightScheme = lightIdx.every((i) => {
    const ex = findExerciseFamily(doc.sessions[i], ["squat"]);
    return ex?.sets === 2 && ex?.reps === "5";
  });
  checks.push(mkCheck("light squat 2x5", lightScheme, true, lightScheme));

  // Shared alternating pull: names strictly alternate starting C&J, one counter.
  const pulls = doc.sessions.map((s) => {
    const cj = findExerciseByName(s, "Clean & Jerk");
    const cl = findExerciseByName(s, "Clean");
    if (cj && !cl) return { kind: "cj" as const, w: parseIntensity(cj.intensity), sets: cj.sets, reps: cj.reps };
    if (cl && !cj) return { kind: "clean" as const, w: parseIntensity(cl.intensity), sets: cl.sets, reps: cl.reps };
    return { kind: "other" as const, w: null as number | null, sets: 0, reps: "" };
  });
  // Reject sessions carrying both or neither pull movement.
  checks.push(
    mkCheck(
      "one pull movement per session",
      pulls.every((p) => p.kind !== "other"),
      "exactly one of Clean & Jerk / Clean",
      pulls.map((p) => p.kind),
    ),
  );
  checks.push(
    mkCheck("pull alternates C&J first", JSON.stringify(pulls.map((p) => p.kind)) === JSON.stringify([...EXPECTED_PULL_KIND]), [...EXPECTED_PULL_KIND], pulls.map((p) => p.kind)),
  );
  checks.push(
    mkCheck("shared pull weights [115..140]", arrNumEq(pulls.map((p) => p.w), EXPECTED_PULL_W), EXPECTED_PULL_W, pulls.map((p) => p.w)),
  );
  const pullScheme = pulls.every((p) => p.sets === 5 && p.reps === "3");
  checks.push(mkCheck("pull 5x3", pullScheme, true, pullScheme));
  // Anti-day-pin: sessions 0 and 3 are both Mondays but must differ (alternation, not weekday pinning).
  checks.push(mkCheck("not weekday-pinned (Mon sessions differ)", pulls[0].kind !== pulls[3].kind, "different", [pulls[0].kind, pulls[3].kind]));

  // Deadlift Wednesdays only, flat 225.
  const deads = doc.sessions.map((s) => findExerciseFamily(s, ["deadlift"]));
  const deadIdx = [1, 4];
  const deadW = deadIdx.map((i) => (deads[i] ? parseIntensity(deads[i]!.intensity) : null));
  checks.push(mkCheck("deadlift Wed only 225 flat", arrNumEq(deadW, [225, 225]), [225, 225], deadW));
  checks.push(
    mkCheck("no deadlift off-Wed", [0, 2, 3, 5].every((i) => !deads[i]), true, [0, 2, 3, 5].map((i) => Boolean(deads[i]))),
  );
  const deadScheme = deadIdx.every((i) => deads[i]?.sets === 1 && deads[i]?.reps === "5");
  checks.push(mkCheck("deadlift 1x5", deadScheme, true, deadScheme));

  // Titles: weekday prefix + correct pull movement (Jerk iff C&J session).
  const titlesOk = doc.sessions.every((s, i) => {
    if (!s.title.startsWith(weekdayOf(EXPECTED_DATES[i]))) return false;
    const hasJerk = /jerk/i.test(s.title);
    return pulls[i].kind === "cj" ? hasJerk : !hasJerk;
  });
  checks.push(mkCheck("titles weekday + pull", titlesOk, "weekday prefix, Jerk iff C&J", doc.sessions.map((s) => s.title)));

  const notes = doc.notes ?? "";
  // Concept check (deterministic, synonym-tolerant): the rotation concept
  // counts as "shared" or "alternating"; numbers stay strict.
  const notesOk =
    /80%/.test(notes) && /(shared|alternat)/i.test(notes) && /deadlift/i.test(notes) && /(\+5|5 lb)/.test(notes);
  checks.push(mkCheck("notes contain all rules", notesOk, "80%, shared/alternating, deadlift, +5/5 lb", notes.slice(0, 250)));
} else {
  checks.push(mkCheck("program doc present", false));
}

checks.push(...standardChecks(root, PROGRAM_ID, baselineSha));
report(checks.every((c) => c.pass), checks);
