// The schema's `example:`s written as answers, so a harness over a quill with no
// template reaches the value branches its seed leaves empty. Studio carries its own
// (quillkit `client/examples.ts`), the bridge being each consumer's rather than shared.
import {
	isQuillmarkError,
	type Diagnostic,
	type Document,
	type Quill,
	type QuillCardSchema
} from '@quillmark/wasm';

const diagnosticsOf = (err: unknown): Diagnostic[] =>
	isQuillmarkError(err)
		? err.diagnostics
		: [{ severity: 'error', message: err instanceof Error ? err.message : String(err) }];

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
