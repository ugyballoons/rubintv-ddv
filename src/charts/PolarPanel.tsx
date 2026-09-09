import { useMemo } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
import {
  buildPolarOption,
  polarSelectionOverlaySeries,
  type AngleUnit,
  type AxisSpec,
  type DataIdKey,
  type SeriesSpec,
} from 'rubin-charts';
import { EChart } from './EChart';

interface Props {
  /** x = angle, y = radius. */
  series: readonly SeriesSpec[];
  radialAxis: AxisSpec;
  angularAxis: AxisSpec;
  angleUnit?: AngleUnit;
  selected: ReadonlySet<DataIdKey>;
}

/**
 * Polar scatter that follows the shared selection. Selection *from* a polar
 * chart (sector drag) will reuse the KDBush index in (angle, radius) space.
 */
export function PolarPanel({ series, radialAxis, angularAxis, angleUnit, selected }: Props) {
  const option = useMemo(
    () =>
      buildPolarOption({
        series,
        radialAxis,
        angularAxis,
        angleUnit,
        selected: new Set(),
        drillDown: null,
      }),
    [series, radialAxis, angularAxis, angleUnit],
  );
  const patch = useMemo<EChartsCoreOption>(
    () => ({ series: [polarSelectionOverlaySeries(series, selected, angleUnit)] }),
    [series, selected, angleUnit],
  );
  return <EChart option={option} patch={patch} />;
}
