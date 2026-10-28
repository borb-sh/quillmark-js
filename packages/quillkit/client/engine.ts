// The engine both clients render through, built over `@quillmark/fonts`: the font library
// every Quillmark client hands its engine, so a family a document names sets here as it
// sets in any other client that loads the suite (FONTS §"The suite").
import { loadSuite } from '@quillmark/fonts';
import { Engine } from '@quillmark/wasm';
import type { FontFace, Quill } from '@quillmark/wasm';

export { LABELS as fontLabels } from '@quillmark/fonts';

/**
 * An engine over the suite, started at boot beside the core and the quiver. The engine
 * reads its library when the render build first loads, so the suite is on the path to the
 * first page and never to the form. A suite that will not load rejects this, and with it
 * every open that awaits it.
 */
export function engineOverSuite(): Promise<Engine> {
	return loadSuite().then((fonts) => new Engine({ fonts }));
}

/**
 * The faces the editor's font picker offers for `quill`, or none where they cannot be read.
 * Asked once a session stands: listing them loads the render build, which the open has, and
 * a library the build refused already refused the open, whose failure says so.
 */
export function facesFor(engine: Engine, quill: Quill): Promise<FontFace[]> {
	return engine.fontFaces(quill).catch(() => []);
}
