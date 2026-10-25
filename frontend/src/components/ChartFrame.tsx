import { useState, type CSSProperties, type ReactNode } from 'react'

export interface LegendItem {
  label: string
  color: string
  kind: 'line' | 'dash' | 'swatch' | 'band'
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.label}>
          <span className={`key key-${item.kind}`} style={{ '--k': item.color } as CSSProperties} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export interface TableData {
  head: string[]
  rows: string[][]
}

interface Props {
  id: string
  title: string
  reading?: ReactNode
  legend?: LegendItem[]
  table: TableData
  children: ReactNode
}

/** A chart with its title, a one-line reading, a legend, and a table twin of the same numbers. */
export function ChartFrame({ id, title, reading, legend, table, children }: Props) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  return (
    <section className="frame" aria-labelledby={`${id}-title`}>
      <div className="frame-head">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          {reading && <p className="reading">{reading}</p>}
        </div>
        <div className="seg" role="group" aria-label={`${title}: view`}>
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>
            Chart
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>
            Table
          </button>
        </div>
      </div>
      {view === 'chart' ? (
        <>
          {legend && <Legend items={legend} />}
          {children}
        </>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={`${title}: data table`}>
          <table className="data">
            <thead>
              <tr>
                {table.head.map((h, i) => (
                  <th key={h} scope="col" className={i === 0 ? 'first' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className={c === 0 ? 'first' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
