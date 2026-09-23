/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_LANGUAGE?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_ACCENT_COLOR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
