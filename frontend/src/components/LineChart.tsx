import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { bisector } from 'd3-array'
import { scaleLinear } from 'd3-scale'
import { area, curveLinear, curveStepAfter, line } from 'd3-shape'
import { gwTick } from '../format'
import { useWidth } from '../hooks'
import { niceAxis } from '../scale'

export interface Pt {
  t: number
  v: number | null
}

export interface LineSeries {
  id: string
  label: string
  color: string
  points: Pt[]
  /** Hourly values: each value holds until the next point. */
  step?: boolean
  dash?: string
  opacity?: number
  /** Mark the last value with a dot (and a name label when there is room). */
  endDot?: boolean
}

export interface Band {
  color: string
  points: { t: number; lo: number; hi: number }[]
}

interface Props {
  series: LineSeries[]
  band?: Band
  /** [start, end] of the x axis in ms. */
  domain: [number, number]
  /** Length of one hourly step in ms, so the last step reaches its end. */
  stepMs: number
  xTicks: number[]
  xLabel: (t: number) => string
  /** Instants the crosshair can land on (sorted). */
  snapTimes: number[]
  tooltip: (t: number) => ReactNode
  summary: string
  height?: number
}

const bisectTime = bisector((d: number) => d).center
const MIN_LABEL_PITCH = 44 // px between x labels such as "09:00"

function valueAt(series: LineSeries, t: number): number | null {
  if (series.step) {
    let found: number | null = null
    for (const point of series.points) {
      if (point.t > t) break
      found = point.v
    }
    return found
  }
  return series.points.find((point) => point.t === t)?.v ?? null
}

/** Time-series chart in MW, drawn in GW. Thin 2px lines, hairline grid, snapping crosshair, keyboard support. */
export function LineChart({ series, band, domain, stepMs, xTicks, xLabel, snapTimes, tooltip, summary, height = 300 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useWidth(wrapRef)
  const [hover, setHover] = useState<number | null>(null)

  const wide = width >= 640
  const margin = { top: 22, right: wide ? 92 : 14, bottom: 28, left: 38 }
  const innerW = Math.max(0, width - margin.left - margin.right)
  const innerH = height - margin.top - margin.bottom

  const peak = useMemo(() => {
    const values = series.flatMap((s) => s.points.map((p) => p.v ?? 0))
    if (band) values.push(...band.points.map((p) => p.hi))
    return Math.max(1000, ...values)
  }, [series, band])

  const axis = useMemo(() => niceAxis(peak), [peak])
  const x = scaleLinear().domain(domain).range([0, innerW])
  const y = scaleLinear().domain([0, axis.max]).range([innerH, 0])
  const yTicks = axis.ticks

  // name every x tick that fits, or every 2nd/3rd one on a narrow screen, never two that touch
  const tickPitch = innerW / Math.max(1, xTicks.length - 1)
  const tickStride = Math.max(1, Math.ceil(MIN_LABEL_PITCH / Math.max(1, tickPitch)))
  const labelledTicks = xTicks.filter((_, i) => i % tickStride === 0)

  const closed = <T extends { t: number }>(points: T[], step?: boolean): T[] =>
    step && points.length ? [...points, { ...points[points.length - 1], t: points[points.length - 1].t + stepMs }] : points

  const pathFor = (s: LineSeries) => {
    const defined = s.points.filter((p): p is { t: number; v: number } => p.v !== null)
    return line<{ t: number; v: number }>()
      .x((d) => x(d.t))
      .y((d) => y(d.v))
      .curve(s.step ? curveStepAfter : curveLinear)(closed(defined, s.step))
  }

  const bandPath = band
    ? area<{ t: number; lo: number; hi: number }>()
        .x((d) => x(d.t))
        .y0((d) => y(d.lo))
        .y1((d) => y(d.hi))
        .curve(curveStepAfter)(closed(band.points, true))
    : null

  // end-of-line name labels, skipped where two would collide
  const endLabels: { id: string; label: string; y: number }[] = []
  if (wide) {
    for (const s of series) {
      if (!s.endDot) continue
      const last = [...s.points].reverse().find((p) => p.v !== null)
      if (!last || last.v === null) continue
      const yy = y(last.v)
      if (endLabels.every((l) => Math.abs(l.y - yy) >= 16)) endLabels.push({ id: s.id, label: s.label, y: yy })
    }
  }

  const snap = (t: number) => (snapTimes.length ? snapTimes[bisectTime(snapTimes, t)] : null)

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    setHover(snap(x.invert(event.clientX - box.left)))
  }

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!snapTimes.length) return
    const index = hover === null ? -1 : snapTimes.indexOf(hover)
    const last = snapTimes.length - 1
    const next: Record<string, number> = {
      ArrowRight: Math.min(index + 1, last),
      ArrowLeft: Math.max(index - 1, 0),
      Home: 0,
      End: last,
    }
    if (event.key === 'Escape') return setHover(null)
    if (event.key in next) {
      event.preventDefault()
      setHover(snapTimes[next[event.key]])
    }
  }

  const flip = hover !== null && x(hover) > innerW * 0.55

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
            {yTicks.map((tick) => (
              <g key={tick}>
                <line className="grid" x1={0} x2={innerW} y1={y(tick)} y2={y(tick)} />
                <text className="axis-label" x={-8} y={y(tick)} dy="0.32em" textAnchor="end">
                  {gwTick(tick)}
                </text>
              </g>
            ))}
            <text className="axis-label" x={-margin.left + 2} y={-10}>
              GW
            </text>
            <line className="baseline" x1={0} x2={innerW} y1={innerH} y2={innerH} />
            {labelledTicks.map((tick) => (
              <text key={tick} className="axis-label" x={x(tick)} y={innerH + 18} textAnchor="middle">
                {xLabel(tick)}
              </text>
            ))}

            {bandPath && <path d={bandPath} style={{ fill: band!.color }} />}

            {series.map((s) => (
              <path
                key={s.id}
                d={pathFor(s) ?? ''}
                className="series-line"
                style={{ stroke: s.color, opacity: s.opacity ?? 1, strokeDasharray: s.dash }}
              />
            ))}

            {series
              .filter((s) => s.endDot)
              .map((s) => {
                const last = [...s.points].reverse().find((p) => p.v !== null)
                if (!last || last.v === null) return null
                const endT = s.step ? last.t + stepMs : last.t
                return <circle key={s.id} className="dot" cx={x(endT)} cy={y(last.v)} r={4} style={{ fill: s.color }} />
              })}
            {endLabels.map((l) => (
              <text key={l.id} className="end-label" x={innerW + 12} y={l.y} dy="0.32em">
                {l.label}
              </text>
            ))}

            {hover !== null && (
              <g>
                <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={innerH} />
                {series.map((s) => {
                  const v = valueAt(s, hover)
                  return v === null ? null : (
                    <circle key={s.id} className="dot" cx={x(hover)} cy={y(v)} r={4} style={{ fill: s.color }} />
                  )
                })}
              </g>
            )}

            <rect
              x={0}
              y={0}
              width={innerW}
              height={innerH}
              fill="transparent"
              onPointerMove={onMove}
              onPointerDown={onMove}
            />
          </g>
        </svg>
      )}
      {hover !== null && (
        <div
          className="tip"
          role="status"
          style={{
            left: margin.left + x(hover),
            top: margin.top,
            transform: flip ? 'translateX(calc(-100% - 14px))' : 'translateX(14px)',
          }}
        >
          {tooltip(hover)}
        </div>
      )}
    </div>
  )
}
