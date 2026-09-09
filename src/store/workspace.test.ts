import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspace } from './workspace';

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
