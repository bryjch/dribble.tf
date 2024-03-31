/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_ASSET_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
