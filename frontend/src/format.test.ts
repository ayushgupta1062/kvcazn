import { describe, expect, it } from 'vitest'
import {
  addDays, clock, duration, gw, gwTick, hhmmToMinutes, localMidnightUtc, minutesIntoDay, minutesToHhmm, parseClock, signedGw,
} from './format'

describe('numbers', () => {
  it('shows GW with a proper minus sign and explicit plus', () => {
    expect(gw(9412)).toBe('9.4')
    expect(gw(-1250)).toBe('−1.3')
    expect(signedGw(500)).toBe('+0.5')
    expect(signedGw(-500)).toBe('−0.5')
  })
  it('drops trailing zeros on axis ticks', () => {
    expect(gwTick(5000)).toBe('5')
    expect(gwTick(2500)).toBe('2.5')
    expect(gwTick(0)).toBe('0')
  })
})

describe('UK local time', () => {
  it('equals UTC in January and is an hour ahead in July', () => {
    expect(clock('2026-01-14T09:30:00Z')).toBe('09:30')
    expect(clock('2026-07-14T09:30:00Z')).toBe('10:30')
    expect(minutesIntoDay('2026-01-14T09:50:00Z')).toBe(590)
  })
  it('finds local midnight, including across the clock change', () => {
    expect(new Date(localMidnightUtc('2026-01-15')).toISOString()).toBe('2026-01-15T00:00:00.000Z')
    expect(new Date(localMidnightUtc('2026-07-15')).toISOString()).toBe('2026-07-14T23:00:00.000Z')
  })
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('HH:MM helpers', () => {
  it('round-trips', () => {
    expect(hhmmToMinutes('09:50')).toBe(590)
    expect(minutesToHhmm(590)).toBe('09:50')
    expect(minutesToHhmm(0)).toBe('00:00')
  })
  it('reads typed 24-hour times and rejects the rest', () => {
    expect(parseClock('09:50')).toBe('09:50')
    expect(parseClock('9:50')).toBe('09:50')
    expect(parseClock('0950')).toBe('09:50')
    expect(parseClock('950')).toBe('09:50')
    expect(parseClock(' 23.59 ')).toBe('23:59')
    for (const bad of ['', '24:00', '09:60', '9:5', '12:3', 'ab:cd', '09:50 PM']) expect(parseClock(bad)).toBeNull()
  })
  it('words a duration', () => {
    expect(duration(20)).toBe('20 min')
    expect(duration(110)).toBe('1 h 50 min')
    expect(duration(120)).toBe('2 h')
  })
})
