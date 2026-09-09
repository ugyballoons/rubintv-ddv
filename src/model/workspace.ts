import type { AxisLocation, Marker, MappingKind } from 'rubin-charts';
import type { QueryJson } from '../protocol/types';

export type WindowType =
  'cartesianScatter' | 'polarScatter' | 'histogram' | 'box' | 'focalPlane' | 'detectorSelector';

export const CHART_WINDOW_TYPES: readonly WindowType[] = [
  'cartesianScatter',
  'polarScatter',
  'histogram',
  'box',
];

export const WINDOW_TITLES: Record<WindowType, string> = {
  cartesianScatter: 'Scatter plot',
  polarScatter: 'Polar scatter plot',
  histogram: 'Histogram',
  box: 'Box chart',
  focalPlane: 'Focal plane',
  detectorSelector: 'Detector selector',
};

/** A column reference as the Flutter app persists it: resolved against the live schema on load. */
export interface ColumnRef {
  readonly name: string;
  readonly schema: string; // table name
  readonly database: string;
}

export const columnRefId = (c: ColumnRef): string => `${c.schema}.${c.name}`;

export interface AxisConfig {
  readonly location: AxisLocation;
  readonly label: string;
  readonly mapping: MappingKind;
  readonly inverted: boolean;
}

export interface SeriesConfig {
  readonly id: string;
  readonly name: string;
  /** One column per axis, keyed by axis location. */
  readonly fields: Partial<Record<AxisLocation, ColumnRef>>;
  readonly marker: Marker;
  readonly query: QueryJson | null;
}

export type CursorTool = 'select' | 'drillDown';

export interface ChartConfig {
  readonly series: readonly SeriesConfig[];
  readonly axes: readonly AxisConfig[];
  readonly nBins: number;
  readonly useGlobalQuery: boolean;
  readonly tool: CursorTool;
}

export interface WindowMeta {
  readonly id: string;
  readonly type: WindowType;
  readonly title: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly chart: ChartConfig | null;
  /** Original saved state for window types the app does not model yet; written back unchanged. */
  readonly raw?: unknown;
}

export const DEFAULT_WINDOW_SIZE = { width: 600, height: 400 } as const;
export const NEW_WINDOW_OFFSET = { x: 20, y: 20 } as const;

/** Axis layout per chart type, mirroring the Flutter defaults (y inverted for cartesian, θ for polar). */
export function defaultAxes(type: WindowType): AxisConfig[] {
  switch (type) {
    case 'cartesianScatter':
      return [
        { location: 'bottom', label: '<x>', mapping: 'linear', inverted: false },
        { location: 'left', label: '<y>', mapping: 'linear', inverted: true },
      ];
    case 'polarScatter':
      return [
        { location: 'radial', label: '<r>', mapping: 'linear', inverted: false },
        { location: 'angular', label: '<θ>', mapping: 'linear', inverted: true },
      ];
    case 'histogram':
      return [{ location: 'bottom', label: '<x>', mapping: 'linear', inverted: false }];
    case 'box':
      return [
        { location: 'bottom', label: '<x>', mapping: 'linear', inverted: false },
        { location: 'left', label: '<y>', mapping: 'linear', inverted: false },
      ];
    default:
      return [];
  }
}

export function defaultChart(type: WindowType): ChartConfig | null {
  if (!CHART_WINDOW_TYPES.includes(type)) return null;
  return { series: [], axes: defaultAxes(type), nBins: 20, useGlobalQuery: true, tool: 'select' };
}

/** Placeholder axis labels are replaced by the field name when a series is committed. */
export const isPlaceholderLabel = (label: string): boolean =>
  label.startsWith('<') && label.endsWith('>');

/** Distinguishable series colours, from the Flutter theme's cycle (first entries). */
export const SERIES_COLORS = [
  '#058b8c',
  '#e6194b',
  '#3cb44b',
  '#ffe119',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#46f0f0',
  '#f032e6',
  '#bcf60c',
  '#fabebe',
  '#008080',
  '#e6beff',
  '#9a6324',
  '#800000',
  '#aaffc3',
  '#808000',
  '#ffd8b1',
  '#000075',
  '#808080',
] as const;
