// The schema's `example:`s written as answers, for a quill author judging a page the
// blank seed cannot show them (STUDIO §"The document is the blueprint's").
import type { Diagnostic, Document, Quill, QuillCardSchema } from '@quillmark/wasm';
import { diagnosticsOf } from './notes';

/** A preference and not a document, so it outlives the tab where nothing the document
 *  holds does. Absent is on. */
const KEY = 'quillkit.studio.examples';

/** Whether a seed is filled. Storage a private window refuses reads as on. */
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

/** A read throws on a stored value its codec cannot decode, which is still an answer. */
function answered(read: () => unknown): boolean {
	try {
		return read() != null;
	} catch {
		return true;
	}
}

/**
 * Write each unanswered top-level field's `example:` onto `doc`, on the main card and
 * every composable card, through the typed writer. Returns how many landed and what
 * refused, so an example the writer will not take is said rather than dropped.
 */
export function fillExamples(
	quill: Quill,
	doc: Document
): { filled: number; refused: Diagnostic[] } {
	const { main, card_kinds } = quill.schema;
	const reader = quill.reader(doc);
	const writer = quill.writer(doc);
	let filled = 0;
	const refused: Diagnostic[] = [];

	const fill = (
		schema: QuillCardSchema | undefined,
		get: (name: string) => unknown,
		set: (name: string, value: unknown) => void
	): void => {
		for (const [name, field] of Object.entries(schema?.fields ?? {})) {
			if (field.example === undefined || answered(() => get(name))) continue;
			try {
				set(name, field.example);
				filled++;
			} catch (err) {
				refused.push(...diagnosticsOf(err));
			}
		}
	};

	fill(
		main,
		(n) => reader.get(n),
		(n, v) => writer.set(n, v)
	);
	for (let i = 0; i < doc.cardCount; i++) {
		const card = reader.card(i);
		const at = writer.card(i);
		fill(
			card_kinds?.[card.kind],
			(n) => card.get(n),
			(n, v) => at.set(n, v)
		);
	}
	return { filled, refused };
}
