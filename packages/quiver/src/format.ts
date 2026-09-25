/** The one name in a built artifact that carries no digest: the catalog, and where every
 *  other name is read off. */
export const INDEX = 'quiver.json';

/**
 * The artifact's format, stamped into `quiver.json` and refused to be read past (QUIVER
 * §"The index"). Any change a reader assuming the previous shape would misread or reject
 * moves it: `quiver.json` is closed, so an added field is one of those.
 */
export const FORMAT = 1;
