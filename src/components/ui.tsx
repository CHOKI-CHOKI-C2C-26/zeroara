import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, X, Copy, Check, CheckCircle2, CircleDot, Circle } from 'lucide-react';

/* Neumorphic progressive-disclosure primitives: a single-select dropdown, a
   collapsible accordion, a modal drawer, status badges, key/value rows, a hash
   block with copy, and a verification-checklist row. */

export type Tone = 'ok' | 'active' | 'muted' | 'warn';
const toneClass = (t: Tone) =>
  t === 'ok' ? 'neu-tone-ok' : t === 'active' ? 'neu-tone-active' : t === 'warn' ? 'neu-tone-warn' : 'neu-tone-muted';

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {label && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--fg-muted)' }}>{label}</span>}
      <span className="neu-select-wrap">
        <select className="neu-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="neu-select-chevron" />
      </span>
    </label>
  );
}

export function Accordion({
  title,
  summary,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && containerRef.current) {
      const timer = setTimeout(() => {
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  return (
    <div className="neu-accordion" ref={containerRef}>
      <button type="button" className="neu-accordion-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {icon}
          <span>{title}</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {summary && (
            <span className="neu-hash-pill" style={{ fontSize: '0.7rem' }}>
              {summary}
            </span>
          )}
          <ChevronDown
            size={15}
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease', color: 'var(--fg-muted)' }}
          />
        </span>
      </button>
      {open && <div className="neu-accordion-body">{children}</div>}
    </div>
  );
}

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="neu-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="neu-drawer">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '1rem', color: 'var(--fg-primary)' }}>{title}</span>
          <button type="button" className="neu-pill-btn" style={{ padding: '6px 10px', display: 'flex' }} onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusBadge({ tone, children, tourId }: { tone: Tone; children: React.ReactNode; tourId?: string }) {
  return (
    <span className={`neu-claim-badge ${toneClass(tone)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} data-tour={tourId}>
      {children}
    </span>
  );
}

export function KV({ label, value, mono = true }: { label: React.ReactNode; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="neu-kv">
      <span className="neu-kv-label">{label}</span>
      <span className="neu-kv-value" style={mono ? undefined : { fontFamily: 'var(--font-body)' }}>
        {value}
      </span>
    </div>
  );
}

export function HashBlock({
  value,
  placeholder,
  onCopy,
  copied,
  small,
}: {
  value?: string | null;
  placeholder?: string;
  onCopy?: () => void;
  copied?: boolean;
  small?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div className="neu-code-block" style={{ fontSize: small ? '0.72rem' : '0.78rem', color: value ? 'var(--fg-primary)' : 'var(--fg-muted)' }}>
        {value || placeholder || '—'}
      </div>
      {onCopy && value && (
        <button
          type="button"
          className="neu-pill-btn"
          style={{ alignSelf: 'flex-end', fontSize: '0.7rem', padding: '3px 9px', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={onCopy}
        >
          {copied ? <Check size={12} className="neu-tone-ok" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      )}
    </div>
  );
}

export function ChecklistItem({
  index,
  title,
  detail,
  state,
  current,
  onClick,
  disabled,
}: {
  index: number;
  title: string;
  detail: React.ReactNode;
  state: 'done' | 'active' | 'pending' | 'skipped';
  current: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const tone: Tone = state === 'done' ? 'ok' : state === 'active' ? 'active' : 'muted';
  const Icon = state === 'done' ? CheckCircle2 : state === 'active' ? CircleDot : Circle;
  return (
    <button type="button" className={`neu-check-item ${current ? 'current' : ''}`} onClick={onClick} disabled={disabled} aria-current={current ? 'step' : undefined}>
      <span className={`neu-check-icon ${toneClass(tone)}`}>
        <Icon size={16} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: 1 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '0.82rem', color: 'var(--fg-primary)' }}>
          <span style={{ color: 'var(--fg-dim)', fontFamily: 'var(--font-mono)', marginRight: '8px' }}>{index}</span>
          {title}
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
      </span>
    </button>
  );
}

/** Horizontal stepper node: all stages visible at once in a single strip. */
export function StepItem({
  index,
  title,
  detail,
  state,
  current,
  onClick,
  disabled,
  tourId,
}: {
  index: number;
  title: string;
  detail: React.ReactNode;
  state: 'done' | 'active' | 'pending' | 'skipped';
  current: boolean;
  onClick?: () => void;
  disabled?: boolean;
  tourId?: string;
}) {
  const tone: Tone = state === 'done' ? 'ok' : state === 'active' ? 'active' : 'muted';
  const Icon = state === 'done' ? CheckCircle2 : state === 'active' ? CircleDot : Circle;
  return (
    <button type="button" className={`neu-step-item ${current ? 'current' : ''}`} onClick={onClick} disabled={disabled} aria-current={current ? 'step' : undefined} data-tour={tourId}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <span className={`neu-check-icon ${toneClass(tone)}`} style={{ width: '22px', height: '22px' }}>
          <Icon size={13} />
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--fg-dim)' }}>0{index}</span>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '0.76rem',
            color: current ? 'var(--accent)' : 'var(--fg-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </span>
      </span>
      <span style={{ fontSize: '0.66rem', color: 'var(--fg-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</span>
    </button>
  );
}
