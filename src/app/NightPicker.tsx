import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DdvClient } from '../protocol/client';
import {
  NO_NIGHTS,
  dateToNight,
  describeNights,
  isoToNight,
  nightList,
  nightToDate,
  nightToIso,
  type NightSelection,
} from '../model/nights';
import { useNightCounts } from '../hooks/useNightCounts';
import { useWorkspace } from '../store/workspace';
import { Icon } from './Icon';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The toolbar's night filter. Opens a calendar that marks nights with
 * exposures (count on hover). Click picks one night, shift-click extends to a
 * range from the anchor, cmd/ctrl-click toggles a night in a set. A text box
 * accepts YYYY-MM-DD or YYYYMMDD.
 */
export function NightPicker({ client }: { client: DdvClient }) {
  const database = useWorkspace((s) => s.instrument?.database ?? null);
  const nights = useWorkspace((s) => s.globalQuery.nights);
  const setGlobalQuery = useWorkspace((s) => s.setGlobalQuery);
  const { counts, loading, error } = useNightCounts(client, database);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [text, setText] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  const selected = useMemo(() => new Set(nightList(nights)), [nights]);
  const latest = useMemo(
    () => (counts ? Math.max(...Object.keys(counts).map(Number)) : null),
    [counts],
  );
  const initialMonth = () => {
    const n =
      nights.kind === 'single'
        ? nights.night
        : nights.kind === 'range'
          ? nights.to
          : nights.kind === 'set'
            ? Math.max(...nights.nights)
            : (latest ?? dateToNight(new Date()));
    return { year: Math.floor(n / 10000), month: Math.floor((n % 10000) / 100) - 1 };
  };
  const [view, setView] = useState(initialMonth);
  useEffect(() => {
    if (open) {
      setView(initialMonth());
      const r = button.current!.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        !popover.current?.contains(e.target as Node) &&
        !button.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const apply = (sel: NightSelection) => setGlobalQuery({ nights: sel });
  const pick = (night: number, e: React.MouseEvent) => {
    if (e.shiftKey && anchor !== null) {
      apply({ kind: 'range', from: Math.min(anchor, night), to: Math.max(anchor, night) });
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      const set = new Set(selected);
      if (set.has(night)) set.delete(night);
      else set.add(night);
      const list = [...set].sort((a, b) => a - b);
      apply(
        list.length === 0
          ? NO_NIGHTS
          : list.length === 1
            ? { kind: 'single', night: list[0] }
            : { kind: 'set', nights: list },
      );
      setAnchor(night);
      return;
    }
    apply({ kind: 'single', night });
    setAnchor(night);
  };
  const submitText = () => {
    const parts = text.split(/[\s,]+/).filter(Boolean);
    const parsed = parts.map(isoToNight);
    if (parsed.length === 0 || parsed.some((p) => p === null)) return;
    const ns = parsed as number[];
    if (ns.length === 1) apply({ kind: 'single', night: ns[0] });
    else if (text.includes('..') || text.includes('→'))
      apply({ kind: 'range', from: Math.min(...ns), to: Math.max(...ns) });
    else apply({ kind: 'set', nights: [...new Set(ns)].sort((a, b) => a - b) });
    setText('');
  };

  // calendar grid for the viewed month
  const first = new Date(Date.UTC(view.year, view.month, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(view.year, view.month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) =>
      dateToNight(new Date(Date.UTC(view.year, view.month, i + 1))),
    ),
  ];
  const shift = (d: number) =>
    setView((v) => ({
      year: v.year + Math.floor((v.month + d) / 12),
      month: (((v.month + d) % 12) + 12) % 12,
    }));
  const active = nights.kind !== 'none';

  return (
    <>
      <button
        ref={button}
        onClick={() => setOpen((o) => !o)}
        disabled={!database}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Nights to show: click one, shift-click a range, cmd-click to add"
        className={active ? 'active' : undefined}
      >
        <Icon name="night" />
        {active ? describeNights(nights) : 'All nights'}
      </button>
      {open &&
        createPortal(
          <div
            ref={popover}
            className="night-popover"
            role="dialog"
            aria-label="Choose nights"
            style={pos}
          >
            <div className="night-head">
              <button className="icon ghost" aria-label="previous month" onClick={() => shift(-1)}>
                <Icon name="prev" />
              </button>
              <span className="night-month">
                {MONTHS[view.month]} {view.year}
              </span>
              <button className="icon ghost" aria-label="next month" onClick={() => shift(1)}>
                <Icon name="next" />
              </button>
            </div>
            <div className="night-grid">
              {WEEKDAYS.map((d) => (
                <span key={d} className="night-weekday">
                  {d}
                </span>
              ))}
              {cells.map((n, i) =>
                n === null ? (
                  <span key={`e${i}`} />
                ) : (
                  <button
                    key={n}
                    className={`night-day${selected.has(n) ? ' selected' : ''}${counts?.[n] ? ' has-data' : ''}`}
                    aria-label={nightToIso(n)}
                    aria-pressed={selected.has(n)}
                    title={
                      counts?.[n]
                        ? `${nightToIso(n)} · ${counts[n].toLocaleString()} exposures`
                        : nightToIso(n)
                    }
                    onClick={(e) => pick(n, e)}
                  >
                    {n % 100}
                    {counts?.[n] ? <span className="night-dot" /> : null}
                  </button>
                ),
              )}
            </div>
            <div className="night-foot">
              <input
                aria-label="night text"
                placeholder="2026-03-22, or a..b for a range"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitText()}
              />
              <button className="ghost" onClick={() => apply(NO_NIGHTS)} disabled={!active}>
                Clear
              </button>
            </div>
            <div className="night-status meta">
              {loading ? (
                <>
                  <span className="spinner" /> counting exposures per night…
                </>
              ) : error ? (
                `nights unavailable: ${error}`
              ) : counts ? (
                `${Object.keys(counts).length} nights with exposures · latest ${latest ? nightToIso(latest) : '–'}`
              ) : (
                ''
              )}
              {active && (
                <span className="night-selected"> · showing {describeNights(nights)}</span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export { nightToDate };
