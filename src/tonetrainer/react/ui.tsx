import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Small native primitives. If the host has its own Dialog / SegmentedControl / Switch / Slider,
 * replace these one-to-one: the props are deliberately minimal.
 */

/** Wrapper around the native <dialog>: focus trap, Esc and top layer come for free. */
export function Dialog({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`tt-dialog ${wide ? 'tt-dialog--wide' : ''}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="tt-dialog__frame">
        <header className="tt-dialog__header">
          <h2 id={titleId} className="tt-dialog__title">
            {title}
          </h2>
          <button className="tt-icon-btn" onClick={onClose} aria-label="Schließen">
            <X size={20} />
          </button>
        </header>
        <div className="tt-dialog__body">{open && children}</div>
      </div>
    </dialog>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  stretch = false,
}: {
  value: T | null
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
  stretch?: boolean
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`tt-seg tt-seg--${size} ${stretch ? 'tt-seg--stretch' : ''}`}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)} className="tt-seg__item">
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="tt-field tt-field--row">
      <span>
        <span className="tt-field__label">{label}</span>
        {hint && <span className="tt-field__hint">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="tt-switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  hint,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format: (v: number) => string
  onChange: (v: number) => void
  hint?: string
}) {
  return (
    <label className="tt-field">
      <span className="tt-field__top">
        <span className="tt-field__label">{label}</span>
        <span className="tt-field__value">{format(value)}</span>
      </span>
      {hint && <span className="tt-field__hint">{hint}</span>}
      <input type="range" className="tt-range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
