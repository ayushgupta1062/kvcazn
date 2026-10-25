// Number and time formatting. All clock times are UK local time (Europe/London), as the market runs on it.

const TZ = 'Europe/London'
const MINUS = '−'
const WHOLE = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })

export const HOUR_MS = 3_600_000
export const MINUTE_MS = 60_000

// ---- numbers
const dash = (text: string) => text.replace('-', MINUS)

export const mw = (value: number) => `${dash(WHOLE.format(Math.round(value)))} MW`
export const signedMw = (value: number) => `${value > 0 ? '+' : ''}${dash(WHOLE.format(Math.round(value)))} MW`
export const gw = (valueMw: number, digits = 1) => dash((valueMw / 1000).toFixed(digits))
export const signedGw = (valueMw: number, digits = 1) =>
  `${valueMw > 0 ? '+' : ''}${dash((valueMw / 1000).toFixed(digits))}`
export const signedWhole = (value: number) => `${value > 0 ? '+' : ''}${dash(WHOLE.format(Math.round(value)))}`
export const percent = (value: number, digits = 0) => `${value.toFixed(digits)}%`
export const whole = (value: number) => dash(WHOLE.format(Math.round(value)))

/** Axis tick for a value in MW shown in GW: 0, 2.5, 5, 10 (no trailing .0). */
export const gwTick = (valueMw: number) => dash(String(Number((valueMw / 1000).toFixed(2))))

// ---- clock times for instants (ms since epoch or ISO string)
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayShortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
})

const toMs = (instant: string | number) => (typeof instant === 'string' ? Date.parse(instant) : instant)

export const clock = (instant: string | number) => clockFmt.format(toMs(instant))
export const dayShort = (instant: string | number) => dayShortFmt.format(toMs(instant))

function londonParts(ms: number) {
  const parts: Record<string, number> = {}
  for (const part of partsFmt.formatToParts(ms)) if (part.type !== 'literal') parts[part.type] = Number(part.value)
  return parts
}

/** Minutes since UK-local midnight for an instant. */
export function minutesIntoDay(instant: string | number): number {
  const p = londonParts(toMs(instant))
  return p.hour * 60 + p.minute
}

/** London wall-clock minus UTC, in ms, at the given instant (0 in winter, +1 h in summer). */
function londonOffsetMs(ms: number): number {
  const p = londonParts(ms)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** The UTC instant of UK-local midnight at the start of a YYYY-MM-DD date. */
export function localMidnightUtc(date: string): number {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`)
  return utcMidnight - londonOffsetMs(utcMidnight - londonOffsetMs(utcMidnight))
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

// ---- plain calendar dates (YYYY-MM-DD)
const plainShortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' })
const plainLongFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
const plainDayMonthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const noon = (date: string) => Date.parse(`${date}T12:00:00Z`)

export const plainShort = (date: string) => plainShortFmt.format(noon(date))
export const plainLong = (date: string) => plainLongFmt.format(noon(date))
export const plainDayMonth = (date: string) => plainDayMonthFmt.format(noon(date))

// ---- HH:MM strings
export const hhmmToMinutes = (text: string) => {
  const [h, m] = text.split(':').map(Number)
  return h * 60 + m
}
export const minutesToHhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Typed clock time to "HH:MM" (24-hour): "9:50", "0950", "09.50" all work. Anything else is null. */
export function parseClock(text: string): string | null {
  const match = /^\s*(\d{1,2})\s*[:.]?\s*(\d{2})\s*$/.exec(text)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours <= 23 && minutes <= 59 ? minutesToHhmm(hours * 60 + minutes) : null
}

/** "20 minutes", "1 h 50 min" */
export function duration(minutes: number): string {
  const total = Math.round(minutes)
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m ? `${h} h ${m} min` : `${h} h`
}
