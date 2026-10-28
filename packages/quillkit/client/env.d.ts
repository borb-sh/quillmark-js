/** What this bundle carries, keyed by registry name, substituted at build time by the Vite
 *  config. Versions rather than ranges: they name the copies that are here, which is what
 *  the head reports and what a bug report needs. `dist/client/carried.json` beside the
 *  bundle holds the same four. */
declare const __CARRIED__: Readonly<Record<string, string>>;
