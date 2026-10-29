// The quill's example document, opened in the blank seed's stead, for a quill author
// judging a page the seed cannot show them (STUDIO §"The document is the blueprint's").

/** A preference, so it outlives the tab. Absent is on. */
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
