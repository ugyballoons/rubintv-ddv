import { useEffect, useMemo, useRef } from 'react';
import type { DetectorInfo } from '../protocol/types';
import { layoutFocalPlane, nearestDetector } from '../model/focalPlane';

interface Props {
  detectors: readonly DetectorInfo[];
  /** Fill per detector id; unfilled detectors use the neutral colour. */
  colors?: ReadonlyMap<number, string>;
  selectedId: number | null;
  onSelect(id: number | null): void;
  showLabels?: boolean;
}

/**
 * The focal plane as SVG polygons from server-supplied corners, y up as in
 * focal-plane coordinates, uniformly scaled to fit. Click selects a detector
 * (again to clear); arrow keys move to the nearest detector in that direction.
 */
export function FocalPlaneView({
  detectors,
  colors,
  selectedId,
  onSelect,
  showLabels = true,
}: Props) {
  const layout = useMemo(() => layoutFocalPlane(detectors), [detectors]);
  const host = useRef<HTMLDivElement>(null);
  const pad = 0.02 * Math.max(layout.width, layout.height);
  // Flip y by drawing in a coordinate system where up is positive: scale(1,-1).
  const viewBox = `${layout.minX - pad} ${-(layout.minY + layout.height) - pad} ${layout.width + 2 * pad} ${layout.height + 2 * pad}`;
  const fontSize = Math.max(layout.width, layout.height) / 60;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const dir =
        e.key === 'ArrowLeft'
          ? 'left'
          : e.key === 'ArrowRight'
            ? 'right'
            : e.key === 'ArrowUp'
              ? 'up'
              : e.key === 'ArrowDown'
                ? 'down'
                : null;
      if (!dir) return;
      e.preventDefault();
      const next =
        selectedId === null
          ? (layout.detectors[0]?.id ?? null)
          : nearestDetector(layout, selectedId, dir);
      if (next !== null) onSelect(next);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [layout, selectedId, onSelect]);

  if (!layout.detectors.length)
    return <div className="centered-note">No detector geometry for this instrument.</div>;

  return (
    <div
      ref={host}
      tabIndex={0}
      className="focal-host"
      aria-label="focal plane"
      data-testid="focal-plane"
    >
      <svg viewBox={viewBox} className="focal-svg" onClick={() => onSelect(null)}>
        <g transform="scale(1,-1)">
          {layout.detectors.map((d) => {
            const fill = colors?.get(d.id) ?? '#b7c4c8';
            const sel = d.id === selectedId;
            return (
              <g key={d.id} data-detector={d.id}>
                <polygon
                  points={d.corners.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill={fill}
                  stroke={sel ? '#16262e' : '#ffffff'}
                  strokeWidth={sel ? fontSize / 3 : fontSize / 8}
                  vectorEffect="non-scaling-stroke"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(sel ? null : d.id);
                  }}
                >
                  <title>
                    {d.id}: {d.name}
                  </title>
                </polygon>
                {showLabels && (
                  <text
                    x={d.cx}
                    y={-d.cy}
                    transform={`scale(1,-1)`}
                    fontSize={fontSize}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#fff"
                    pointerEvents="none"
                  >
                    {d.id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
