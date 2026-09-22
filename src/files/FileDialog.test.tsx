import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DdvClient } from '../protocol/client';
import { FileDialog } from './FileDialog';

const workspace = (instrument: string, windows = 0) =>
  JSON.stringify({
    version: { major: 0, minor: 1, patch: 0, buildNumber: '1' },
    instrument: { instrument, detectors: [] },
    windows: Object.fromEntries(
      Array.from({ length: windows }, (_, i) => [String(i), { type: 'nope' }]),
    ),
  });

/** A worker with one folder of one workspace under home, beside three more. */
function fakeClient({ details = true } = {}) {
  const request = vi.fn(async (name: string, p: { path: string[] }) => {
    if (name === 'list directory') {
      if (p.path.length === 0)
        return {
          content: {
            path: [],
            files: ['b.json', 'a10.json', 'a2.json'],
            directories: ['nights'],
            ...(details && {
              details: {
                'b.json': { size: 2048, modified: 300 },
                'a10.json': { size: 10, modified: 100 },
                'a2.json': { size: 5_000_000, modified: 200 },
                nights: { modified: 50 },
              },
            }),
          },
        };
      if (p.path.join('/') === 'nights')
        return { content: { path: p.path, files: ['ws.json'], directories: [] } };
      return { content: { error: 'no such directory' } };
    }
    if (name === 'load')
      return {
        content: {
          content: workspace(p.path.at(-1) === 'b.json' ? 'LsstCam' : 'LATISS', 2),
          path: p.path,
          size: 8,
        },
      };
    return { content: {} };
  });
  const calls = (name: string) => request.mock.calls.filter(([n]) => n === name).map(([, p]) => p);
  return { client: { request } as unknown as DdvClient, request, calls };
}

const option = (name: string) => screen.findByRole('option', { name });
const rowNames = () => screen.getAllByRole('option').map((o) => o.getAttribute('aria-label'));
const dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };

describe('FileDialog', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('lists folders first and files in natural order, told apart by name', async () => {
    const { client } = fakeClient();
    render(<FileDialog client={client} mode="load" onCancel={() => {}} onDone={() => {}} />);
    await option('folder nights');
    expect(rowNames()).toEqual(['folder nights', 'file a2.json', 'file a10.json', 'file b.json']);
    expect(screen.getByRole('status')).toHaveTextContent('1 folder, 3 files');
  });

  it('opens a selected folder rather than trying to load it', async () => {
    const { client, calls } = fakeClient();
    const onDone = vi.fn();
    render(<FileDialog client={client} mode="load" onCancel={() => {}} onDone={onDone} />);
    expect(screen.getByRole('button', { name: 'Load' })).toBeDisabled();
    fireEvent.click(await option('folder nights'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(await option('file ws.json'));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        text: workspace('LATISS', 2),
        path: ['nights', 'ws.json'],
      }),
    );
    // the owner closes the dialog, so nothing is listed again after the load
    expect(calls('list directory')).toHaveLength(2);
  });

  it('is keyboard driven: arrows select, Enter opens, Backspace goes up, typing jumps, Escape cancels', async () => {
    const { client } = fakeClient();
    const onCancel = vi.fn();
    render(<FileDialog client={client} mode="load" onCancel={onCancel} onDone={() => {}} />);
    await option('folder nights');
    const list = screen.getByRole('listbox');
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(await option('folder nights')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Enter' });
    await option('file ws.json');
    fireEvent.keyDown(list, { key: 'Backspace' });
    await option('folder nights');
    fireEvent.keyDown(list, { key: 'a' });
    fireEvent.keyDown(list, { key: '1' });
    expect(await option('file a10.json')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('saving: a selected folder opens, typing a name goes back to Save, overwriting asks first', async () => {
    const { client, calls } = fakeClient();
    const onDone = vi.fn();
    render(
      <FileDialog
        client={client}
        mode="save"
        content="{}"
        initialName="mine.json"
        onCancel={() => {}}
        onDone={onDone}
      />,
    );
    expect(screen.getByLabelText('file name')).toHaveValue('mine.json');
    fireEvent.click(await option('folder nights'));
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('file name'), { target: { value: 'b.json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const ask = screen.getByRole('alertdialog');
    expect(ask).toHaveTextContent('b.json already exists. Replace it?');
    expect(calls('save')).toHaveLength(0);
    fireEvent.click(within(ask).getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ path: ['b.json'] }));
    expect(calls('save')).toEqual([{ path: ['b.json'], content: '{}' }]);
  });

  it('falls back to home when the remembered folder has gone', async () => {
    const { client } = fakeClient();
    render(
      <FileDialog
        client={client}
        mode="load"
        initialPath={['deleted']}
        onCancel={() => {}}
        onDone={() => {}}
      />,
    );
    await option('folder nights');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows sizes and dates, sorts by them, and remembers the order', async () => {
    const { client } = fakeClient();
    const { unmount } = render(
      <FileDialog client={client} mode="save" onCancel={() => {}} onDone={() => {}} />,
    );
    expect(await option('file b.json')).toHaveTextContent('2.0 KB');
    fireEvent.click(screen.getByRole('button', { name: 'Sort by modified' })); // newest first
    expect(rowNames()).toEqual(['folder nights', 'file b.json', 'file a2.json', 'file a10.json']);
    fireEvent.click(screen.getByRole('button', { name: 'Sort by size' })); // largest first
    expect(rowNames()).toEqual(['folder nights', 'file a2.json', 'file b.json', 'file a10.json']);
    unmount();
    render(<FileDialog client={client} mode="save" onCancel={() => {}} onDone={() => {}} />);
    await option('file b.json');
    expect(rowNames()[1]).toBe('file a2.json');
  });

  it('works with a worker that sends no details', async () => {
    const { client } = fakeClient({ details: false });
    render(<FileDialog client={client} mode="save" onCancel={() => {}} onDone={() => {}} />);
    await option('file b.json');
    expect(screen.queryByRole('button', { name: 'Sort by modified' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sort by name' })).toBeInTheDocument();
  });

  it('filters the list by name', async () => {
    const { client } = fakeClient();
    render(<FileDialog client={client} mode="load" onCancel={() => {}} onDone={() => {}} />);
    await option('folder nights');
    fireEvent.change(screen.getByLabelText('filter'), { target: { value: 'A1' } });
    expect(rowNames()).toEqual(['file a10.json']);
    expect(screen.getByRole('status')).toHaveTextContent('1 of 4 items');
    fireEvent.change(screen.getByLabelText('filter'), { target: { value: 'zzz' } });
    expect(screen.getByText(/Nothing here matches/)).toBeInTheDocument();
  });

  it('creates a folder inline and asks in the dialog before deleting', async () => {
    const { client, calls } = fakeClient();
    render(<FileDialog client={client} mode="load" onCancel={() => {}} onDone={() => {}} />);
    await option('folder nights');
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const input = screen.getByLabelText('new folder name');
    fireEvent.change(input, { target: { value: 'fresh' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls('create directory')).toEqual([{ path: [], name: 'fresh' }]));

    fireEvent.click(await option('folder nights'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const ask = screen.getByRole('alertdialog');
    expect(ask).toHaveTextContent('Delete the folder nights and everything in it?');
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(calls('delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(calls('delete')).toEqual([{ path: ['nights'] }]));
  });

  it('moves a row dropped onto a folder', async () => {
    const { client, calls } = fakeClient();
    render(<FileDialog client={client} mode="load" onCancel={() => {}} onDone={() => {}} />);
    const file = await option('file b.json');
    const folder = await option('folder nights');
    fireEvent.dragStart(file, { dataTransfer });
    fireEvent.dragOver(folder, { dataTransfer });
    expect(folder).toHaveAttribute('data-drop', 'over');
    fireEvent.drop(folder, { dataTransfer });
    await waitFor(() =>
      expect(calls('move')).toEqual([{ source_path: ['b.json'], destination_path: ['nights'] }]),
    );
  });

  it('peeks at workspaces: instrument on the row, contents and a warning when selected', async () => {
    const { client, calls } = fakeClient();
    const onDone = vi.fn();
    render(
      <FileDialog
        client={client}
        mode="load"
        currentInstrument="LATISS"
        confirmLoad="Loading replaces the 2 windows in this workspace."
        onCancel={() => {}}
        onDone={onDone}
      />,
    );
    // a Flutter file's "LsstCam" is shown in the drop-down's spelling
    await waitFor(async () => expect(await option('file b.json')).toHaveTextContent('LSSTCam'));
    // a2.json is too big to read just for a peek
    expect(calls('load').map((p) => p.path.join('/'))).toEqual(['a10.json', 'b.json']);
    fireEvent.click(await option('file b.json'));
    expect(screen.getByText(/2 windows · saved by v0.1.0/)).toBeInTheDocument();
    expect(screen.getByText(/switches the instrument from LATISS to LSSTCam/)).toBeInTheDocument();

    // loading asks first when there is something to lose
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(onDone).not.toHaveBeenCalled();
    const ask = screen.getByRole('alertdialog');
    expect(ask).toHaveTextContent('Loading replaces the 2 windows');
    fireEvent.click(within(ask).getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
