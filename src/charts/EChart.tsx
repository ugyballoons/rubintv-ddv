import { useEffect, useRef } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import { echarts, type EChartsInstance } from './echarts';

interface Props {
  /** Full option; applied with notMerge so removed series disappear. */
  option: EChartsCoreOption;
  /** Partial option merged on top; use for cheap updates such as the selection overlay. */
  patch?: EChartsCoreOption;
  onReady?(chart: EChartsInstance): void;
  style?: React.CSSProperties;
}

/** Thin ECharts host: owns the instance, resizes with its container, never re-creates on option change. */
export function EChart({ option, patch, onReady, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsInstance | null>(null);

  useEffect(() => {
    const el = ref.current!;
    const c = echarts.init(el, undefined, { renderer: 'canvas' });
    chart.current = c;
    onReady?.(c);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
    // The instance is created once per mount; option changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true, lazyUpdate: false });
  }, [option]);

  useEffect(() => {
    if (patch) chart.current?.setOption(patch, { notMerge: false, lazyUpdate: false });
  }, [patch]);

  return <div ref={ref} style={{ width: '100%', height: '100%', ...style }} />;
}
