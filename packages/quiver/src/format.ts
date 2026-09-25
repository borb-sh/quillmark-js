/**
 * The artifact's format, stamped into its `quiver.json` and refused to be read past
 * (QUIVER §"One file, one version").
 *
 * The document is closed, so any change a reader of this number would misread or reject
 * moves it: a field added, a path renamed, a store keyed by something other than the
 * full hash.
 */
export const FORMAT = 1;

/** The artifact's paths: the document read first, the quills' own files, and the font
 *  store they share. */
export const MANIFEST_PATH = 'quiver.json';
export const QUILLS_DIR = 'quills/';
export const FONTS_DIR = 'fonts/';
