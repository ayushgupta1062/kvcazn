import { gw, gwTick, mw, percent, plainDayMonth, plainShort, signedGw, signedMw, signedWhole, whole } from '../format'
import type { AccuracyResponse } from '../types'
import { ChartFrame } from './ChartFrame'
import { ColumnChart, type Column } from './ColumnChart'
import { Stats, type Stat } from './Stats'
import { TipNote, TipRow, TipTitle } from './Tip'

interface Props {
  data: AccuracyResponse
  cutoff: string
}

const EN = '–'
const orDash = (value: number | null, format: (n: number) => string) => (value === null ? EN : format(value))
const argMax = (columns: Column[]) => columns.reduce((a, b) => (b.value > a.value ? b : a))

export function AccuracyView({ data, cutoff }: Props) {
  const o = data.overall
  const reserve = data.riskBuffer.p90Mw
  const lean =
    o.bias === null || o.mae === null
      ? undefined
      : Math.abs(o.bias) < 0.1 * o.mae
        ? 'no steady lean high or low'
        : o.bias > 0
          ? 'forecasts run high'
          : 'forecasts run low'

  const tiles: Stat[] = [
    { label: 'Typical miss', value: orDash(o.mae, (v) => gw(v, 2)), unit: 'GW', note: 'mean absolute error' },
    { label: 'Big misses count extra', value: orDash(o.rmse, (v) => gw(v, 2)), unit: 'GW', note: 'root mean square error' },
    { label: 'Lean', value: orDash(o.bias, (v) => signedGw(v, 2)), unit: 'GW', note: lean },
    { label: 'Miss as share of wind', value: orDash(o.wape, (v) => percent(v, 1)), note: 'absolute error ÷ actual wind' },
    {
      label: 'Hours forecast too high',
      value: orDash(o.overForecastShare, (v) => percent(v * 100)),
      note: 'the side where you buy too little',
    },
    { label: 'Reserve to cover 9 in 10 hours', value: orDash(reserve, (v) => gw(v)), unit: 'GW', note: 'the shortfall 9 in 10 past hours stayed under' },
  ]

  // ---- miss by how early the forecast was issued
  const [fromH, toH] = data.decisionHorizonRangeH
  const horizon: Column[] = data.byHorizon.map((h) => ({
    key: h.label,
    value: h.mae ?? 0,
    emphasis: h.fromH < toH && h.toH > fromH,
    label: `${h.fromH}${EN}${h.toH}`,
    tip: (
      <>
        <TipTitle>
          Issued {h.fromH}
          {EN}
          {h.toH} hours ahead
        </TipTitle>
        <TipRow color="var(--forecast)" value={orDash(h.mae, mw)} label="Typical miss" />
        <TipRow value={orDash(h.rmse, mw)} label="RMSE" />
        <TipRow value={orDash(h.bias, signedMw)} label="Lean" />
        <TipNote>{whole(h.n)} hourly forecasts</TipNote>
      </>
    ),
  }))
  const marked = horizon.flatMap((c, i) => (c.emphasis ? [i] : []))
  const firstBucket = data.byHorizon[0]
  const lastBucket = data.byHorizon[data.byHorizon.length - 1]
  const horizonReading =
    firstBucket && lastBucket && firstBucket.mae !== null && lastBucket.mae !== null
      ? `From ${gw(firstBucket.mae)} GW when issued under ${firstBucket.toH} hours ahead to ${gw(lastBucket.mae)} GW at ${lastBucket.fromH}${EN}${lastBucket.toH} hours. A ${cutoff} gate means forecasts issued ${Math.floor(fromH)}${EN}${Math.ceil(toH)} hours ahead (highlighted).`
      : undefined

  // ---- distribution of misses
  const { binEdges: edges, counts } = data.histogram
  const q90 = data.errorQuantiles.p90
  const totalHours = counts.reduce((a, b) => a + b, 0)
  const histogram: Column[] = counts.map((count, i) => {
    const lo = edges[i]
    const hi = edges[i + 1]
    return {
      key: String(lo),
      value: count,
      emphasis: q90 !== null && lo >= q90,
      label: lo % 1000 === 0 ? gwTick(lo) : null,
      tip: (
        <>
          <TipTitle>
            {lo < 0 && hi <= 0
              ? `Forecast too low by ${gw(-hi, 1)}${EN}${gw(-lo, 1)} GW`
              : lo >= 0
                ? `Forecast too high by ${gw(lo, 1)}${EN}${gw(hi, 1)} GW`
                : `Within ${gw(-lo, 1)} GW low to ${gw(hi, 1)} GW high`}
          </TipTitle>
          <TipRow color="var(--forecast)" value={whole(count)} label="hours" />
          <TipNote>{percent((count / totalHours) * 100, 1)} of all hours</TipNote>
        </>
      ),
    }
  })
  const zeroEdge = edges.indexOf(0)
  const distributionReading =
    q90 !== null
      ? `In 9 of 10 hours the forecast was less than ${gw(Math.max(0, q90))} GW too high. The highlighted bars are the other 1 in 10, where wind fell furthest short.`
      : undefined

  // ---- by delivery day and by hour of day
  const days: Column[] = data.byDay.map((d, i) => ({
    key: d.deliveryDate,
    value: d.mae ?? 0,
    label: i === 0 || d.deliveryDate.endsWith('-01') ? plainDayMonth(d.deliveryDate) : String(Number(d.deliveryDate.slice(8))),
    tip: (
      <>
        <TipTitle>{plainShort(d.deliveryDate)}</TipTitle>
        <TipRow color="var(--forecast)" value={orDash(d.mae, mw)} label="Typical miss" />
        <TipRow value={orDash(d.rmse, mw)} label="RMSE" />
        <TipRow value={orDash(d.bias, signedMw)} label="Lean" />
        <TipNote>
          Forecast averaged {orDash(d.meanForecast, mw)}; actual {orDash(d.meanActual, mw)}.
        </TipNote>
      </>
    ),
  }))
  const worstDay = days.length ? argMax(days) : undefined
  const bestDay = days.length ? days.reduce((a, b) => (b.value < a.value ? b : a)) : undefined

  const hours: Column[] = data.byHour.map((h) => ({
    key: String(h.hour),
    value: h.mae ?? 0,
    label: String(h.hour).padStart(2, '0'),
    tip: (
      <>
        <TipTitle>
          {String(h.hour).padStart(2, '0')}:00{EN}{String((h.hour + 1) % 24).padStart(2, '0')}:00
        </TipTitle>
        <TipRow color="var(--forecast)" value={orDash(h.mae, mw)} label="Typical miss" />
        <TipRow value={orDash(h.rmse, mw)} label="RMSE" />
        <TipRow value={orDash(h.bias, signedMw)} label="Lean" />
        <TipNote>{whole(h.n)} hours scored</TipNote>
      </>
    ),
  }))
  const worstHour = hours.length ? argMax(hours) : undefined
  const bestHour = hours.length ? hours.reduce((a, b) => (b.value < a.value ? b : a)) : undefined

  return (
    <>
      <section className="hero hero-compact" aria-labelledby="acc-title">
        <div className="hero-main">
          <h2 id="acc-title" className="hero-label">
            How far off are the forecasts you could use?
          </h2>
          <p className="hero-note">
            {whole(o.n)} hourly forecasts across {data.byDay.length} January decisions, each using the newest forecast out at the {cutoff}{' '}
            gate. Positive misses mean wind fell short of the forecast.
          </p>
        </div>
      </section>

      <section className="section" aria-label="Headline accuracy numbers">
        <Stats items={tiles} />
      </section>

      <section className="section grid-2">
        <ChartFrame
          id="horizon"
          title="Miss by how early the forecast was issued"
          reading={horizonReading}
          table={{
            head: ['Issued (hours ahead)', 'Typical miss (MW)', 'RMSE (MW)', 'Lean (MW)', 'Hours scored'],
            rows: data.byHorizon.map((h) => [
              `${h.fromH}${EN}${h.toH}`,
              orDash(h.mae, whole),
              orDash(h.rmse, whole),
              orDash(h.bias, signedWhole),
              whole(h.n),
            ]),
          }}
        >
          <ColumnChart
            columns={horizon}
            tickFormat={gwTick}
            yUnit="GW"
            bracket={marked.length ? { from: marked[0], to: marked[marked.length - 1], label: `Where the ${cutoff} gate sits` } : undefined}
            capLabelKeys={horizon.length ? [horizon[0].key, horizon[horizon.length - 1].key] : []}
            capLabel={(c) => gw(c.value)}
            xTitle="Hours between issue and delivery hour"
            summary="Column chart of the typical forecast miss in gigawatts, grouped by how many hours before delivery the forecast was issued."
          />
        </ChartFrame>

        <ChartFrame
          id="distribution"
          title="How big, and which way, the misses were"
          reading={distributionReading}
          table={{
            head: ['Forecast minus actual (MW)', 'Hours', 'Share of hours'],
            rows: counts.map((count, i) => [
              `${signedWhole(edges[i])} to ${signedWhole(edges[i + 1])}`,
              whole(count),
              percent((count / totalHours) * 100, 1),
            ]),
          }}
        >
          <ColumnChart
            columns={histogram}
            tickFormat={(v) => whole(v)}
            yUnit="Hours"
            labelAt="edge"
            edgeLine={zeroEdge >= 0 ? { index: zeroEdge, label: 'No miss' } : undefined}
            capLabelKeys={histogram.length ? [argMax(histogram).key] : []}
            capLabel={(c) => whole(c.value)}
            xTitle="Forecast minus actual, GW. Right of zero: wind fell short."
            summary="Histogram of forecast minus actual wind in gigawatts, counting hours."
          />
        </ChartFrame>

        <ChartFrame
          id="days"
          title="Miss by delivery day"
          reading={
            worstDay && bestDay
              ? `Hardest day ${plainShort(worstDay.key)} at ${gw(worstDay.value)} GW; easiest ${plainShort(bestDay.key)} at ${gw(bestDay.value)} GW.`
              : undefined
          }
          table={{
            head: ['Delivery day', 'Typical miss (MW)', 'RMSE (MW)', 'Lean (MW)', 'Mean forecast (MW)', 'Mean actual (MW)'],
            rows: data.byDay.map((d) => [
              plainShort(d.deliveryDate),
              orDash(d.mae, whole),
              orDash(d.rmse, whole),
              orDash(d.bias, signedWhole),
              orDash(d.meanForecast, whole),
              orDash(d.meanActual, whole),
            ]),
          }}
        >
          <ColumnChart
            columns={days}
            tickFormat={gwTick}
            yUnit="GW"
            refLine={o.mae !== null ? { value: o.mae, label: `Average ${gw(o.mae)}` } : undefined}
            capLabelKeys={worstDay ? [worstDay.key] : []}
            capLabel={(c) => gw(c.value)}
            xTitle="Delivery day"
            summary="Column chart of the typical forecast miss in gigawatts for each delivery day."
          />
        </ChartFrame>

        <ChartFrame
          id="hours"
          title="Miss by hour of the day"
          reading={
            worstHour && bestHour
              ? `Largest around ${worstHour.label}:00 (${gw(worstHour.value)} GW), smallest around ${bestHour.label}:00 (${gw(bestHour.value)} GW).`
              : undefined
          }
          table={{
            head: ['Hour of day', 'Typical miss (MW)', 'RMSE (MW)', 'Lean (MW)', 'Hours scored'],
            rows: data.byHour.map((h) => [
              `${String(h.hour).padStart(2, '0')}:00`,
              orDash(h.mae, whole),
              orDash(h.rmse, whole),
              orDash(h.bias, signedWhole),
              whole(h.n),
            ]),
          }}
        >
          <ColumnChart
            columns={hours}
            tickFormat={gwTick}
            yUnit="GW"
            capLabelKeys={worstHour ? [worstHour.key] : []}
            capLabel={(c) => gw(c.value)}
            xTitle="Hour of delivery day, UK time"
            summary="Column chart of the typical forecast miss in gigawatts for each hour of the day."
          />
        </ChartFrame>
      </section>
    </>
  )
}
