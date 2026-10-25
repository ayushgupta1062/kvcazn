import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { scaleBand, scaleLinear } from 'd3-scale'
import { useWidth } from '../hooks'
import { niceAxis } from '../scale'

export interface Column {
  key: string
  value: number
  /** When any column is emphasised, the others recede to grey. */
  emphasis?: boolean
  /** x-axis label, or null to leave this column unlabelled. */
  label: string | null
  tip: ReactNode
}

interface Props {
  columns: Column[]
  tickFormat: (value: number) => string
  /** Unit shown top-left of the axis. */
  yUnit: string
  /** Value label drawn on the cap of these columns only (never on every bar). */
  capLabelKeys?: string[]
  capLabel?: (column: Column) => string
  /** Hairline across the plot at a value, with a name. */
  refLine?: { value: number; label: string }
  /** Hairline at the left edge of a column (e.g. "no miss" in a histogram). */
  edgeLine?: { index: number; label: string }
  /** A bracket over a run of columns (inclusive indices). */
  bracket?: { from: number; to: number; label: string }
  /** Labels sit under the column ("center") or at its left edge ("edge", for binned numbers). */
  labelAt?: 'center' | 'edge'
  xTitle?: string
  summary: string
  height?: number
}

const MAX_BAR = 24 // never fill the slot: the leftover band is air
const MIN_GAP = 2

/** Rounded on the data end (4px), square on the baseline. */
function barPath(x: number, top: number, base: number, w: number): string {
  const h = base - top
  const r = Math.min(4, w / 2, h)
  if (h <= 0) return ''
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`
}

export function ColumnChart({
  columns,
  tickFormat,
  yUnit,
  capLabelKeys = [],
  capLabel,
  refLine,
  edgeLine,
  bracket,
  labelAt = 'center',
  xTitle,
  summary,
  height = 280,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useWidth(wrapRef)
  const [hover, setHover] = useState<number | null>(null)

  // On a wide chart the reference line is named in the right margin, clear of the bars; on a narrow one
  // the name sits above the line instead.
  const refInMargin = Boolean(refLine) && width >= 520
  const refLabelRoom = refInMargin && refLine ? Math.ceil(refLine.label.length * 6.6) + 10 : 0
  const margin = { top: bracket ? 40 : 26, right: 14 + refLabelRoom, bottom: xTitle ? 48 : 30, left: 38 }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = height - margin.top - margin.bottom

  const band = scaleBand<string>()
    .domain(columns.map((c) => c.key))
    .range([0, innerW])
    .paddingInner(0)
  const slot = band.bandwidth()
  const barW = Math.max(2, Math.min(MAX_BAR, slot - MIN_GAP))
  const peak = Math.max(1, ...columns.map((c) => c.value), refLine?.value ?? 0)
  const axis = niceAxis(peak)
  const y = scaleLinear().domain([0, axis.max]).range([innerH, 0])
  const emphasised = columns.some((c) => c.emphasis)

  // Narrow chart: the reference name goes above the line at whichever end has the lower bars under it.
  const refReach = refLine ? Math.max(1, Math.ceil((refLine.label.length * 6.6) / Math.max(1, slot))) : 0
  const tallest = (cs: Column[]) => Math.max(0, ...cs.map((c) => c.value))
  const refAtLeft = refLine ? tallest(columns.slice(0, refReach)) < tallest(columns.slice(-refReach)) : false

  // draw a label only where it will not touch the previous one
  const labelX = (c: Column) => (labelAt === 'edge' ? (band(c.key) ?? 0) : (band(c.key) ?? 0) + slot / 2)
  const shown = new Set<string>()
  let lastLabelX = -Infinity
  for (const c of columns) {
    if (c.label === null || labelX(c) - lastLabelX < 40) continue
    shown.add(c.key)
    lastLabelX = labelX(c)
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = columns.length - 1
    const index = hover ?? -1
    if (event.key === 'Escape') return setHover(null)
    const target =
      event.key === 'ArrowRight' ? Math.min(index + 1, last) :
      event.key === 'ArrowLeft' ? Math.max(index - 1, 0) :
      event.key === 'Home' ? 0 :
      event.key === 'End' ? last : null
    if (target !== null) {
      event.preventDefault()
      setHover(target)
    }
  }

  const colX = (i: number) => (band(columns[i].key) ?? 0) + (slot - barW) / 2
  const hovered = hover !== null ? columns[hover] : null
  const flip = hover !== null && (band(columns[hover].key) ?? 0) > innerW * 0.55

  return (
    <div
      className="chart"
      ref={wrapRef}
      tabIndex={0}
      role="group"
      aria-label={`${summary} Use the left and right arrow keys to read values.`}
      onKeyDown={onKey}
      onBlur={() => setHover(null)}
      onPointerLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} role="presentation">
          <g transform={`translate(${margin.left},${margin.top})`}>
            {axis.ticks.map((tick) => (
              <g key={tick}>
                <line className="grid" x1={0} x2={innerW} y1={y(tick)} y2={y(tick)} />
                <text className="axis-label" x={-8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {tickFormat(tick)}
                </text>
              </g>
            ))}
            <text className="axis-label" x={-margin.left + 2} y={-12}>
              {yUnit}
            </text>
            <line className="baseline" x1={0} x2={innerW} y1={innerH} y2={innerH} />

            {columns.map((c, i) => {
              const fill = emphasised && !c.emphasis ? 'var(--ctx)' : 'var(--forecast)'
              return (
                <path
                  key={c.key}
                  d={barPath(colX(i), y(c.value), innerH, barW)}
                  className={`bar${hover === i ? ' is-hover' : ''}`}
                  style={{ fill, opacity: emphasised && !c.emphasis ? 0.55 : 1 }}
                />
              )
            })}

            {columns.map((c) =>
              shown.has(c.key) ? (
                <text key={c.key} className="axis-label" x={labelX(c)} y={innerH + 18} textAnchor="middle">
                  {c.label}
                </text>
              ) : null,
            )}
            {xTitle && (
              <text className="axis-title" x={innerW / 2} y={innerH + 40} textAnchor="middle">
                {xTitle}
              </text>
            )}

            {refLine && (
              <g>
                <line className="ref" x1={0} x2={innerW} y1={y(refLine.value)} y2={y(refLine.value)} />
                {refInMargin ? (
                  <text className="ref-label" x={innerW + 8} y={y(refLine.value)} dy="0.32em">
                    {refLine.label}
                  </text>
                ) : (
                  <text
                    className="ref-label"
                    x={refAtLeft ? 0 : innerW}
                    y={y(refLine.value) - 6}
                    textAnchor={refAtLeft ? 'start' : 'end'}
                  >
                    {refLine.label}
                  </text>
                )}
              </g>
            )}
            {edgeLine && (
              <g>
                <line className="ref" x1={band(columns[edgeLine.index].key) ?? 0} x2={band(columns[edgeLine.index].key) ?? 0} y1={-6} y2={innerH} />
                <text className="ref-label" x={(band(columns[edgeLine.index].key) ?? 0) + 6} y={-10}>
                  {edgeLine.label}
                </text>
              </g>
            )}
            {bracket && (
              <g className="bracket">
                <path
                  d={`M${band(columns[bracket.from].key) ?? 0},-8V-14H${(band(columns[bracket.to].key) ?? 0) + slot}V-8`}
                />
                <text
                  x={((band(columns[bracket.from].key) ?? 0) + (band(columns[bracket.to].key) ?? 0) + slot) / 2}
                  y={-22}
                  textAnchor="middle"
                >
                  {bracket.label}
                </text>
              </g>
            )}

            {columns.map((c, i) =>
              capLabelKeys.includes(c.key) && capLabel ? (
                <text key={c.key} className="cap-label" x={colX(i) + barW / 2} y={y(c.value) - 6} textAnchor="middle">
                  {capLabel(c)}
                </text>
              ) : null,
            )}

            {/* hit targets: the whole column slot, taller than the mark */}
            {columns.map((c, i) => (
              <rect
                key={c.key}
                x={band(c.key) ?? 0}
                y={0}
                width={slot}
                height={innerH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerMove={() => setHover(i)}
              />
            ))}
          </g>
        </svg>
      )}
      {hovered && hover !== null && (
        <div
          className="tip"
          role="status"
          style={{
            left: margin.left + (band(hovered.key) ?? 0) + slot / 2,
            top: margin.top,
            transform: flip ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
          }}
        >
          {hovered.tip}
        </div>
      )}
    </div>
  )
}
