import { describe, expect, test } from 'bun:test'
import { SpeedMeter, totalLoadedBytes } from './upload-progress'

/** Feed a meter samples every 250 ms at a constant byte rate. */
function feedConstant(meter: SpeedMeter, ratePerSec: number, seconds: number) {
  const steps = Math.round(seconds / 0.25)
  for (let i = 0; i <= steps; i++) {
    meter.addSample(i * 250, Math.round(ratePerSec * (i * 0.25)))
  }
}

describe('totalLoadedBytes', () => {
  test('adds acknowledged and in-flight bytes', () => {
    expect(totalLoadedBytes(16_000_000, [4_000_000, 2_000_000])).toBe(22_000_000)
    expect(totalLoadedBytes(0, [])).toBe(0)
    expect(totalLoadedBytes(8_000_000, [])).toBe(8_000_000)
  })
})

describe('SpeedMeter', () => {
  test('converges to the true rate on dense constant samples', () => {
    const meter = new SpeedMeter()
    feedConstant(meter, 10_000_000, 10)
    // Within 15% of 10 MB/s after the window + EMA have settled.
    expect(meter.speed()).toBeGreaterThan(8_500_000)
    expect(meter.speed()).toBeLessThan(11_500_000)
  })

  test('no chunk drop-off: speed is steady once settled, not halving', () => {
    const meter = new SpeedMeter()
    // 10 MB/s for 10 s, sampled densely. The old ack-only meter would lose
    // an 8 MB sample from its window in one step; here each step is 250 ms.
    const speeds: number[] = []
    for (let i = 0; i <= 40; i++) {
      meter.addSample(i * 250, 10_000_000 * (i * 0.25))
      if (i >= 24) speeds.push(meter.speed())
    }
    const min = Math.min(...speeds)
    const max = Math.max(...speeds)
    expect(max - min).toBeLessThan(2_000_000)
  })

  test('ETA is gated for the first 2s, then stable at constant rate', () => {
    const meter = new SpeedMeter()
    feedConstant(meter, 10_000_000, 1.5)
    expect(meter.etaSeconds(200_000_000, 15_000_000, 1500)).toBeNull()
    feedConstant(meter, 10_000_000, 0)
    // Continue to 10 s total.
    for (let i = 7; i <= 40; i++) {
      meter.addSample(i * 250, 10_000_000 * (i * 0.25))
    }
    const eta = meter.etaSeconds(200_000_000, 100_000_000, 10_000)
    expect(eta).not.toBeNull()
    // 100 MB left at ~10 MB/s ≈ 10 s, allow EMA settling slack.
    expect(eta!).toBeGreaterThan(8)
    expect(eta!).toBeLessThan(13)
  })

  test('ETA is 0 when nothing remains', () => {
    const meter = new SpeedMeter()
    feedConstant(meter, 10_000_000, 5)
    expect(meter.etaSeconds(50_000_000, 50_000_000, 5000)).toBe(0)
  })

  test('stall decays gradually instead of dropping to zero in one tick', () => {
    const meter = new SpeedMeter()
    feedConstant(meter, 10_000_000, 6)
    const settled = meter.speed()
    expect(settled).toBeGreaterThan(8_000_000)
    // One stalled tick should not zero the rate.
    meter.addSample(6250, 60_000_000)
    expect(meter.speed()).toBeGreaterThan(0)
    expect(meter.speed()).toBeLessThan(settled)
  })

  test('regressed byte counts never move the meter backwards', () => {
    const meter = new SpeedMeter()
    feedConstant(meter, 10_000_000, 3)
    const before = meter.speed()
    meter.addSample(3250, 0) // e.g. a retried chunk restarting
    meter.addSample(3500, 5_000_000)
    expect(meter.speed()).toBeGreaterThan(0)
    expect(Math.abs(meter.speed() - before)).toBeLessThan(before)
  })

  test('bursty chunk acks alone still smooth out over the window', () => {
    // Worst case for the old meter: +64 MB in one lump (8 chunks landing
    // together). The EMA keeps the displayed rate from spiking to match.
    const meter = new SpeedMeter()
    meter.addSample(0, 0)
    for (let i = 1; i <= 20; i++) {
      const lump = i % 4 === 0 ? 64_000_000 : 0
      // 64 MB every second == 64 MB/s average, delivered in lumps.
      const bytes = Math.floor(i / 4) * 64_000_000
      meter.addSample(i * 250, bytes)
      void lump
    }
    expect(meter.speed()).toBeGreaterThan(30_000_000)
    expect(meter.speed()).toBeLessThan(90_000_000)
  })
})
