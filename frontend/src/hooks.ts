import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

export interface Resource<T> {
  data?: T
  error?: string
  loading: boolean
}

/**
 * Load something when `deps` change. While reloading, the previous data stays available (`loading` is
 * true) so the screen keeps its frame. Pass null to stay idle.
 */
export function useResource<T>(load: ((signal: AbortSignal) => Promise<T>) | null, deps: unknown[]): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ loading: load !== null })
  useEffect(() => {
    if (!load) return
    const controller = new AbortController()
    setState((previous) => ({ data: previous.data, loading: true }))
    load(controller.signal).then(
      (data) => setState({ data, loading: false }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({ error: error instanceof Error ? error.message : String(error), loading: false })
      },
    )
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

/** Follow a value, but only after it has been stable for `ms` (keeps dragging the gate from spamming the API). */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** Width in px of an element, kept current as it resizes. Measured before paint, so nothing flashes at width 0. */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    setWidth(Math.round(element.getBoundingClientRect().width))
    return () => observer.disconnect()
  }, [ref])
  return width
}
