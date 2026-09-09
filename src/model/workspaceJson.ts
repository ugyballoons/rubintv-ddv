/**
 * Saved-workspace JSON, compatible with what the Flutter app writes and reads.
 * Conventions reproduced from the Dart code and checked against a real saved
 * file (test/fixtures/example_saved_workspace.json):
 * - `windowType` is the bare enum name; `tool` is the qualified "MultiSelectionTool.x".
 * - Optional top-level keys are omitted rather than written as null.
 * - Colours are ARGB integers.
 * - Numbers are plain JSON numbers (the Flutter app runs on the web, so its
 *   encoder writes 600 rather than 600.0).
 */
import type { AxisLocation, MappingKind } from 'rubin-charts';
import type {
  DetectorInfo,
  EqualityQueryJson,
  ParentQueryJson,
  QueryJson,
} from '../protocol/types';
import type { Instrument } from './schema';
import {
  defaultAxes,
  type AxisConfig,
  type ChartConfig,
  type ColumnRef,
  type SeriesConfig,
  type WindowMeta,
  type WindowType,
} from './workspace';

export interface WorkspaceFile {
  readonly windows: Record<string, WindowMeta>;
  readonly instrumentName: string | null;
  readonly database: string | null;
  readonly detectors: readonly DetectorInfo[];
  readonly globalQuery: QueryJson | null;
  /** YYYY-MM-DD or null. */
  readonly dayObs: string | null;
  readonly detectorId: number | null;
  readonly version: { major: number; minor: number; patch: number; buildNumber: string };
  /** Windows the loader skipped, with the reason (unknown column, unsupported type). */
  readonly skipped: readonly { id: string; reason: string }[];
}

export interface SaveInput {
  readonly windows: Record<string, WindowMeta>;
  readonly instrument: Instrument | null;
  readonly globalQuery: QueryJson | null;
  readonly dayObs: string | null;
  readonly detectorId: number | null;
  readonly version: string;
  readonly newId: () => string;
}

// ---------------------------------------------------------------- writing

const dbl = (n: number): number => n;

/** Compact JSON like Dart's jsonEncode; undefined values are dropped. */
export function stringifyWorkspace(value: unknown, pretty = false): string {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}

const MAPPING_TO_DART: Record<MappingKind, string> = {
  linear: 'linear',
  log10: 'log10',
  logE: 'log',
};
const MAPPING_FROM_DART: Record<string, MappingKind> = {
  linear: 'linear',
  log10: 'log10',
  log: 'logE',
};

export const axisIdString = (location: AxisLocation, axesId = 0) => `${location},${axesId}`;

export function parseAxisId(raw: unknown): AxisLocation {
  if (typeof raw === 'string') {
    const loc = raw.split(',')[0].replace(/^AxisLocation\./, '');
    return loc as AxisLocation;
  }
  if (raw && typeof raw === 'object' && 'location' in raw)
    return String((raw as { location: unknown }).location) as AxisLocation;
  throw new Error(`unrecognised axisId ${JSON.stringify(raw)}`);
}

/** '#rrggbb' → Flutter ARGB int with full alpha. */
export function colorToArgb(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const rgb = m ? parseInt(m[1], 16) : 0;
  return (0xff000000 + rgb) >>> 0;
}
export function argbToColor(argb: number | null | undefined): string | null {
  if (typeof argb !== 'number') return null;
  return `#${(argb & 0xffffff).toString(16).padStart(6, '0')}`;
}

function serializeSeries(s: SeriesConfig, newId: () => string) {
  const axes = Object.keys(s.fields) as AxisLocation[];
  return {
    id: s.id,
    name: s.name,
    marker: {
      size: dbl(s.marker.size),
      type: 'circle',
      color: colorToArgb(s.marker.color),
      edgeColor: s.marker.edgeColor ? colorToArgb(s.marker.edgeColor) : null,
    },
    errorBars: null,
    axes: axes.map((a) => axisIdString(a)),
    fields: Object.fromEntries(axes.map((a) => [axisIdString(a), { ...s.fields[a]! }])),
    query: s.query ? queryTreeToGraph(s.query, newId) : null,
  };
}

function serializeAxis(a: AxisConfig) {
  return {
    label: a.label,
    mapping: { type: MAPPING_TO_DART[a.mapping] },
    isInverted: a.inverted,
    axisId: axisIdString(a.location),
    isBounded: true,
    fixedBounds: null,
  };
}

function serializeChartState(w: WindowMeta, newId: () => string): Record<string, unknown> {
  const c = w.chart!;
  const state: Record<string, unknown> = {
    id: w.id,
    series: c.series.map((s) => serializeSeries(s, newId)),
    axisInfo: c.axes.map(serializeAxis),
    legend: { location: 'floating', offset: { dx: dbl(0), dy: dbl(0) } },
    useGlobalQuery: c.useGlobalQuery,
    windowType: w.type,
    tool: `MultiSelectionTool.${c.tool}`,
  };
  if (w.type === 'histogram' || w.type === 'box') state.nBins = c.nBins;
  return state;
}

export function serializeWorkspace(input: SaveInput): Record<string, unknown> {
  const windows: Record<string, unknown> = {};
  for (const w of Object.values(input.windows)) {
    const state = w.chart ? serializeChartState(w, input.newId) : w.raw;
    if (!state) continue; // unsupported window with nothing to round-trip
    windows[w.id] = {
      state,
      offset: { dx: dbl(w.x), dy: dbl(w.y) },
      size: { width: dbl(w.width), height: dbl(w.height) },
      title: w.title,
    };
  }
  const [major, minor, patch] = input.version.split('.').map((n) => Number(n) || 0);
  const out: Record<string, unknown> = {
    windows,
    version: { major, minor, patch, buildNumber: '1' },
  };
  if (input.instrument) {
    out.instrument = {
      instrument: input.instrument.name,
      detectors: input.instrument.detectors.map((d) => ({
        id: d.id,
        name: d.name,
        corners: d.corners.map((c) => [dbl(c[0]), dbl(c[1])]),
      })),
      ...(input.instrument.database && { schema: { name: input.instrument.database } }),
    };
  }
  if (input.globalQuery) out.globalQuery = queryTreeToGraph(input.globalQuery, input.newId);
  if (input.dayObs) out.dayObs = `${input.dayObs}T00:00:00.000`;
  if (input.detectorId !== null && input.instrument) {
    const d = input.instrument.detectors.find((x) => x.id === input.detectorId);
    if (d)
      out.detector = {
        id: d.id,
        name: d.name,
        corners: d.corners.map((c) => [dbl(c[0]), dbl(c[1])]),
      };
  }
  return out;
}

// ---------------------------------------------------------------- queries

interface QueryGraph {
  nodes: Record<string, Record<string, unknown>>;
  roots: string[];
  children: Record<string, string[]>;
  parents: Record<string, string>;
}

/** Wire/tree form → the Flutter full-graph persistence form. Node ids are minted with newId. */
export function queryTreeToGraph(root: QueryJson, newId: () => string): QueryGraph {
  const g: QueryGraph = { nodes: {}, roots: [], children: {}, parents: {} };
  const visit = (q: QueryJson, parent: string | null): Record<string, unknown> => {
    const id = q.id && /^\d+$/.test(q.id) ? q.id : newId();
    let node: Record<string, unknown>;
    if (q.type === 'ParentQuery') {
      const childNodes = q.children.map((c) => visit(c, id));
      g.children[id] = q.children.map((_c, i) => String(childNodes[i].id));
      node = { type: 'ParentQuery', id, operator: q.operator, children: childNodes };
    } else {
      node = { type: 'EqualityQuery', id, field: { ...q.field } };
      if (q.leftOperator !== undefined)
        Object.assign(node, { leftOperator: q.leftOperator, leftValue: q.leftValue });
      if (q.rightOperator !== undefined)
        Object.assign(node, { rightOperator: q.rightOperator, rightValue: q.rightValue });
    }
    g.nodes[id] = node;
    if (parent) g.parents[id] = parent;
    else g.roots.push(id);
    return node;
  };
  visit(root, null);
  return g;
}

/** Full-graph form → wire/tree form rooted at the first root; null for an empty expression. */
export function queryGraphToTree(g: unknown): QueryJson | null {
  if (!g || typeof g !== 'object') return null;
  const graph = g as Partial<QueryGraph>;
  const rootId = graph.roots?.[0];
  if (!rootId || !graph.nodes) return null;
  const build = (id: string): QueryJson => {
    const n = graph.nodes![id];
    if (!n) throw new Error(`query node ${id} missing`);
    if (n.type === 'ParentQuery') {
      // toJson writes `operator` at the top level; the Flutter reader expected content.operator.
      const operator = (n.operator ??
        (n.content as { operator?: string } | undefined)?.operator) as ParentQueryJson['operator'];
      const childIds = graph.children?.[id] ?? [];
      return { type: 'ParentQuery', id, operator, children: childIds.map(build) };
    }
    const e: EqualityQueryJson = {
      type: 'EqualityQuery',
      id,
      field: n.field as EqualityQueryJson['field'],
    };
    if (n.leftOperator != null)
      Object.assign(e, { leftOperator: n.leftOperator, leftValue: n.leftValue });
    if (n.rightOperator != null)
      Object.assign(e, { rightOperator: n.rightOperator, rightValue: n.rightValue });
    return e;
  };
  return build(rootId);
}

// ---------------------------------------------------------------- reading

const WINDOW_TYPES = new Set<WindowType>([
  'cartesianScatter',
  'polarScatter',
  'histogram',
  'box',
  'focalPlane',
  'detectorSelector',
]);

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} is not a number`);
  return v;
}

function parseFields(raw: unknown): Partial<Record<AxisLocation, ColumnRef>> {
  const out: Partial<Record<AxisLocation, ColumnRef>> = {};
  const put = (axis: unknown, field: unknown) => {
    if (!field || typeof field !== 'object') return;
    const f = field as Record<string, unknown>;
    out[parseAxisId(axis)] = {
      name: String(f.name),
      schema: String(f.schema),
      database: String(f.database),
    };
  };
  if (Array.isArray(raw)) {
    for (const pair of raw) if (Array.isArray(pair) && pair.length === 2) put(pair[0], pair[1]);
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) put(k, v);
  } else {
    throw new Error('unknown fields format');
  }
  return out;
}

function parseSeries(raw: Record<string, unknown>, fallbackColor: string): SeriesConfig {
  const marker = (raw.marker ?? null) as Record<string, unknown> | null;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ''),
    fields: parseFields(raw.fields),
    marker: {
      color: argbToColor(marker?.color as number | null) ?? fallbackColor,
      size: typeof marker?.size === 'number' ? marker.size : 5,
      ...(argbToColor(marker?.edgeColor as number | null) && {
        edgeColor: argbToColor(marker?.edgeColor as number | null)!,
      }),
    },
    query: raw.query ? queryGraphToTree(raw.query) : null,
  };
}

function parseAxis(raw: Record<string, unknown>): AxisConfig {
  const mappingType = String(
    (raw.mapping as Record<string, unknown> | undefined)?.type ?? 'linear',
  );
  return {
    location: parseAxisId(raw.axisId),
    label: String(raw.label ?? ''),
    mapping: MAPPING_FROM_DART[mappingType] ?? 'linear',
    inverted: Boolean(raw.isInverted),
  };
}

function parseTool(raw: unknown): ChartConfig['tool'] {
  const s = String(raw ?? 'select').replace(/^MultiSelectionTool\./, '');
  return s === 'drillDown' ? 'drillDown' : 'select';
}

/** Validate that every series column exists in the instrument's schema; returns the first missing one. */
function missingColumn(
  series: readonly SeriesConfig[],
  instrument: Instrument | null,
): string | null {
  if (!instrument) return null;
  for (const s of series) {
    for (const ref of Object.values(s.fields)) {
      const table = instrument.tables.find((t) => t.name === ref.schema);
      if (!table) return `table ${ref.schema} not found`;
      if (!table.columns.some((c) => c.name === ref.name))
        return `column ${ref.schema}.${ref.name} not found`;
    }
  }
  return null;
}

export function parseWorkspace(
  text: string,
  instrument: Instrument | null,
  colors: readonly string[],
): WorkspaceFile {
  const json = JSON.parse(text) as Record<string, unknown>;
  const windows: Record<string, WindowMeta> = {};
  const skipped: { id: string; reason: string }[] = [];
  let z = 1;
  for (const [id, rawMeta] of Object.entries(
    (json.windows ?? {}) as Record<string, Record<string, unknown>>,
  )) {
    try {
      const state = rawMeta.state as Record<string, unknown>;
      const type = String(state.windowType ?? '').replace(/^WindowTypes\./, '') as WindowType;
      if (!WINDOW_TYPES.has(type)) throw new Error(`unrecognised window type "${type}"`);
      const offset = rawMeta.offset as Record<string, unknown>;
      const size = rawMeta.size as Record<string, unknown>;
      const base = {
        id,
        type,
        title: rawMeta.title ? String(rawMeta.title) : (undefined as unknown as string),
        x: num(offset.dx, 'offset.dx'),
        y: num(offset.dy, 'offset.dy'),
        width: num(size.width, 'size.width'),
        height: num(size.height, 'size.height'),
        z: z++,
      };
      if (
        type === 'cartesianScatter' ||
        type === 'polarScatter' ||
        type === 'histogram' ||
        type === 'box'
      ) {
        const series = ((state.series as Record<string, unknown>[]) ?? []).map((s, i) =>
          parseSeries(s, colors[i % colors.length]),
        );
        const missing = missingColumn(series, instrument);
        if (missing) throw new Error(missing);
        const axes = ((state.axisInfo as Record<string, unknown>[]) ?? []).map(parseAxis);
        windows[id] = {
          ...base,
          title: base.title ?? titleFor(type),
          chart: {
            series,
            axes: axes.length ? axes : defaultAxes(type),
            nBins: typeof state.nBins === 'number' ? state.nBins : 20,
            useGlobalQuery: state.useGlobalQuery !== false,
            tool: parseTool(state.tool),
          },
        };
      } else {
        // Not modelled yet (focal plane, detector selector): keep the raw state so saving round-trips it.
        windows[id] = { ...base, title: base.title ?? titleFor(type), chart: null, raw: state };
      }
    } catch (e) {
      skipped.push({ id, reason: (e as Error).message });
    }
  }
  const inst = json.instrument as Record<string, unknown> | undefined;
  const version = (json.version as WorkspaceFile['version'] | undefined) ?? {
    major: 0,
    minor: 0,
    patch: 0,
    buildNumber: '',
  };
  const dayObsRaw = typeof json.dayObs === 'string' ? json.dayObs : null;
  const detector = json.detector as { id?: number } | undefined;
  return {
    windows,
    instrumentName: inst ? String(inst.instrument) : null,
    database: (inst?.schema as { name?: string } | undefined)?.name ?? null,
    detectors: (inst?.detectors as DetectorInfo[] | undefined) ?? [],
    globalQuery: json.globalQuery ? queryGraphToTree(json.globalQuery) : null,
    dayObs: dayObsRaw ? dayObsRaw.slice(0, 10) : null,
    detectorId: typeof detector?.id === 'number' ? detector.id : null,
    version,
    skipped,
  };
}

function titleFor(type: WindowType): string {
  return (
    {
      cartesianScatter: 'Scatter plot',
      polarScatter: 'Polar scatter plot',
      histogram: 'Histogram',
      box: 'Box chart',
      focalPlane: 'Focal plane',
      detectorSelector: 'Detector selector',
    } as Record<WindowType, string>
  )[type];
}
