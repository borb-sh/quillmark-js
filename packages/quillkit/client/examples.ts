// The quill's example document, opened in the blank seed's stead, for a quill author
// judging a page the seed cannot show them (STUDIO §"The document is the blueprint's").
import type { Diagnostic, Document, Quill } from '@quillmark/wasm';
import { diagnosticsOf } from './notes';

/** A preference and not a document, so it outlives the tab where nothing the document
 *  holds does. Absent is on. */
const KEY = 'quillkit.studio.examples';

/** Whether a quill opens on its example. Storage a private window refuses reads as on. */
export function examplesOn(): boolean {
	try {
		return localStorage.getItem(KEY) !== 'off';
	} catch {
		return true;
	}
}

export function sayExamples(on: boolean): void {
	try {
		if (on) localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, 'off');
	} catch {
		// Held for this tab alone.
	}
}

/**
 * The quill's root `example.md`, conformed against it, with what the conform stranded;
 * no `doc` where the quill ships none. One that will not open strands its refusal
 * rather than dropping it, and the caller seeds in its place.
 */
export function openExample(quill: Quill): { doc?: Document; stranded: Diagnostic[] } {
	try {
		const doc = quill.exampleDocument();
		return { doc, stranded: doc?.warnings ?? [] };
	} catch (err) {
		return { stranded: diagnosticsOf(err) };
	}
}
