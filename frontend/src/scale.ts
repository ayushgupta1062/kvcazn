/** Round step sizes, as multiples of a power of ten: 1, 2, 2.5 and 5 (never 3 or 4). */
const STEP_MULTIPLES = [1, 2, 2.5, 5]

/**
 * A y axis that starts at zero and ends on a round number, with no more than `maxIntervals` gridlines
 * apart. d3's own `nice()` can overshoot badly (data up to 14.4 GW gives an axis to 20 GW); this picks the
 * smallest round step that fits, so the plot uses the room it has.
 */
export function niceAxis(peak: number, maxIntervals = 7): { max: number; ticks: number[] } {
  if (!(peak > 0) || !Number.isFinite(peak)) return { max: 1, ticks: [0, 1] }
  for (let power = Math.floor(Math.log10(peak / maxIntervals)) - 1; ; power++) {
    for (const multiple of STEP_MULTIPLES) {
      const step = multiple * 10 ** power
      const intervals = Math.max(1, Math.ceil(peak / step - 1e-9))
      if (intervals <= maxIntervals) {
        const ticks = Array.from({ length: intervals + 1 }, (_, i) => Number((i * step).toPrecision(12)))
        return { max: ticks[intervals], ticks }
      }
    }
  }
}
