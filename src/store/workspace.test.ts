import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DdvClient } from '../protocol/client';
import { KNOWN_INSTRUMENTS } from '../model/schema';
import { useSeriesData } from './seriesData';
import { useWorkspace, workspaceFingerprint } from './workspace';

describe('workspace store', () => {
  beforeEach(() => useWorkspace.getState().clearWorkspace());

  it('adds windows stair-stepped from the last one, with rising z-order', () => {
    const s = useWorkspace.getState();
    const a = s.addWindow('cartesianScatter');
    const b = s.addWindow('histogram');
    const { windows } = useWorkspace.getState();
    expect(windows[a]).toMatchObject({ x: 20, y: 20, z: 1, type: 'cartesianScatter' });
    expect(windows[b]).toMatchObject({ x: 40, y: 40, z: 2, type: 'histogram' });
    expect(windows[a].chart?.axes.map((x) => x.location)).toEqual(['bottom', 'left']);
    expect(windows[b].chart?.axes.map((x) => x.location)).toEqual(['bottom']);
  });

  it('focus raises a window above the others', () => {
    const s = useWorkspace.getState();
    const a = s.addWindow('cartesianScatter');
    s.addWindow('histogram');
    s.focusWindow(a);
    const { windows } = useWorkspace.getState();
    expect(windows[a].z).toBeGreaterThan(Object.values(windows).find((w) => w.id !== a)!.z);
  });

  it('moves, resizes, updates chart config and removes', () => {
    const s = useWorkspace.getState();
    const a = s.addWindow('cartesianScatter');
    s.moveWindow(a, 100, 50);
    s.resizeWindow(a, 90, 40, 700, 500);
    s.updateChart(a, { nBins: 33, useGlobalQuery: false });
    let w = useWorkspace.getState().windows[a];
    expect(w).toMatchObject({ x: 90, y: 40, width: 700, height: 500 });
    expect(w.chart).toMatchObject({ nBins: 33, useGlobalQuery: false });
    s.removeWindow(a);
    expect(useWorkspace.getState().windows[a]).toBeUndefined();
  });
});

describe('instrument selection', () => {
  const clientReplying = (reply: (name: string) => object | null) => {
    const listeners = new Set<(env: unknown) => void>();
    return {
      onMessage(cb: (env: unknown) => void) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      request(_name: string, parameters: { instrument: string }) {
        const content = reply(parameters.instrument);
        if (content)
          queueMicrotask(() => listeners.forEach((cb) => cb({ type: 'instrument info', content })));
        return new Promise(() => {});
      },
    } as unknown as DdvClient;
  };

  it("takes the drop-down's spelling for a Flutter file's instrument name", async () => {
    // the worker echoes back whatever name it was sent
    const client = clientReplying((instrument) => ({ instrument, detectors: [] }));
    const pending = useWorkspace.getState().selectInstrument(client, 'LsstCam');
    expect(useWorkspace.getState()).toMatchObject({
      instrumentStatus: 'loading',
      pendingInstrument: 'LSSTCam',
    });
    await pending;
    expect(useWorkspace.getState().instrument?.name).toBe('LSSTCam');
    expect(KNOWN_INSTRUMENTS).toContain(useWorkspace.getState().instrument?.name);
    expect(useWorkspace.getState().pendingInstrument).toBeNull();
  });

  it('does not stay loading when the instrument fails to load', async () => {
    vi.useFakeTimers();
    const pending = useWorkspace.getState().selectInstrument(
      clientReplying(() => null),
      'LATISS',
    );
    const failed = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(61_000);
    await failed;
    vi.useRealTimers();
    expect(useWorkspace.getState()).toMatchObject({
      instrumentStatus: 'ready', // the instrument from the test above is kept
      pendingInstrument: null,
    });
  });
});

describe('unsaved changes', () => {
  beforeEach(() => useWorkspace.getState().clearWorkspace());
  const dirty = () => {
    const s = useWorkspace.getState();
    return s.savedFingerprint !== null && workspaceFingerprint(s) !== s.savedFingerprint;
  };

  it('tracks the file and notices edits but not clicks', () => {
    const s = useWorkspace.getState();
    const a = s.addWindow('histogram');
    s.addWindow('cartesianScatter');
    expect(dirty()).toBe(false); // nothing to compare with before a save
    s.markSaved(['nights', 'ws.json']);
    expect(useWorkspace.getState().currentFile).toEqual(['nights', 'ws.json']);
    s.focusWindow(a); // stacking order alone is not a change
    expect(dirty()).toBe(false);
    s.updateChart(a, { nBins: 12 });
    expect(dirty()).toBe(true);
    s.markSaved(['nights', 'ws.json']);
    expect(dirty()).toBe(false);
    s.clearWorkspace();
    expect(useWorkspace.getState()).toMatchObject({ currentFile: null, savedFingerprint: null });
  });
});

describe('loading a workspace', () => {
  it('drops old data only once the file has parsed, just before the windows are swapped', async () => {
    const client = {} as DdvClient;
    const s = useWorkspace.getState();
    s.addWindow('histogram');
    const text = s.saveWorkspace();
    const beforeReplace = vi.fn(() =>
      // still the old windows at this point
      expect(Object.keys(useWorkspace.getState().windows)).toHaveLength(1),
    );
    await expect(s.loadWorkspace(client, '{not json', beforeReplace)).rejects.toThrow();
    expect(beforeReplace).not.toHaveBeenCalled();
    await s.loadWorkspace(client, text, beforeReplace);
    expect(beforeReplace).toHaveBeenCalledTimes(1);
  });

  it('clearing series data tells surviving series to fetch again', () => {
    const { reloadAll } = useSeriesData.getState();
    useSeriesData.getState().clear();
    expect(useSeriesData.getState().reloadAll).toBe(reloadAll + 1);
  });
});
