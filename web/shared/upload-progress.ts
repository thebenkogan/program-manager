// Smoothed upload speed / ETA from dense byte samples.
//
// Why this exists: measuring speed only on 8 MB chunk acks makes the
// numerator jump in 64 MB lumps (8 chunks in flight), and when the oldest
// sample ages out of a rolling window the speed halves in one tick with no
// real change in throughput — the ETA, which divides by that speed, whipsaws
// with it. Feeding this meter byte-level loaded counts on a fixed 250 ms
// tick (from XHR upload progress) makes each window step worth ~250 ms of
// traffic, so the drop-off is negligible, and an EMA on top of the windowed
// rate keeps the displayed number from flickering between ticks.
//
// Pure and deterministic: callers pass timestamps (performance.now()) in,
// get bytes/sec and a gated ETA out. No DOM, no timers.

/** Rolling window the raw rate is measured over. */
export const SPEED_WINDOW_MS = 5000
/** How often the UI samples loaded bytes. */
export const SPEED_SAMPLE_MS = 250
/** Don't show an ETA until this much steady data exists. */
export const ETA_MIN_ELAPSED_MS = 2000
/** EMA weight for the newest raw rate. Lower = smoother, laggier. */
const EMA_ALPHA = 0.3
/** Below this elapsed time the rate is not meaningful yet. */
const MIN_RATE_ELAPSED_MS = 500
/** Hard cap on retained samples (5 s at 250 ms is ~20). */
const MAX_SAMPLES = 40

export interface ProgressSample {
  t: number
  b: number
}

/** Acknowledged bytes plus whatever is still in flight, in bytes. */
export function totalLoadedBytes(
  acknowledged: number,
  inFlight: Iterable<number>,
): number {
  let total = acknowledged
  for (const loaded of inFlight) total += loaded
  return total
}

export class SpeedMeter {
  private samples: ProgressSample[] = []
  private smoothed = 0
  private startedAt: number | null = null
  private maxBytes = 0

  /**
   * Record a loaded-byte count at time `t`. Bytes are monotonic: a regressed
   * count (e.g. a retried chunk restarting from zero) is held at the highest
   * seen so the displayed progress never moves backwards.
   */
  addSample(t: number, bytes: number): void {
    if (this.startedAt === null) this.startedAt = t
    this.maxBytes = Math.max(this.maxBytes, bytes)
    const last = this.samples[this.samples.length - 1]
    if (last && t <= last.t) return
    this.samples.push({ t, b: this.maxBytes })

    const cutoff = t - SPEED_WINDOW_MS
    while (this.samples.length > 1 && this.samples[0].t < cutoff) {
      this.samples.shift()
    }
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES)
    }

    const elapsedMs = t - this.startedAt
    if (elapsedMs < MIN_RATE_ELAPSED_MS) return

    const first = this.samples[0]
    const spanSec = (t - first.t) / 1000
    // With dense samples the window edge moves ~250 ms per tick, so this
    // rate changes a little each tick instead of dropping a whole chunk.
    // Stalled uploads decay gradually: the numerator shrinks to zero as the
    // window slides past the last movement.
    const raw =
      spanSec >= 0.5
        ? (this.maxBytes - first.b) / spanSec
        : this.maxBytes / (elapsedMs / 1000)

    this.smoothed =
      this.smoothed === 0
        ? raw
        : EMA_ALPHA * raw + (1 - EMA_ALPHA) * this.smoothed
  }

  /** Smoothed bytes/sec. 0 until enough data exists. */
  speed(): number {
    return this.smoothed
  }

  /**
   * Seconds remaining at the smoothed rate, or null while the estimate is
   * still unstable (first ETA_MIN_ELAPSED_MS) or no rate exists yet.
   */
  etaSeconds(totalBytes: number, sentBytes: number, now: number): number | null {
    if (this.startedAt === null) return null
    if (now - this.startedAt < ETA_MIN_ELAPSED_MS) return null
    if (this.smoothed <= 0) return null
    const remaining = totalBytes - sentBytes
    if (remaining <= 0) return 0
    return remaining / this.smoothed
  }
}
