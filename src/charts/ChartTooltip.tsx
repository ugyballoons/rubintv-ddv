export interface TooltipEntry {
  readonly label: string;
  readonly value: string;
}

export interface TooltipData {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly entries: readonly TooltipEntry[];
}

/** Small overlay near the cursor listing label/value rows, like the Flutter chart tooltip. */
export function ChartTooltip({ data }: { data: TooltipData | null }) {
  if (!data) return null;
  return (
    <div className="chart-tooltip" role="tooltip" style={{ left: data.x + 14, top: data.y + 14 }}>
      <div className="chart-tooltip-title">{data.title}</div>
      {data.entries.map((e) => (
        <div key={e.label} className="chart-tooltip-row">
          <span>{e.label}</span>
          <span>{e.value}</span>
        </div>
      ))}
    </div>
  );
}

export const fmt = (v: number): string =>
  Number.isInteger(v) ? String(v) : v.toPrecision(6).replace(/\.?0+$/, '');
