import type { ReactNode } from 'react'

export const TipTitle = ({ children }: { children: ReactNode }) => <div className="tip-time">{children}</div>

/** One tooltip line: a short line-key in the series colour, then the value (strong) and what it is. */
export function TipRow({ color, value, label }: { color?: string; value: string; label: string }) {
  return (
    <div className="tip-row">
      <span className="tip-key" style={color ? { background: color } : undefined} aria-hidden="true" />
      <strong className="tip-v">{value}</strong>
      <span className="tip-l">{label}</span>
    </div>
  )
}

export const TipNote = ({ children }: { children: ReactNode }) => <p className="tip-note">{children}</p>
