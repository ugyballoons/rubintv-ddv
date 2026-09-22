import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export type MenuItem =
  | { label: string; onClick(): void; disabled?: boolean; hint?: string; title?: string }
  | { separator: true }
  | { heading: string };

export function Menu({
  label,
  icon,
  items,
  disabled,
}: {
  label: string;
  icon?: string;
  items: MenuItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
      >
        {icon && <Icon name={icon} />}
        {label} ▾
      </button>
      {open && (
        <ul role="menu">
          {items.map((it, i) =>
            'separator' in it ? (
              <li key={i} role="separator" />
            ) : 'heading' in it ? (
              <li key={i} role="presentation" className="heading meta">
                {it.heading}
              </li>
            ) : (
              <li key={i} role="none">
                <button
                  role="menuitem"
                  disabled={it.disabled}
                  title={it.title}
                  onClick={() => {
                    setOpen(false);
                    it.onClick();
                  }}
                >
                  <span className="label">{it.label}</span>
                  {it.hint && <span className="hint meta">{it.hint}</span>}
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
