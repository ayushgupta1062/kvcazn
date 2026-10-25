import { useEffect, useState } from 'react'
import { addDays, hhmmToMinutes, minutesToHhmm, parseClock, plainShort } from '../format'
import type { Alignment, MetaResponse } from '../types'

interface Props {
  meta: MetaResponse
  /** The decision day only matters on the Decision tab. */
  showDate: boolean
  /** Matching hourly forecasts to half-hourly actuals only matters where numbers are shown. */
  showAlignment: boolean
  date: string
  cutoff: string
  alignment: Alignment
  onDate: (date: string) => void
  onCutoff: (cutoff: string) => void
  onAlignment: (alignment: Alignment) => void
}

const STEP_MINUTES = 5

/**
 * A 24-hour time box. The browser's own time input shows AM/PM or 24-hour depending on the viewer's
 * locale; this market works in 24-hour UK time, so it is always shown that way.
 */
function GateInput({ value, onChange }: { value: string; onChange: (hhmm: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value]) // follow the slider and the preset buttons

  const settle = () => {
    const parsed = parseClock(draft)
    if (parsed) onChange(parsed)
    else setDraft(value)
  }

  return (
    <input
      id="gate-time"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={5}
      value={draft}
      aria-describedby="gate-note"
      onChange={(event) => {
        setDraft(event.target.value)
        if (/^\d{2}:\d{2}$/.test(event.target.value)) {
          const parsed = parseClock(event.target.value)
          if (parsed) onChange(parsed)
        }
      }}
      onBlur={settle}
      onKeyDown={(event) => {
        if (event.key === 'Enter') settle()
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          const direction = event.key === 'ArrowUp' ? 1 : -1
          const next = hhmmToMinutes(value) + direction * STEP_MINUTES
          onChange(minutesToHhmm(Math.min(24 * 60 - 1, Math.max(0, next))))
        }
      }}
    />
  )
}

/** One row of settings above everything they scope. */
export function FilterBar({ meta, showDate, showAlignment, date, cutoff, alignment, onDate, onCutoff, onAlignment }: Props) {
  const first = meta.decisionStart
  const last = meta.decisionEnd
  return (
    <div className="filters">
      {showDate && (
        <div className="field">
          <label htmlFor="decision-date">Decision made on</label>
          <div className="stepper">
            <button type="button" aria-label="Previous day" disabled={date <= first} onClick={() => onDate(addDays(date, -1))}>
              ‹
            </button>
            <select id="decision-date" value={date} onChange={(event) => onDate(event.target.value)}>
              {meta.decisionDays.map((day) => (
                <option key={day.decisionDate} value={day.decisionDate}>
                  {plainShort(day.decisionDate)}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Next day" disabled={date >= last} onClick={() => onDate(addDays(date, 1))}>
              ›
            </button>
          </div>
          <span className="field-note">for delivery on {plainShort(addDays(date, meta.daysBefore))}</span>
        </div>
      )}

      <div className="field">
        <label htmlFor="gate-time">Gate closes at</label>
        <div className="gate-controls">
          <GateInput value={cutoff} onChange={onCutoff} />
          <div className="seg" role="group" aria-label="Typical gate closures">
            {meta.cutoffPresets.map((preset) => (
              <button
                key={preset.time}
                type="button"
                title={preset.label}
                aria-pressed={cutoff === preset.time}
                onClick={() => onCutoff(preset.time)}
              >
                {preset.name} {preset.time}
              </button>
            ))}
          </div>
        </div>
        <span className="field-note" id="gate-note">
          24-hour UK time, on the day before delivery
        </span>
      </div>

      {showAlignment && (
        <div className="field">
          <label htmlFor="match">Match actuals by</label>
          <select id="match" value={alignment} onChange={(event) => onAlignment(event.target.value as Alignment)}>
            {meta.alignments.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="field-note">forecasts are hourly, actuals half-hourly</span>
        </div>
      )}
    </div>
  )
}
