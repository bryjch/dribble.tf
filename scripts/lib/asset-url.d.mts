/** VITE_APP_ASSET_URL from the environment, else `repoRoot`'s or the main checkout's .env. */
export function findAssetUrl(repoRoot: string): string | null
