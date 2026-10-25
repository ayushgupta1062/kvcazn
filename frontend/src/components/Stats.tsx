export interface Stat {
  label: string
  value: string
  unit?: string
  note?: string
}

/** A row of headline numbers. Label, value, and a plain-language note. */
export function Stats({ items }: { items: Stat[] }) {
  return (
    <dl className="stats">
      {items.map((s) => (
        <div className="stat" key={s.label}>
          <dt>{s.label}</dt>
          <dd className="stat-value">
            {s.value}
            {s.unit && <span className="stat-unit"> {s.unit}</span>}
          </dd>
          {s.note && <dd className="stat-note">{s.note}</dd>}
        </div>
      ))}
    </dl>
  )
}
