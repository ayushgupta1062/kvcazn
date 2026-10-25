import { describe, expect, it } from 'vitest'
import { niceAxis } from './scale'

describe('niceAxis', () => {
  it('ends on a round number just above the data', () => {
    expect(niceAxis(13_900).max).toBe(14_000)
    expect(niceAxis(11_900).max).toBe(12_000)
    expect(niceAxis(2_700).max).toBe(3_000)
    expect(niceAxis(126).max).toBe(140)
  })

  it('does not overshoot the way d3 nice() does (14.4 GW must not become 20 GW)', () => {
    expect(niceAxis(14_356).max).toBe(15_000)
  })

  it('puts a gridline at zero and at the top, evenly spaced', () => {
    const { ticks, max } = niceAxis(14_356)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBe(max)
    const steps = new Set(ticks.slice(1).map((t, i) => t - ticks[i]))
    expect(steps.size).toBe(1)
  })

  it('never uses more gridlines than asked for and always covers the data', () => {
    for (const peak of [0.4, 1, 7, 99, 126, 480, 1_000, 2_999, 3_500, 8_970, 14_000, 17_100, 41_000, 123_456]) {
      const { ticks, max } = niceAxis(peak)
      expect(max).toBeGreaterThanOrEqual(peak)
      expect(ticks.length - 1).toBeLessThanOrEqual(7)
    }
  })

  it('copes with nothing to draw', () => {
    expect(niceAxis(0)).toEqual({ max: 1, ticks: [0, 1] })
    expect(niceAxis(Number.NaN).max).toBe(1)
  })
})
