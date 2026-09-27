// @vitest-environment jsdom
// A retype keeps the card's session id, so a field of the same name on the new kind
// would keep its mounted leaf; but a prose leaf takes its schema and its commit path
// from the declared type once, at mount. A field whose codec the retype changes
// remounts on the new kind's type, so an edit after it stores what that type stores:
// a `richtext` leaf a content object whose text keeps the delimiters typed, a
// `plaintext` one the literal string a saved document reads back unchanged. The probe
// is its own quill: two kinds holding one `note` field each, one codec apiece.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Content, Document, Quill } from '@quillmark/wasm';
import { hasMarks } from '$lib/core/codec';
import { quillFromYaml } from '../helpers/fixtures.js';
import { activeView, mountInner, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const YAML = `quill:
  name: retype_codec
  version: 1.0.0
  backend: typst
  description: Two kinds, one field name, two codecs.
typst:
  plate_file: plate.typ
main:
  fields:
    author:
      type: string
card_kinds:
  plainnote:
    fields:
      note:
        type: plaintext
  richnote:
    fields:
      note:
        type: richtext
`;
const probe = () => quillFromYaml(YAML);

/** A card of kind `from` retyped to `to`, and `text` typed into its `note` leaf. */
async function retypeAndType(q: Quill, doc: Document, from: string, to: string, text: string) {
	const { editor, errors } = mountInner(q, doc);
	const id = editor.insertCard(from)!;
	flushSync();
	editor.setKind(id, to);
	flushSync();
	await editor.focusField(`cards.${to}[0].note`);
	const view = activeView(editor);
	view.dispatch(view.state.tr.insertText(text, 1));
	flushSync();
	return { view, errors };
}

/** The field as a saved document reads it back: `toMarkdown`, a fresh parse, and the
 *  schema-bound content read. */
function savedText(q: Quill, doc: Document): string | undefined {
	const back = q.parse(doc.toMarkdown());
	const text = q.reader(back).getContent({ card: 0, field: 'note' })?.text;
	back.free();
	return text;
}

describe('a retype that changes the codec under a field name', () => {
	it('remounts a plaintext leaf as richtext, which stores the delimiters typed as text', async () => {
		const q = probe();
		const doc = q.emptyDocument();
		const { view, errors } = await retypeAndType(q, doc, 'plainnote', 'richnote', 'a *b* c');

		expect(hasMarks(view.state.schema)).toBe(true);
		expect(errors).toEqual([]);
		const stored = doc.getStored({ card: 0, field: 'note' }) as Content;
		expect(stored.text).toBe('a *b* c');
		expect(stored.marks).toEqual([]);
		expect(savedText(q, doc)).toBe('a *b* c');
	});

	it('remounts a richtext leaf as plaintext, which stores its literal string', async () => {
		const q = probe();
		const doc = q.emptyDocument();
		const { view, errors } = await retypeAndType(q, doc, 'richnote', 'plainnote', 'x  y *z*');

		expect(hasMarks(view.state.schema)).toBe(false);
		expect(errors).toEqual([]);
		expect(doc.getStored({ card: 0, field: 'note' })).toBe('x  y *z*');
		expect(savedText(q, doc)).toBe('x  y *z*');
	});
});
