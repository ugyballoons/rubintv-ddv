import { useEffect, useRef } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { echarts, type EChartsInstance } from './echarts';

interface Props {
  /** Full option; applied with notMerge so removed series disappear. */
  option: EChartsCoreOption;
  /** Partial option merged on top; use for cheap updates such as the selection overlay. */
  patch?: EChartsCoreOption;
  /** Changing this re-applies the full option, which also resets pan and zoom. */
  resetToken?: number;
  onReady?(chart: EChartsInstance): void;
  /** Registers the instance under this id for tests and debugging (window.__ddv.chart). */
  registryId?: string;
  style?: React.CSSProperties;
}

/** Live ECharts instances by registry id, for the dev hook. */
export const chartRegistry = new Map<string, EChartsInstance>();

/** Thin ECharts host: owns the instance, resizes with its container, never re-creates on option change. */
export function EChart({ option, patch, resetToken = 0, onReady, registryId, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsInstance | null>(null);
  const lastPatch = useRef<EChartsCoreOption | undefined>(undefined);

  useEffect(() => {
    const el = ref.current!;
    const c = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.current = c;
    if (registryId) chartRegistry.set(registryId, c);
    onReady?.(c);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (registryId) chartRegistry.delete(registryId);
      c.dispose();
      chart.current = null;
    };
    // The instance is created once per mount; option changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.setOption(option, { notMerge: true, lazyUpdate: false });
    // A full re-apply drops the merged overlay; put the latest one back.
    if (lastPatch.current) c.setOption(lastPatch.current, { notMerge: false });
  }, [option, resetToken]);

  useEffect(() => {
    lastPatch.current = patch;
    if (patch) chart.current?.setOption(patch, { notMerge: false, lazyUpdate: false });
  }, [patch]);

  return <div ref={ref} style={{ width: '100%', height: '100%', ...style }} />;
}
