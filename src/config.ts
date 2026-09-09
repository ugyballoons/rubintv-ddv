/** Mirrors the Flutter .env semantics: ADDRESS -> VITE_DDV_WS_PATH, PORT -> VITE_DDV_WS_PORT. */
export function websocketUrl(loc: Location = window.location): string {
  const protocol = loc.protocol === 'https:' ? 'wss' : 'ws';
  const path = (import.meta.env.VITE_DDV_WS_PATH ?? 'rubintv/ws/ddv').replace(/^\/+|\/+$/g, '');
  const port = import.meta.env.VITE_DDV_WS_PORT
    ? `:${import.meta.env.VITE_DDV_WS_PORT}`
    : loc.port
      ? `:${loc.port}`
      : '';
  return `${protocol}://${loc.hostname}${port}/${path}/client`;
}

export const APP_VERSION: string = __APP_VERSION__;
