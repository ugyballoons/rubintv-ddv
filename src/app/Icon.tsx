const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  chart: 'M4 19h16M6 16l4-6 4 3 5-8',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  detector: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  filter: 'M4 5h16l-6 8v5l-4 2v-7z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  clear: 'M6 6l12 12M18 6L6 18',
  trash: 'M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13',
  axes: 'M5 3v16h16M5 19l4-4M5 19l-2-4',
  reset: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
  sync: 'M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4',
  select: 'M5 4l14 8-6 2-2 6z',
  drill: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5',
  play: 'M7 4l12 8-12 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  prev: 'M6 12h12M12 6l-6 6 6 6',
  next: 'M6 12h12M12 6l6 6-6 6',
  column: 'M4 6h16M4 12h16M4 18h16',
  night: 'M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z',
};

/** Inline stroke icons, sized to the text; the accessible name comes from the button. */
export function Icon({ name, size = 15 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
