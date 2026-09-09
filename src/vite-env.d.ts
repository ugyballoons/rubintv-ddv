/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
interface ImportMetaEnv {
  readonly VITE_DDV_WS_PATH?: string;
  readonly VITE_DDV_WS_PORT?: string;
}
