import { useEffect, useState } from 'react'
import { getAccuracy, getDecision, getMeta } from './api'
import { AccuracyView } from './components/AccuracyView'
import { DecisionView } from './components/DecisionView'
import { FilterBar } from './components/FilterBar'
import { MethodView } from './components/MethodView'
import { useDebounced, useResource, type Resource } from './hooks'
import type { Alignment } from './types'

type Tab = 'decision' | 'accuracy' | 'method'

const TABS: { id: Tab; label: string }[] = [
  { id: 'decision', label: 'Decision' },
  { id: 'accuracy', label: 'Forecast accuracy' },
  { id: 'method', label: 'Method' },
]

/** Settings live in the URL so any view can be bookmarked or shared. */
function readUrl() {
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('tab')
  const date = q.get('date')
  const gate = q.get('gate')
  return {
    tab: (tab === 'accuracy' || tab === 'method' ? tab : 'decision') as Tab,
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    gate: gate && /^([01]\d|2[0-3]):[0-5]\d$/.test(gate) ? gate : undefined,
    match: (q.get('match') === 'hourly_mean' ? 'hourly_mean' : 'exact') as Alignment,
  }
}
const initial = readUrl()

function Status({ resource, children }: { resource: Resource<unknown>; children: React.ReactNode }) {
  if (resource.error) {
    return (
      <div className="status error" role="alert">
        <strong>Can't show this.</strong> {resource.error}
      </div>
    )
  }
  if (!resource.data) return <p className="status">Loading…</p>
  return <>{children}</>
}

export default function App() {
  const [tab, setTab] = useState<Tab>(initial.tab)
  const [dateChoice, setDate] = useState(initial.date)
  const [gateChoice, setGate] = useState(initial.gate)
  const [alignment, setAlignment] = useState<Alignment>(initial.match)

  const meta = useResource((signal) => getMeta(signal), [])
  const m = meta.data
  // a date from an old or hand-edited link that is outside January falls back to the default day
  const date =
    dateChoice && m?.decisionDays.some((d) => d.decisionDate === dateChoice)
      ? dateChoice
      : m?.decisionDays[Math.min(14, m.decisionDays.length - 1)]?.decisionDate
  const gate = gateChoice ?? m?.defaultCutoff
  const settledGate = useDebounced(gate, 120)

  const decision = useResource(
    m && date && settledGate ? (signal) => getDecision(date, settledGate, alignment, signal) : null,
    [m, date, settledGate, alignment],
  )
  const accuracy = useResource(
    m && settledGate ? (signal) => getAccuracy(settledGate, alignment, signal) : null,
    [m, settledGate, alignment],
  )

  useEffect(() => {
    if (!m || !date || !gate) return
    window.history.replaceState(null, '', `?${new URLSearchParams({ tab, date, gate, match: alignment })}`)
  }, [m, tab, date, gate, alignment])

  const active = tab === 'decision' ? decision : tab === 'accuracy' ? accuracy : undefined
  const stale = Boolean(active?.loading && active.data)

  return (
    <div className="plane">
      <div className="sheet">
        <header className="masthead">
          <div>
            <h1>Day-ahead wind desk</h1>
            <p className="tagline">Great Britain wind, from Elexon data, for purchase decisions made in January 2026</p>
          </div>
          <nav aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="nav-item"
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {m?.dataSource === 'synthetic' && (
          <div className="banner" role="note">
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M10 2.5 18.5 17h-17z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M10 8v4.2M10 14.2v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <p>
              <strong>Demo data.</strong> These numbers are synthetic, for development only. Run <code>python -m app.ingest</code> to load
              real Elexon data.
            </p>
          </div>
        )}

        {meta.error && (
          <div className="status error" role="alert">
            <strong>The API isn't reachable.</strong> {meta.error}
          </div>
        )}
        {!m && !meta.error && <p className="status">Loading…</p>}

        {m && date && gate && (
          <>
            <FilterBar
              meta={m}
              showDate={tab === 'decision'}
              showAlignment={tab !== 'method'}
              date={date}
              cutoff={gate}
              alignment={alignment}
              onDate={setDate}
              onCutoff={setGate}
              onAlignment={setAlignment}
            />
            <main className={`view${stale ? ' is-stale' : ''}`} aria-busy={stale}>
              {tab === 'decision' && (
                <Status resource={decision}>
                  {decision.data && <DecisionView view={decision.data} cutoff={gate} onCutoff={setGate} />}
                </Status>
              )}
              {tab === 'accuracy' && (
                <Status resource={accuracy}>
                  {accuracy.data && <AccuracyView data={accuracy.data} cutoff={settledGate ?? gate} />}
                </Status>
              )}
              {tab === 'method' && <MethodView meta={m} decision={decision.data} cutoff={gate} />}
            </main>
          </>
        )}

        <footer className="footer">
          <p>
            Data: Elexon BMRS, FUELHH (actual wind) and WINDFOR (forecast wind). Times are UK local time.
          </p>
          <p>
            Contains BMRS data © Elexon Limited copyright and database right 2026, used under the{' '}
            <a
              href="https://www.elexon.co.uk/data/balancing-mechanism-reporting-agent/copyright-licence-bmrs-data/"
              target="_blank"
              rel="noopener noreferrer"
            >
              BMRS open data licence
            </a>
            . Elexon does not endorse this portal.
          </p>
        </footer>
      </div>
    </div>
  )
}
