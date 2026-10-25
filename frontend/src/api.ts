import type { AccuracyResponse, Alignment, DecisionResponse, MetaResponse } from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function get<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const query = new URLSearchParams(params).toString()
  const response = await fetch(query ? `${path}?${query}` : path, { signal })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : response.statusText
    throw new ApiError(response.status, detail)
  }
  return response.json() as Promise<T>
}

export const getMeta = (signal?: AbortSignal) => get<MetaResponse>('/api/meta', {}, signal)

export const getDecision = (decisionDate: string, cutoff: string, alignment: Alignment, signal?: AbortSignal) =>
  get<DecisionResponse>('/api/decision', { decisionDate, cutoff, alignment }, signal)

export const getAccuracy = (cutoff: string, alignment: Alignment, signal?: AbortSignal) =>
  get<AccuracyResponse>('/api/accuracy', { cutoff, alignment }, signal)
