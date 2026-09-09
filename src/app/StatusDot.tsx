import { useConnection } from '../store/connection';

const COLORS: Record<string, string> = {
  open: '#2e7d4f',
  connecting: '#c9a227',
  stale: '#c9a227',
  closed: '#a63d3d',
};

/** The toolbar connection indicator: red disconnected, yellow connecting, green live. */
export function StatusDot() {
  const status = useConnection((s) => s.status);
  return (
    <span
      role="status"
      aria-label={`connection ${status}`}
      title={`connection: ${status}`}
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: 5,
        background: COLORS[status],
      }}
    />
  );
}
