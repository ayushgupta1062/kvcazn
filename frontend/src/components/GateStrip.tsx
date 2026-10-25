import { useRef } from 'react'
import { clock, duration, hhmmToMinutes, minutesIntoDay, minutesToHhmm, plainShort } from '../format'
import { useWidth } from '../hooks'

interface Props {
  /** The day the gate closes on (D-1), YYYY-MM-DD. */
  decisionDate: string
  /** Every forecast version issued on that day (ISO). */
  publishTimes: string[]
  /** The newest version overall at the gate; only used when nothing was issued on the day before the gate. */
  fallbackPublish: string
  cutoff: string
  /** Omit to show the strip read-only. */
  onCutoff?: (hhmm: string) => void
}

const AXIS_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24]
const DAY = 1440
const pct = (minutes: number) => `${(minutes / DAY) * 100}%`

// Approximate widths in px of the things that must never touch each other.
const LABEL_W = 34 // "07:30"
const USED_LABEL_W = 40 // "09:30", bold
const FLAG_W = 96 // the dark "Gate 09:50" flag, with its offset from the line
const AFTER_W = 84 // "Can't be used"
const GAP = 8

/**
 * The day the buy is decided, as a timeline: each tick is a forecast version being issued, the dark bar
 * is the gate (the auction closes). Anything after the gate can't be used. Drag the gate to see which
 * forecast you would have had.
 */
export function GateStrip({ decisionDate, publishTimes, fallbackPublish, cutoff, onCutoff }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const width = useWidth(trackRef)

  const gate = hhmmToMinutes(cutoff)
  const ticks = publishTimes
    .map((iso) => ({ iso, minutes: minutesIntoDay(iso) }))
    .sort((a, b) => a.minutes - b.minutes)
  const before = ticks.filter((t) => t.minutes <= gate)
  const used = before[before.length - 1]
  const after = ticks.length - before.length

  // ---- what fits where. Everything is placed from the measured width, so nothing overlaps at any size.
  const px = (minutes: number) => (minutes / DAY) * width
  const gateX = px(gate)

  // Tick labels: the version in use is always named. The rest are named only if all of them fit side by
  // side (otherwise the strip would be missing labels at random); one that sits under the gate line waits.
  const labels = new Map<string, 'center' | 'end'>()
  if (width > 0) {
    const others = ticks.filter((t) => t !== used)
    const allFit = others.every((t, i) => i === 0 || px(t.minutes) - px(others[i - 1].minutes) >= LABEL_W + GAP)
    if (allFit) {
      for (const t of others) if (Math.abs(px(t.minutes) - gateX) >= LABEL_W / 2 + GAP) labels.set(t.iso, 'center')
    }
    // The gate is at or after the used tick: if it is close, the label moves to the tick's left.
    if (used) labels.set(used.iso, gateX - px(used.minutes) < USED_LABEL_W / 2 + GAP ? 'end' : 'center')
  }

  // The flag goes to the right of the line, or to its left near the end of the day.
  const flagLeft = width > 0 && gateX + FLAG_W > width
  const room = width - gateX
  const showAfterNote = width > 0 && room >= AFTER_W + 12 + (flagLeft ? 0 : FLAG_W + 12)

  return (
    <figure className="gate">
      <div className="gate-track" ref={trackRef}>
        <div className="gate-after" style={{ left: pct(gate) }}>
          {showAfterNote && <span>Can't be used</span>}
        </div>
        {ticks.map((t) => {
          const state = t === used ? 'used' : t.minutes <= gate ? 'earlier' : 'later'
          const anchor = labels.get(t.iso)
          return (
            <div key={t.iso} className={`gate-tick ${state}`} style={{ left: pct(t.minutes) }}>
              {anchor && <span className={`gate-tick-label${anchor === 'end' ? ' end' : ''}`}>{clock(t.iso)}</span>}
            </div>
          )
        })}
        <div className={`gate-line${flagLeft ? ' flip' : ''}`} style={{ left: pct(gate) }}>
          <span className="gate-flag">Gate {cutoff}</span>
        </div>
        {onCutoff && (
          <input
            className="gate-slider"
            type="range"
            min={0}
            max={1435}
            step={5}
            value={gate}
            aria-label="Gate closing time, UK local"
            aria-valuetext={cutoff}
            onChange={(event) => onCutoff(minutesToHhmm(Number(event.target.value)))}
          />
        )}
      </div>
      <div className="gate-axis" aria-hidden="true">
        {AXIS_HOURS.map((h) => (
          <span key={h} style={{ left: pct(h * 60) }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      <figcaption>
        {used ? (
          <>
            Using the <strong>{clock(used.iso)}</strong> forecast, issued {duration(gate - used.minutes)} before the gate closed.{' '}
            {before.length - 1} earlier {before.length - 1 === 1 ? 'version was' : 'versions were'} out that day.{' '}
          </>
        ) : (
          <>
            Nothing was issued on {plainShort(decisionDate)} before the gate, so the latest from the evening before (
            {clock(fallbackPublish)}) is used.{' '}
          </>
        )}
        {after === 0
          ? 'None arrive after the gate.'
          : `${after} more ${after === 1 ? 'arrives' : 'arrive'} after the gate and can't be used.`}
      </figcaption>
    </figure>
  )
}
