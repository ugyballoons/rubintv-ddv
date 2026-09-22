import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { DdvClient } from '../protocol/client';
import {
  createDirectory,
  deleteFile,
  duplicateFile,
  listDirectory,
  loadFile,
  moveFile,
  renameFile,
  saveFile,
  type DirectoryListing,
  type RemotePath,
} from '../protocol/files';
import { Icon } from '../app/Icon';
import { formatModified, formatSize, peekWorkspace, type WorkspacePeek } from './peek';
import { loadPref, rememberFolder, samePath, savePref } from './recent';

interface Props {
  client: DdvClient;
  mode: 'load' | 'save';
  /** Content to save (save mode). */
  content?: string;
  /** Folder to open in; falls back to home if it has gone. */
  initialPath?: RemotePath;
  /** File name to offer (save mode). */
  initialName?: string;
  /** The instrument in use, to point out files saved for another one. */
  currentInstrument?: string | null;
  /** Load mode: what loading will cost the user, asked before it happens. Absent: nothing to lose. */
  confirmLoad?: string | null;
  /** A file or folder was renamed or moved (`to`), or deleted (`to` null), for owners that hold paths. */
  onPathChanged?(from: RemotePath, to: RemotePath | null): void;
  onCancel(): void;
  /** Called with the loaded text (load mode) or after a successful save. */
  onDone(result: { text?: string; path: RemotePath }): void;
}

/** A row of the listing. Folders and files are separate namespaces on the wire, so the kind is part of the identity. */
interface Entry {
  readonly name: string;
  readonly kind: 'dir' | 'file';
  readonly size?: number;
  readonly modified?: number;
}

type SortKey = 'name' | 'size' | 'modified';
interface Sort {
  readonly key: SortKey;
  readonly descending: boolean;
}

/** A question put in place of the button row, instead of a browser confirm(). */
interface Ask {
  readonly message: string;
  readonly label: string;
  readonly danger?: boolean;
  run(): void;
}

const SORT_PREF = 'ddv.fileSort';
const DEFAULT_NAME = () => `workspace-${new Date().toISOString().slice(0, 10)}.json`;
const BY_NAME = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const same = (a: Entry | null, b: Entry | null) =>
  a !== null && b !== null && a.name === b.name && a.kind === b.kind;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isJson = (name: string) => /\.json$/i.test(name);

// Peeking reads whole files, so only plausible workspaces, and not a whole archive of them.
const PEEK_MAX_BYTES = 2_000_000;
const PEEK_MAX_FILES = 40;
/** A file's peek stays good until the file changes. */
const peekKey = (folder: RemotePath, e: { name: string; modified?: number }) =>
  `${[...folder, e.name].join('/')}@${e.modified ?? ''}`;

function readSort(): Sort {
  const v = loadPref(SORT_PREF) as Partial<Sort> | null;
  return v && (v.key === 'name' || v.key === 'size' || v.key === 'modified')
    ? { key: v.key, descending: v.descending === true }
    : { key: 'name', descending: false };
}

/**
 * Browse the worker's user directory over the websocket: navigate folders,
 * create, rename, duplicate, move and delete, then load a file or save the
 * current content under a name.
 *
 * The primary button follows the selection: a folder is opened, a file is
 * loaded (or, saving, its name is taken). The list is keyboard driven: arrows
 * select, Enter activates, Backspace goes up a folder, F2 renames and typing
 * jumps to a name. Rows drag onto folders, the breadcrumbs and the up button
 * to move. Workspace files are read in the background so the list can say
 * which instrument each is for before it is loaded.
 */
export function FileDialog({
  client,
  mode,
  content,
  initialPath,
  initialName,
  currentInstrument,
  confirmLoad,
  onPathChanged,
  onCancel,
  onDone,
}: Props) {
  const [path, setPath] = useState<RemotePath>(initialPath ?? []);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [filename, setFilename] = useState(mode === 'save' ? (initialName ?? DEFAULT_NAME()) : '');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>(readSort);
  const [renaming, setRenaming] = useState<Entry | null>(null);
  const [creating, setCreating] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [peeks, setPeeks] = useState<Record<string, WorkspacePeek>>({});
  const [dragging, setDragging] = useState<Entry | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // What the dialog is waiting for, shown beside the breadcrumbs; null when idle.
  const [busy, setBusy] = useState<string | null>('Listing…');
  const [error, setError] = useState<string | null>(null);
  // Bumped to list the current folder again after it has been changed.
  const [reload, setReload] = useState(0);
  const listedOnce = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const peeking = useRef(new Set<string>());
  const blocked = busy !== null || ask !== null;

  // Every listing goes through here, so a slow reply for a folder the user has
  // already left is dropped. State updates happen in the promise callbacks.
  useEffect(() => {
    let cancelled = false;
    listDirectory(client, path)
      .then((l) => {
        if (cancelled) return;
        listedOnce.current = true;
        // Keep the folder with its contents: `path` runs ahead of the listing while navigating.
        setListing({ ...l, path });
        setError(null);
        setBusy(null);
        rememberFolder(path);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // A remembered folder that has since gone: start from home instead.
        if (!listedOnce.current && path.length > 0) setPath([]);
        else {
          setError(e.message);
          setBusy(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, path, reload]);

  useEffect(() => {
    if (mode === 'save' && nameRef.current) {
      const input = nameRef.current;
      input.focus();
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    } else listRef.current?.focus();
  }, [mode]);

  const allEntries = useMemo<Entry[]>(() => {
    if (!listing) return [];
    const entry = (kind: Entry['kind']) => (name: string) => ({
      name,
      kind,
      ...listing.details?.[name],
    });
    return [...listing.directories.map(entry('dir')), ...listing.files.map(entry('file'))];
  }, [listing]);

  const entries = useMemo<Entry[]>(() => {
    const needle = filter.trim().toLowerCase();
    const sign = sort.descending ? -1 : 1;
    const compare = (a: Entry, b: Entry) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1; // folders stay on top
      const byName = BY_NAME.compare(a.name, b.name);
      if (sort.key === 'name') return sign * byName;
      const d = (a[sort.key] ?? 0) - (b[sort.key] ?? 0);
      return d !== 0 ? sign * d : byName;
    };
    return allEntries.filter((e) => !needle || e.name.toLowerCase().includes(needle)).sort(compare);
  }, [allEntries, filter, sort]);

  // Read the folder's workspaces one at a time, the selected one first, so rows
  // can show their instrument. Peeks are kept by name and modification time.
  useEffect(() => {
    if (mode !== 'load' || !listing) return;
    let cancelled = false;
    const folder = listing.path;
    // In the order shown, so the rows in view fill in first.
    const candidates = entries.filter(
      (e) => e.kind === 'file' && isJson(e.name) && (e.size ?? 0) <= PEEK_MAX_BYTES,
    );
    const first = candidates.find((e) => same(e, selected));
    const queue = [...(first ? [first] : []), ...candidates.slice(0, PEEK_MAX_FILES)];
    void (async () => {
      for (const e of queue) {
        const key = peekKey(folder, e);
        if (cancelled) return;
        if (peeking.current.has(key)) continue;
        peeking.current.add(key);
        let peek: WorkspacePeek;
        try {
          peek = peekWorkspace((await loadFile(client, [...folder, e.name])).content);
        } catch (err) {
          peek = { error: (err as Error).message };
        }
        setPeeks((p) => ({ ...p, [key]: peek }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, mode, listing, entries, selected]);

  const navigate = (p: RemotePath) => {
    if (samePath(p, path)) return;
    setPath(p);
    setSelected(null);
    setRenaming(null);
    setCreating(false);
    setFilter('');
    setBusy('Opening…');
    setError(null);
  };

  /** Run an operation that changes the current folder, then list it again. Resolves to whether it worked. */
  const run = async (label: string, op: () => Promise<unknown>): Promise<boolean> => {
    setBusy(label);
    setError(null);
    try {
      await op();
      setReload((n) => n + 1); // busy clears when the new listing lands
      return true;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
      return false;
    }
  };

  /** Load or save, handing the result to the owner, who closes the dialog. */
  const finish = async (label: string, op: () => Promise<{ text?: string; path: RemotePath }>) => {
    setBusy(label);
    setError(null);
    try {
      onDone(await op());
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const select = (entry: Entry) => {
    setSelected(entry);
    if (mode === 'save' && entry.kind === 'file') setFilename(entry.name);
  };

  const opensFolder = selected?.kind === 'dir';
  const primaryLabel = opensFolder ? 'Open' : mode === 'load' ? 'Load' : 'Save';
  const primaryDisabled =
    blocked || (!opensFolder && (mode === 'load' ? !selected : !filename.trim()));

  const primary = () => {
    if (blocked) return;
    if (selected?.kind === 'dir') {
      navigate([...path, selected.name]);
    } else if (mode === 'load') {
      if (!selected) return;
      const file = [...path, selected.name];
      const load = () =>
        void finish(`Loading ${selected.name}…`, async () => ({
          text: (await loadFile(client, file)).content,
          path: file,
        }));
      if (confirmLoad) setAsk({ message: confirmLoad, label: 'Load', run: load });
      else load();
    } else {
      const name = filename.trim();
      if (!name) return;
      const file = [...path, name];
      const save = () =>
        void finish(`Saving ${name}…`, async () => {
          await saveFile(client, file, content ?? '');
          return { path: file };
        });
      if (listing?.files.includes(name))
        setAsk({
          message: `${name} already exists. Replace it?`,
          label: 'Replace',
          danger: true,
          run: save,
        });
      else save();
    }
  };

  const rename = (entry: Entry, to: string) => {
    setRenaming(null);
    listRef.current?.focus();
    if (!to || to === entry.name) return;
    const from = [...path, entry.name];
    void run(`Renaming ${entry.name}…`, () => renameFile(client, from, to)).then((ok) => {
      if (!ok) return;
      setSelected({ name: to, kind: entry.kind });
      onPathChanged?.(from, [...path, to]);
    });
  };

  const create = (name: string) => {
    setCreating(false);
    listRef.current?.focus();
    if (!name) return;
    void run(`Creating ${name}…`, () => createDirectory(client, path, name)).then(
      (ok) => ok && setSelected({ name, kind: 'dir' }),
    );
  };

  const remove = (entry: Entry) =>
    setAsk({
      message:
        entry.kind === 'dir'
          ? `Delete the folder ${entry.name} and everything in it?`
          : `Delete ${entry.name}?`,
      label: 'Delete',
      danger: true,
      run: () => {
        const from = [...path, entry.name];
        void run(`Deleting ${entry.name}…`, () => deleteFile(client, from)).then((ok) => {
          if (!ok) return;
          setSelected(null);
          onPathChanged?.(from, null);
        });
      },
    });

  // ---- drag to move: rows drop onto folder rows, breadcrumbs and the up button
  const canDropOn = (folder: RemotePath) =>
    dragging !== null &&
    !blocked &&
    !samePath(folder, path) && // already there
    !(
      dragging.kind === 'dir' &&
      samePath(folder.slice(0, path.length + 1), [...path, dragging.name])
    );
  const dropProps = (folder: RemotePath) => {
    const key = folder.join('/');
    return {
      'data-drop': dropTarget === key && canDropOn(folder) ? 'over' : undefined,
      onDragOver: (e: DragEvent) => {
        if (!canDropOn(folder)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dropTarget !== key) setDropTarget(key);
      },
      onDragLeave: () => setDropTarget((t) => (t === key ? null : t)),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        const moved = dragging;
        setDragging(null);
        setDropTarget(null);
        if (!moved || !canDropOn(folder)) return;
        const from = [...path, moved.name];
        void run(`Moving ${moved.name} to ${folder.at(-1) ?? 'home'}…`, () =>
          moveFile(client, from, folder),
        ).then((ok) => {
          if (!ok) return;
          setSelected(null);
          onPathChanged?.(from, [...folder, moved.name]);
        });
      },
    };
  };

  const onListKey = (e: KeyboardEvent) => {
    if (ask) return;
    const i = entries.findIndex((x) => same(x, selected));
    const move = (to: number) => {
      e.preventDefault();
      const entry = entries[Math.max(0, Math.min(entries.length - 1, to))];
      if (entry) select(entry);
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i < 0 ? entries.length - 1 : i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(entries.length - 1);
    else if (e.key === 'Enter') primary();
    else if (e.key === 'Backspace' && path.length > 0 && !blocked) navigate(path.slice(0, -1));
    else if (e.key === 'F2' && selected && !blocked) setRenaming(selected);
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type-ahead: keys in quick succession spell the start of a name.
      const now = Date.now();
      const t = typeahead.current;
      t.text = (now - t.at < 700 ? t.text : '') + e.key.toLowerCase();
      t.at = now;
      const hit = entries.find((x) => x.name.toLowerCase().startsWith(t.text));
      if (hit) {
        e.preventDefault();
        select(hit);
      }
    }
  };

  const title = mode === 'load' ? 'Load workspace from server' : 'Save workspace to server';
  const selectedIndex = entries.findIndex((x) => same(x, selected));
  const hasDetails = listing?.details !== undefined;
  const peekOf = (e: Entry) => (listing ? peeks[peekKey(listing.path, e)] : undefined);

  const sortButton = (key: SortKey, label: string) => (
    <button
      className={`sort ${key}`}
      aria-label={`Sort by ${label.toLowerCase()}`}
      aria-pressed={sort.key === key}
      onClick={() => {
        const next = { key, descending: sort.key === key ? !sort.descending : key !== 'name' };
        setSort(next);
        savePref(SORT_PREF, next);
      }}
    >
      {label}
      {sort.key === key && <span aria-hidden="true">{sort.descending ? ' ↓' : ' ↑'}</span>}
    </button>
  );

  let about: ReactNode = (
    <span className="hint">
      ↑↓ select · Enter open · Backspace up · F2 rename · type to jump · drag onto a folder to move
    </span>
  );
  if (selected) {
    const peek = selected.kind === 'file' ? peekOf(selected) : undefined;
    const facts = [
      selected.kind === 'dir' ? 'Folder' : null,
      selected.size !== undefined ? formatSize(selected.size) : null,
      selected.modified !== undefined
        ? `modified ${formatModified(selected.modified, true)}`
        : null,
    ].filter(Boolean);
    const switches =
      peek && !('error' in peek) && peek.instrument && currentInstrument
        ? peek.instrument !== currentInstrument
        : false;
    about = (
      <>
        <strong>{selected.name}</strong>
        {peek && !('error' in peek) && (
          <span>
            {peek.instrument ?? 'no instrument'} · {plural(peek.windows, 'window')} · saved by v
            {peek.version}
          </span>
        )}
        {peek && 'error' in peek && <span className="warn">Not a workspace: {peek.error}</span>}
        <span>{facts.join(' · ')}</span>
        {mode === 'load' && switches && peek && !('error' in peek) && (
          <span className="warn">
            Loading switches the instrument from {currentInstrument} to {peek.instrument}.
          </span>
        )}
      </>
    );
  }

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog file-dialog"
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          if (ask) setAsk(null);
          else onCancel();
        }}
      >
        <h3>{title}</h3>
        <div className="file-location">
          <button
            className="icon"
            aria-label="Up one folder"
            title="Up one folder (Backspace)"
            disabled={blocked || path.length === 0}
            onClick={() => navigate(path.slice(0, -1))}
            {...(path.length > 0 ? dropProps(path.slice(0, -1)) : {})}
          >
            <Icon name="up" />
          </button>
          <nav className="breadcrumbs" aria-label="current folder">
            <button onClick={() => navigate([])} {...dropProps([])}>
              home
            </button>
            {path.map((seg, i) => (
              <span key={i}>
                <span className="meta">/</span>
                <button
                  onClick={() => navigate(path.slice(0, i + 1))}
                  {...dropProps(path.slice(0, i + 1))}
                >
                  {seg}
                </button>
              </span>
            ))}
          </nav>
          <span className="meta file-status" role="status">
            {busy !== null ? (
              <>
                <span className="spinner" /> {busy}
              </>
            ) : (
              listing &&
              (filter.trim()
                ? `${entries.length} of ${plural(allEntries.length, 'item')}`
                : `${plural(listing.directories.length, 'folder')}, ${plural(listing.files.length, 'file')}`)
            )}
          </span>
          <input
            className="file-filter"
            type="search"
            aria-label="filter"
            placeholder="Filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelected(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && filter) {
                e.stopPropagation();
                setFilter('');
              } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                e.preventDefault();
                listRef.current?.focus();
                if (entries[0]) select(entries[0]);
              }
            }}
          />
        </div>
        <div className="file-head">
          {sortButton('name', 'Name')}
          {hasDetails && sortButton('size', 'Size')}
          {hasDetails && sortButton('modified', 'Modified')}
        </div>
        <div
          ref={listRef}
          className="file-list"
          role="listbox"
          aria-label="files"
          aria-busy={busy !== null}
          aria-activedescendant={selectedIndex >= 0 ? `file-row-${selectedIndex}` : undefined}
          tabIndex={0}
          onKeyDown={onListKey}
          onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          {creating && (
            <div className="file-row dir">
              <Icon name="folder" />
              <NameInput label="new folder name" name="" placeholder="New folder" onDone={create} />
            </div>
          )}
          {entries.map((entry, i) => {
            const isSelected = same(entry, selected);
            const isDir = entry.kind === 'dir';
            const peek = isDir ? undefined : peekOf(entry);
            const instrument = peek && !('error' in peek) ? peek.instrument : null;
            return (
              <div
                key={`${entry.kind}:${entry.name}`}
                id={`file-row-${i}`}
                ref={isSelected ? (el) => el?.scrollIntoView?.({ block: 'nearest' }) : undefined}
                className={`file-row ${entry.kind}${isSelected ? ' selected' : ''}${
                  !isDir && !isJson(entry.name) ? ' other' : ''
                }${same(entry, dragging) ? ' dragging' : ''}`}
                role="option"
                aria-label={`${isDir ? 'folder' : 'file'} ${entry.name}`}
                aria-selected={isSelected}
                draggable={!blocked && !same(entry, renaming)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', entry.name);
                  setDragging(entry);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
                {...(isDir ? dropProps([...path, entry.name]) : {})}
                onClick={() => select(entry)}
                onDoubleClick={() => {
                  if (blocked) return;
                  if (isDir) navigate([...path, entry.name]);
                  else if (mode === 'load') primary();
                }}
              >
                <Icon name={isDir ? 'folder' : 'file'} />
                {same(entry, renaming) ? (
                  <NameInput label="new name" name={entry.name} onDone={(n) => rename(entry, n)} />
                ) : (
                  <span className="name">{entry.name}</span>
                )}
                {instrument && (
                  <span
                    className={`instrument-tag${
                      currentInstrument && instrument !== currentInstrument ? ' differs' : ''
                    }`}
                    title={
                      currentInstrument && instrument !== currentInstrument
                        ? `Saved for ${instrument}; loading switches from ${currentInstrument}`
                        : `Saved for ${instrument}`
                    }
                  >
                    {instrument}
                  </span>
                )}
                {hasDetails && (
                  <>
                    <span className="size meta">
                      {entry.size !== undefined ? formatSize(entry.size) : ''}
                    </span>
                    <span className="modified meta">
                      {entry.modified !== undefined ? formatModified(entry.modified) : ''}
                    </span>
                  </>
                )}
                <span className="open-hint">{isDir && <Icon name="chevron" size={13} />}</span>
              </div>
            );
          })}
          {listing && entries.length === 0 && !creating && (
            <div className="meta empty">
              {filter.trim() ? `Nothing here matches “${filter.trim()}”` : 'This folder is empty'}
            </div>
          )}
        </div>
        <div className="file-about meta">{about}</div>
        {mode === 'save' && (
          <label className="field">
            <span>File name</span>
            <input
              ref={nameRef}
              aria-label="file name"
              value={filename}
              onChange={(e) => {
                setFilename(e.target.value);
                // Typing a name means saving here, not opening the selected folder.
                if (selected?.kind === 'dir') setSelected(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && primary()}
            />
          </label>
        )}
        {error && (
          <p className="meta warn" role="alert">
            {error}
          </p>
        )}
        {ask ? (
          <div className="buttons file-ask" role="alertdialog" aria-label={ask.message}>
            <span className="question">{ask.message}</span>
            <button onClick={() => setAsk(null)}>Cancel</button>
            <button
              autoFocus
              className={ask.danger ? 'danger' : 'primary'}
              onClick={() => {
                setAsk(null);
                ask.run();
              }}
            >
              {ask.label}
            </button>
          </div>
        ) : (
          <div className="buttons file-buttons">
            <button disabled={blocked || creating} onClick={() => setCreating(true)}>
              New folder
            </button>
            <button
              disabled={blocked || !selected}
              title="Rename (F2)"
              onClick={() => setRenaming(selected)}
            >
              Rename
            </button>
            <button
              disabled={blocked || !selected}
              onClick={() =>
                selected &&
                void run(`Duplicating ${selected.name}…`, () =>
                  duplicateFile(client, [...path, selected.name]),
                )
              }
            >
              Duplicate
            </button>
            <button
              className="danger"
              disabled={blocked || !selected}
              onClick={() => selected && remove(selected)}
            >
              Delete
            </button>
            <span style={{ flex: 1 }} />
            <button onClick={onCancel}>Cancel</button>
            <button className="primary" disabled={primaryDisabled} onClick={primary}>
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** An inline name editor for a row: Enter or leaving it accepts, Escape gives the original back. */
function NameInput({
  label,
  name,
  placeholder,
  onDone,
}: {
  label: string;
  name: string;
  placeholder?: string;
  onDone(n: string): void;
}) {
  const [v, setV] = useState(name);
  // Enter and Escape both blur the input as it unmounts; only the first counts.
  const done = useRef(false);
  const finish = (n: string) => {
    if (done.current) return;
    done.current = true;
    onDone(n);
  };
  return (
    <input
      aria-label={label}
      autoFocus
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => {
        const dot = name.lastIndexOf('.');
        e.target.setSelectionRange(0, dot > 0 ? dot : name.length);
      }}
      onBlur={() => finish(v.trim() || name)}
      onKeyDown={(e) => {
        // Keep typing away from the list's and the dialog's shortcuts.
        e.stopPropagation();
        if (e.key === 'Enter') finish(v.trim() || name);
        if (e.key === 'Escape') finish(name);
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
