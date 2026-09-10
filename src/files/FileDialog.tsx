import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DdvClient } from '../protocol/client';
import {
  createDirectory,
  deleteFile,
  duplicateFile,
  listDirectory,
  loadFile,
  renameFile,
  saveFile,
  type RemotePath,
} from '../protocol/files';

interface Props {
  client: DdvClient;
  mode: 'load' | 'save';
  /** Content to save (save mode). */
  content?: string;
  onCancel(): void;
  /** Called with the loaded text (load mode) or after a successful save. */
  onDone(result: { text?: string; path: RemotePath }): void;
}

const DEFAULT_NAME = () => `workspace-${new Date().toISOString().slice(0, 10)}.json`;

/**
 * Browse the worker's user directory over the websocket: navigate folders,
 * create, rename, duplicate and delete, then load a file or save the current
 * content under a name. Mirrors the Flutter file dialog without drag-to-move.
 */
export function FileDialog({ client, mode, content, onCancel, onDone }: Props) {
  const [path, setPath] = useState<RemotePath>([]);
  const [listing, setListing] = useState<{ files: string[]; directories: string[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filename, setFilename] = useState(mode === 'save' ? DEFAULT_NAME() : '');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(true); // the initial listing is in flight
  const [error, setError] = useState<string | null>(null);

  // Fetches a listing; every state update happens after the await, so this is
  // safe to trigger from the mount effect. Callers set busy before calling.
  const refresh = useCallback(
    async (p: RemotePath) => {
      try {
        const l = await listDirectory(client, p);
        setListing({ files: [...l.files], directories: [...l.directories] });
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [client],
  );
  useEffect(() => {
    void refresh([]);
  }, [refresh]);
  const navigate = (p: RemotePath) => {
    setPath(p);
    setSelected(null);
    setBusy(true);
    setError(null);
    void refresh(p);
  };

  const run = async (op: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await op();
      await refresh(path);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const target = selected ? [...path, selected] : null;

  const primary = async () => {
    if (mode === 'load') {
      if (!selected) return;
      await run(async () => {
        const r = await loadFile(client, [...path, selected]);
        onDone({ text: r.content, path: [...path, selected] });
      });
    } else {
      const name = filename.trim();
      if (!name) return;
      if (listing?.files.includes(name) && !window.confirm(`Overwrite ${name}?`)) return;
      await run(async () => {
        await saveFile(client, [...path, name], content ?? '');
        onDone({ path: [...path, name] });
      });
    }
  };

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={onCancel}>
      <div
        className="dialog file-dialog"
        role="dialog"
        aria-label={mode === 'load' ? 'Load workspace from server' : 'Save workspace to server'}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3>{mode === 'load' ? 'Load workspace from server' : 'Save workspace to server'}</h3>
        <nav className="breadcrumbs" aria-label="current folder">
          <button onClick={() => navigate([])}>home</button>
          {path.map((seg, i) => (
            <span key={i}>
              <span className="meta">/</span>
              <button onClick={() => navigate(path.slice(0, i + 1))}>{seg}</button>
            </span>
          ))}
        </nav>
        <div className="file-list" role="listbox" aria-label="files">
          {listing === null && !error && <div className="meta">loading…</div>}
          {listing?.directories.map((d) => (
            <div
              key={`d:${d}`}
              className={`file-row${selected === d ? ' selected' : ''}`}
              role="option"
              aria-selected={selected === d}
              onClick={() => setSelected(d)}
              onDoubleClick={() => navigate([...path, d])}
            >
              <span className="icon">📁</span>
              {renaming === d ? (
                <RenameInput
                  name={d}
                  onDone={(n) => {
                    setRenaming(null);
                    if (n !== d) void run(() => renameFile(client, [...path, d], n));
                  }}
                />
              ) : (
                <span>{d}</span>
              )}
            </div>
          ))}
          {listing?.files.map((f) => (
            <div
              key={`f:${f}`}
              className={`file-row${selected === f ? ' selected' : ''}`}
              role="option"
              aria-selected={selected === f}
              onClick={() => {
                setSelected(f);
                if (mode === 'save') setFilename(f);
              }}
              onDoubleClick={() => mode === 'load' && void primary()}
            >
              <span className="icon">📄</span>
              {renaming === f ? (
                <RenameInput
                  name={f}
                  onDone={(n) => {
                    setRenaming(null);
                    if (n !== f) void run(() => renameFile(client, [...path, f], n));
                  }}
                />
              ) : (
                <span>{f}</span>
              )}
            </div>
          ))}
          {listing && listing.files.length === 0 && listing.directories.length === 0 && (
            <div className="meta">empty folder</div>
          )}
        </div>
        {mode === 'save' && (
          <label className="field">
            <span>File name</span>
            <input
              aria-label="file name"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="meta warn" role="alert">
            {error}
          </p>
        )}
        <div className="buttons file-buttons">
          <button
            disabled={busy}
            onClick={() => {
              const name = window.prompt('New folder name');
              if (name) void run(() => createDirectory(client, path, name));
            }}
          >
            New folder
          </button>
          <button disabled={busy || !selected} onClick={() => setRenaming(selected)}>
            Rename
          </button>
          <button
            disabled={busy || !target}
            onClick={() => target && void run(() => duplicateFile(client, target))}
          >
            Duplicate
          </button>
          <button
            className="danger"
            disabled={busy || !target}
            onClick={() =>
              target &&
              window.confirm(`Delete ${selected}?`) &&
              void run(() => deleteFile(client, target))
            }
          >
            Delete
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={onCancel}>Cancel</button>
          <button
            disabled={busy || (mode === 'load' ? !selected : !filename.trim())}
            onClick={() => void primary()}
          >
            {mode === 'load' ? 'Load' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RenameInput({ name, onDone }: { name: string; onDone(n: string): void }) {
  const [v, setV] = useState(name);
  return (
    <input
      aria-label="new name"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || name)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(v.trim() || name);
        if (e.key === 'Escape') onDone(name);
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
