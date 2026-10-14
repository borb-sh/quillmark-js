/** The one name a reader fetches that carries no digest: the catalog, and where every
 *  other name is read off. */
export const INDEX = 'quiver.json';

/**
 * The artifact's format, stamped into `quiver.json` and refused to be read past (QUIVER
 * §"The index"). A change a reader assuming the previous shape would misread moves it; an
 * added field a reader can skip does not.
 */
export const FORMAT = 2;

/**
 * What a reader of format 1 fetches first. It reads `format` off it before anything else,
 * so a file carrying this format and nothing more is refused there with the upgrade named,
 * rather than as a missing file. No reader of this format reads it.
 */
export const LEGACY_POINTER = 'latest.json';
