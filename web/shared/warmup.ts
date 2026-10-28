// Suggested warm-up ladders, derived from an exercise's working weight.
//
// Ben's rule of thumb: start at the bar (when a bar is involved), climb in a
// pyramid, and make the last warm-up a single at ~90% of the working weight.
// Reps step down: 5, 5, 3, 1. Deadlifts get extra singles leading up to the
// working weight because the first rep is the hardest -- but only once the bar
// is loaded heavy enough (>= 245 lb) for one plate a side to be a real warm-up.
// Lighter deadlifts fall back to the bar, which keeps a 70 lb pull from being
// prescribed a set at 135.
//
// Pure and deterministic: no program data is mutated, nothing is stored.

export interface WarmupSet {
  weight: number
  reps: number
}

type Step = {
  /** Fraction of the working weight (ignored when `weight` is set). */
  pct: number
  reps: number
  /** Absolute weight, used instead of pct (e.g. a deadlift's first plate). */
  weight?: number
}

interface Preset {
  steps: Step[]
  /** Below this working weight, warm-ups are not worth showing. */
  minWorkingWeight: number
}

const BAR = 45
/** A bar with a plate a side. */
const PLATE_START = 135
/** One plate only opens the ladder when it is at most ~55% of the work set. */
const PLATE_START_MIN_WORKING = 245
/** A bar 20 lb under the work set is not worth warming up with. */
const MIN_LADDER_GAP = 20

const STANDARD_STEPS: Step[] = [
  { pct: 0.5, reps: 5 },
  { pct: 0.75, reps: 3 },
  { pct: 0.9, reps: 1 },
]

const DEADLIFT_LIGHT_STEPS: Step[] = [
  // Light pulls keep triples on the way up: the jumps are small enough that
  // singles would add nothing but reps at near-working weight.
  { pct: 0.5, reps: 3 },
  { pct: 0.75, reps: 3 },
  { pct: 0.9, reps: 1 },
]

/** Each extra plate a side adds 90 lb to the bar. */
const PLATE_JUMP = 90
/** The last warm-up is always a single at 90% of the work set. */
const LAST_WARMUP_PCT = 0.9

/**
 * Heavy-pull ladder: load a plate a side at a time (135, 225, 315, ...) while
 * that stays at or under 90%, then take the 90% single as the last rung.
 * Returns absolute weights, lightest first.
 */
export function deadliftPlateRungs(working: number): number[] {
  const top = roundTo5(working * LAST_WARMUP_PCT)
  const rungs: number[] = []
  for (let w = PLATE_START; w <= top; w += PLATE_JUMP) rungs.push(w)
  const last = rungs[rungs.length - 1]
  if (last === undefined || top - last >= 5) rungs.push(top)
  return rungs
}

/** "290 lb" -> 290. Returns null when the intensity is not a plain weight. */
export function parseWeight(intensity: string | undefined): number | null {
  if (!intensity) return null
  const m = intensity.trim().match(/^(\d+(?:\.\d+)?)\s*lb$/)
  return m ? Number(m[1]) : null
}

/** Rounds to the nearest 5 lb, with .5 rounding up (202.5 -> 205). */
export function roundTo5(weight: number): number {
  return Math.round(weight / 5) * 5
}

export function warmupPresetFor(name: string): 'standard' | 'deadlift' | null {
  const n = name.toLowerCase()
  if (/\bdeadlift\b/.test(n)) return 'deadlift'
  // Loaded barbell lifts we programme. Bodyweight / machine work gets nothing.
  if (/(squat|bench|press|clean|snatch|jerk|good morning|row)/.test(n)) return 'standard'
  return null
}

function presetFor(name: string, working: number, bar = BAR): Preset {
  const barStep: Step = { pct: 0, reps: 5, weight: bar }
  if (warmupPresetFor(name) === 'deadlift') {
    if (working >= PLATE_START_MIN_WORKING) {
      const rungs = deadliftPlateRungs(working)
      const steps: Step[] = rungs.map((weight, i) => ({
        pct: 0,
        weight,
        // 5 off the floor, a triple on the next rung when there is room, then
        // singles; the top rung is the 90% single.
        reps: i === 0 ? 5 : i === 1 && rungs.length > 2 ? 3 : 1,
      }))
      return { steps, minWorkingWeight: bar + MIN_LADDER_GAP }
    }
    return { steps: [barStep, ...DEADLIFT_LIGHT_STEPS], minWorkingWeight: bar + MIN_LADDER_GAP }
  }
  return { steps: [barStep, ...STANDARD_STEPS], minWorkingWeight: bar + MIN_LADDER_GAP }
}

/**
 * Suggested warm-up sets for one exercise, lightest first.
 * Empty array when the lift is unloaded or too light to need a ladder.
 *
 */
export function suggestWarmup(name: string, intensity: string | undefined): WarmupSet[] {
  const working = parseWeight(intensity)
  if (working === null || warmupPresetFor(name) === null) return []
  const { steps, minWorkingWeight } = presetFor(name, working)
  if (working < minWorkingWeight) return []

  const out: WarmupSet[] = []
  for (const step of steps) {
    const weight = roundTo5(step.weight ?? working * step.pct)
    // Never programme a warm-up at or above the work set, and keep the ladder
    // strictly ascending with at least 5 lb between rungs.
    if (weight >= working) continue
    const prev = out[out.length - 1]
    if (prev && weight - prev.weight < 5) continue
    out.push({ weight, reps: step.reps })
  }
  return out
}

/** "45×5 · 145×5 · 220×3 · 260×1" */
export function formatWarmup(sets: WarmupSet[]): string {
  return sets.map((s) => `${s.weight}×${s.reps}`).join(' · ')
}
