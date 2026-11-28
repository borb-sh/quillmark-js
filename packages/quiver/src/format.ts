/** The one name a reader fetches that carries no digest: the catalog, and where every
 *  other name is read off. */
export const INDEX = 'quiver.json';

/**
 * The artifact's format, stamped into `quiver.json` and read at exactly this value (INVARIANTS
 * §"The format is read before anything else is believed"). A change a reader assuming the previous shape would misread moves it; an
 * added field a reader can skip does not. Format 3 is one `.quill` bundle per quill and no
 * `fonts/`.
 */
export const FORMAT = 3;
