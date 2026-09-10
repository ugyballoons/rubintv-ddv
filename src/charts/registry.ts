import type { EChartsInstance } from './echarts';

/** Live ECharts instances by registry id, for the dev hook and tests. */
export const chartRegistry = new Map<string, EChartsInstance>();
