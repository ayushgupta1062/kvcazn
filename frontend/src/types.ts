// Shapes returned by the FastAPI backend (see backend/app/schemas.py). JSON is camelCase.

export type Alignment = 'exact' | 'hourly_mean'

export interface Metrics {
  n: number
  mae: number | null
  rmse: number | null
  bias: number | null
  wape: number | null
  mape: number | null
  r2: number | null
  p50AbsError: number | null
  p90AbsError: number | null
  p95AbsError: number | null
  maxAbsError: number | null
  overForecastShare: number | null
}

export interface MetaResponse {
  dataSource: 'elexon' | 'synthetic'
  fetchedAtUtc: string | null
  timezone: string
  decisionStart: string
  decisionEnd: string
  daysBefore: number
  defaultCutoff: string
  cutoffPresets: { time: string; name: string; label: string }[]
  alignments: { value: Alignment; label: string }[]
  decisionDays: { decisionDate: string; deliveryDate: string }[]
  actualRows: number
  forecastRows: number
  forecastVersions: number
}

export interface DecisionPoint {
  startTime: string
  forecastMw: number
  publishTime: string
  horizonH: number
  actualMw: number | null
  errorMw: number | null
  bandLowMw: number | null
  bandHighMw: number | null
}

export interface Vintage {
  publishTime: string
  available: boolean
  used: boolean
  points: { startTime: string; forecastMw: number }[]
}

export interface DecisionResponse {
  decisionDate: string
  deliveryDate: string
  cutoffUtc: string
  cutoffLocal: string
  publishTimesUsed: string[]
  publishTimesOnDecisionDay: string[]
  latestPublishTime: string
  forecastAgeMinutes: number
  points: DecisionPoint[]
  actualHalfHourly: { startTime: string; actualMw: number }[]
  summary: {
    forecastMeanMw: number
    forecastMinMw: number
    forecastMaxMw: number
    forecastEnergyMwh: number
    actualMeanMw: number | null
    actualEnergyMwh: number | null
    metrics: Metrics | null
  }
  errorBandQuantiles: { p10: number; p90: number } | null
  vintages: Vintage[]
}

export interface DayMetrics {
  deliveryDate: string
  n: number
  mae: number | null
  rmse: number | null
  bias: number | null
  meanForecast: number | null
  meanActual: number | null
}

export interface HourMetrics {
  hour: number
  n: number
  mae: number | null
  rmse: number | null
  bias: number | null
}

export interface HorizonMetrics {
  label: string
  fromH: number
  toH: number
  n: number
  mae: number | null
  rmse: number | null
  bias: number | null
}

export interface AccuracyResponse {
  cutoff: string
  alignment: Alignment
  overall: Metrics
  errorQuantiles: Record<string, number | null>
  riskBuffer: { p90Mw: number | null; p95Mw: number | null }
  byDay: DayMetrics[]
  byHour: HourMetrics[]
  byHorizon: HorizonMetrics[]
  histogram: { binEdges: number[]; counts: number[] }
  decisionHorizonRangeH: [number, number]
}
