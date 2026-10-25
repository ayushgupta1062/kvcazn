import { useMemo } from 'react'
import {
  addDays, clock, dayShort, duration, gw, HOUR_MS, localMidnightUtc, mw, plainLong, plainShort, signedMw, signedWhole, whole,
} from '../format'
import type { DecisionResponse } from '../types'
import { ChartFrame, type LegendItem } from './ChartFrame'
import { GateStrip } from './GateStrip'
import { LineChart, type LineSeries } from './LineChart'
import { TipNote, TipRow, TipTitle } from './Tip'

interface Props {
  view: DecisionResponse
  cutoff: string
  onCutoff: (cutoff: string) => void
}

const range = (values: number[]) => `${whole(Math.min(...values))}–${whole(Math.max(...values))} MW`

export function DecisionView({ view, cutoff, onCutoff }: Props) {
  const { summary, points } = view
  const dataGate = view.cutoffLocal.slice(11, 16) // the gate this data was computed for (cutoff may be mid-drag)
  const peak = points.reduce((a, b) => (b.forecastMw > a.forecastMw ? b : a))
  const low = points.reduce((a, b) => (b.forecastMw < a.forecastMw ? b : a))
  const reserve = view.errorBandQuantiles ? Math.max(0, view.errorBandQuantiles.p90) : null

  const dayStart = localMidnightUtc(view.deliveryDate)
  const dayEnd = localMidnightUtc(addDays(view.deliveryDate, 1))
  const xTicks = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => dayStart + h * HOUR_MS)
  const xLabel = (t: number) => (t >= dayEnd ? '24:00' : clock(t))

  const forecast = useMemo(() => {
    const rows = points.map((p) => ({ ...p, t: Date.parse(p.startTime) }))
    return { rows, byTime: new Map(rows.map((r) => [r.t, r])) }
  }, [points])
  const actual = useMemo(() => {
    const rows = view.actualHalfHourly.map((a) => ({ t: Date.parse(a.startTime), v: a.actualMw }))
    return { rows, byTime: new Map(rows.map((r) => [r.t, r.v])) }
  }, [view.actualHalfHourly])

  const snapTimes = useMemo(
    () => [...new Set([...forecast.rows.map((r) => r.t), ...actual.rows.map((r) => r.t)])].sort((a, b) => a - b),
    [forecast, actual],
  )

  const heldForecast = (t: number) => forecast.rows.reduce((found, r) => (r.t <= t ? r : found), forecast.rows[0])

  const forecastSeries: LineSeries[] = [
    {
      id: 'forecast',
      label: 'Forecast',
      color: 'var(--forecast)',
      step: true,
      endDot: true,
      points: forecast.rows.map((r) => ({ t: r.t, v: r.forecastMw })),
    },
    { id: 'actual', label: 'Actual', color: 'var(--actual)', endDot: true, points: actual.rows },
  ]
  const band =
    view.errorBandQuantiles && forecast.rows.every((r) => r.bandLowMw !== null)
      ? { color: 'var(--forecast-wash)', points: forecast.rows.map((r) => ({ t: r.t, lo: r.bandLowMw!, hi: r.bandHighMw! })) }
      : undefined

  const forecastLegend: LegendItem[] = [
    { label: 'Forecast you could use', color: 'var(--forecast)', kind: 'line' },
    { label: 'Actual (known only after the day)', color: 'var(--actual)', kind: 'line' },
    ...(band ? [{ label: 'Where 8 in 10 past hours landed', color: 'var(--forecast-wash)', kind: 'band' as const }] : []),
  ]

  const dayMetrics = summary.metrics
  const reading =
    dayMetrics && summary.actualMeanMw !== null && dayMetrics.mae !== null
      ? `The forecast averaged ${gw(summary.forecastMeanMw)} GW against ${gw(summary.actualMeanMw)} GW actual, missing by ${gw(dayMetrics.mae)} GW in a typical hour.`
      : 'Actual generation for this day is not available yet.'

  const forecastTable = {
    head: ['Hour', 'Forecast (MW)', 'Actual (MW)', 'Miss (MW)', 'Range low (MW)', 'Range high (MW)', 'Issued'],
    rows: forecast.rows.map((r) => [
      clock(r.t),
      whole(r.forecastMw),
      r.actualMw === null ? '–' : whole(r.actualMw),
      r.errorMw === null ? '–' : signedWhole(r.errorMw),
      r.bandLowMw === null ? '–' : whole(r.bandLowMw),
      r.bandHighMw === null ? '–' : whole(r.bandHighMw),
      clock(r.publishTime),
    ]),
  }

  // ---- how the forecast was revised around the gate
  const versions = useMemo(
    () =>
      view.vintages
        .map((v) => ({
          ...v,
          rows: v.points.map((p) => ({ t: Date.parse(p.startTime), v: p.forecastMw })),
        }))
        .sort((a, b) => Date.parse(a.publishTime) - Date.parse(b.publishTime)),
    [view.vintages],
  )
  // The chart stays readable by drawing the version used and the two issued either side of it; the
  // table beside it lists every version.
  const nearby = useMemo(() => {
    const at = versions.findIndex((v) => v.used)
    return at < 0 ? versions : versions.filter((_, i) => Math.abs(i - at) <= 2)
  }, [versions])
  const meanOf = (v: (typeof versions)[number]) => v.rows.reduce((sum, r) => sum + r.v, 0) / v.rows.length
  const usedVersion = versions.find((v) => v.used)
  const nextVersion = versions.find((v) => !v.available)
  const revisionReading = (() => {
    if (!usedVersion || !nextVersion) return 'Each line is one forecast version. Dashed lines were issued after the gate, so you could not have had them.'
    const delta = meanOf(nextVersion) - meanOf(usedVersion)
    const change = Math.abs(delta) < 50 ? 'about the same' : `${gw(Math.abs(delta))} GW ${delta > 0 ? 'higher' : 'lower'}`
    return `The version you used averages ${gw(meanOf(usedVersion))} GW. The next one, issued at ${clock(nextVersion.publishTime)} after the gate, averages ${gw(meanOf(nextVersion))} GW (${change}) and was not available to you.`
  })()
  const revisionSeries: LineSeries[] = [...nearby]
    .sort((a, b) => Number(a.used) - Number(b.used)) // the version used is drawn last, on top
    .map((v) => ({
      id: v.publishTime,
      label: `Issued ${clock(v.publishTime)}`,
      color: v.used ? 'var(--forecast)' : 'var(--ctx)',
      dash: v.available ? undefined : '5 4',
      opacity: v.used ? 1 : v.available ? 0.75 : 0.65,
      step: true,
      endDot: v.used,
      points: v.rows,
    }))
  const revisionLegend: LegendItem[] = [
    { label: 'Version you used', color: 'var(--forecast)', kind: 'line' },
    { label: 'Issued earlier', color: 'var(--ctx)', kind: 'line' },
    { label: 'Issued after the gate (not usable)', color: 'var(--ctx)', kind: 'dash' },
  ]
  const hourTimes = forecast.rows.map((r) => r.t)

  const revisionTooltip = (t: number) => {
    const at = (rows: { t: number; v: number }[]) => rows.find((r) => r.t === t)?.v
    const pick = (filter: (v: (typeof versions)[number]) => boolean) =>
      nearby.filter(filter).flatMap((v) => at(v.rows) ?? [])
    const used = pick((v) => v.used)
    const earlier = pick((v) => v.available && !v.used)
    const later = pick((v) => !v.available)
    return (
      <>
        <TipTitle>
          {dayShort(t)}, {clock(t)}
        </TipTitle>
        {used.length > 0 && usedVersion && (
          <TipRow color="var(--forecast)" value={mw(used[0])} label={`Used, issued ${clock(usedVersion.publishTime)}`} />
        )}
        {earlier.length > 0 && <TipRow color="var(--ctx)" value={range(earlier)} label={`${earlier.length} issued earlier`} />}
        {later.length > 0 && <TipRow color="var(--ctx)" value={range(later)} label={`${later.length} after the gate`} />}
      </>
    )
  }

  const revisionTable = {
    head: ['Issued', 'Status', 'Mean (MW)', 'Lowest hour (MW)', 'Highest hour (MW)'],
    rows: versions.map((v) => {
      const values = v.rows.map((r) => r.v)
      return [
        `${dayShort(v.publishTime)} ${clock(v.publishTime)}`,
        v.used ? 'Used' : v.available ? 'Earlier' : 'After the gate',
        whole(values.reduce((a, b) => a + b, 0) / values.length),
        whole(Math.min(...values)),
        whole(Math.max(...values)),
      ]
    }),
  }

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-main">
          <h2 id="hero-title" className="hero-label">
            Wind to count on for {plainLong(view.deliveryDate)}
          </h2>
          <p className="hero-figure">
            {gw(summary.forecastMeanMw)}
            <span className="hero-unit">GW</span>
          </p>
          <p className="hero-note">
            Average over the day, from the forecast issued at {clock(view.latestPublishTime)} on {plainShort(view.decisionDate)},{' '}
            {duration(view.forecastAgeMinutes)} before the {dataGate} gate.
          </p>
        </div>
        <dl className="hero-facts">
          <div>
            <dt>Highest hour</dt>
            <dd>
              {gw(peak.forecastMw)} GW <span>at {clock(peak.startTime)}</span>
            </dd>
          </div>
          <div>
            <dt>Lowest hour</dt>
            <dd>
              {gw(low.forecastMw)} GW <span>at {clock(low.startTime)}</span>
            </dd>
          </div>
          <div>
            <dt>Energy over the day</dt>
            <dd>
              {whole(summary.forecastEnergyMwh / 1000)} GWh
            </dd>
          </div>
          {reserve !== null && (
            <div>
              <dt>Reserve for a shortfall</dt>
              <dd>
                {gw(reserve)} GW <span>covered 9 in 10 past hours</span>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="section" aria-labelledby="gate-title">
        <div className="section-head">
          <h2 id="gate-title">Forecasts issued before the gate closes</h2>
          <p className="reading">Drag the gate, or use the arrow keys, to see how the forecast you could have used changes.</p>
        </div>
        <GateStrip
          decisionDate={view.decisionDate}
          publishTimes={view.publishTimesOnDecisionDay}
          fallbackPublish={view.latestPublishTime}
          cutoff={cutoff}
          onCutoff={onCutoff}
        />
      </section>

      <section className="section">
        <ChartFrame
          id="forecast"
          title={`Wind forecast for ${plainShort(view.deliveryDate)}`}
          reading={reading}
          legend={forecastLegend}
          table={forecastTable}
        >
          <LineChart
            series={forecastSeries}
            band={band}
            domain={[dayStart, dayEnd]}
            stepMs={HOUR_MS}
            xTicks={xTicks}
            xLabel={xLabel}
            snapTimes={snapTimes}
            summary={`Line chart of forecast and actual wind generation in gigawatts for ${plainLong(view.deliveryDate)}.`}
            tooltip={(t) => {
              const f = heldForecast(t)
              const a = actual.byTime.get(t)
              const exact = forecast.byTime.get(t)
              return (
                <>
                  <TipTitle>
                    {dayShort(t)}, {clock(t)}
                  </TipTitle>
                  <TipRow color="var(--forecast)" value={mw(f.forecastMw)} label={`Forecast, issued ${clock(f.publishTime)}`} />
                  {a !== undefined && <TipRow color="var(--actual)" value={mw(a)} label="Actual" />}
                  {exact?.errorMw != null && (
                    <TipRow value={signedMw(exact.errorMw)} label={exact.errorMw > 0 ? 'Forecast too high' : 'Forecast too low'} />
                  )}
                  {f.bandLowMw !== null && f.bandHighMw !== null && (
                    <TipNote>
                      8 in 10 past hours landed between {mw(f.bandLowMw)} and {mw(f.bandHighMw)}.
                    </TipNote>
                  )}
                </>
              )
            }}
          />
        </ChartFrame>
      </section>

      <section className="section">
        <ChartFrame
          id="revisions"
          title="How the forecast for this day changed around the gate"
          reading={revisionReading}
          legend={revisionLegend}
          table={revisionTable}
        >
          <LineChart
            series={revisionSeries}
            domain={[dayStart, dayEnd]}
            stepMs={HOUR_MS}
            xTicks={xTicks}
            xLabel={xLabel}
            snapTimes={hourTimes}
            height={260}
            summary={`Line chart of ${nearby.length} forecast versions for ${plainLong(view.deliveryDate)}, in gigawatts.`}
            tooltip={revisionTooltip}
          />
        </ChartFrame>
      </section>
    </>
  )
}
