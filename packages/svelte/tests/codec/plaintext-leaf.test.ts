// @vitest-environment jsdom
// A `plaintext` leaf over a field resting as an authored string: the case where the
// declared type is the whole difference. The same bytes are markdown under `richtext`
// and literal text under `plaintext`, so a leaf that picked one codec for both would
// eat every `*` a plaintext author typed, then commit a delta computed against text
// the document never held.
//
// A suite that does not run on the reference quill: that quill declares both
// types (`subtitle` plaintext, `epigraph` inline richtext) but no two fields differing
// in nothing else. So the schema is built here and stays minimal: two content fields
// differing only in declared type, which is the entire variable.
import { describe, it, expect } from 'vitest';
import { init, type Content, type Document, type Quill } from '@quillmark/wasm';
import { createField, hasMarks } from '$lib/core/codec';
import type { FieldController } from '$lib/core/codec';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const core = await init();

const QUILL_YAML = `
quill:
  name: codec_probe
  version: 0.1.0
  backend: typst
  description: Two content fields differing only in declared type.
typst:
  plate_file: plate.typ
main:
  body:
    example: |
      Body.
  fields:
    note:
      type: plaintext
      example: literal
    tag:
      type: richtext
      inline: true
      example: markdown
`;

function probeQuill(): Quill {
	// Re-wrapped in this realm's `Uint8Array`: under jsdom the encoder's output comes
	// from another realm and the boundary refuses it by identity.
	const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
	return core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(QUILL_YAML)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);
}

function mount(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}
const viewOf = (f: FieldController): EditorView =>
	(f as FieldController & { view: EditorView }).view;

const AUTHORED = 'Wing *Motto* Here';
/** Both content fields authored with the same bytes, through the transport door so
 *  neither is conformed. Hand-written rather than round-tripped, because a serialize
 *  would escape the asterisks and the contrast is what escaping erases. */
const authored = (): Document =>
	core.Document.fromMarkdown(
		[
			'~~~',
			'$quill: codec_probe@0.1.0',
			'$kind: main',
			`note: ${AUTHORED}`,
			`tag: ${AUTHORED}`,
			'~~~',
			'',
			'Body.',
			''
		].join('\n')
	);

describe('a plaintext leaf over an authored string', () => {
	it('reads the bytes literally, while richtext reads the same bytes as markdown', () => {
		const q = probeQuill();
		const doc = authored();
		expect(typeof doc.getStored('note')).toBe('string');

		const reader = q.reader(doc);
		const plain = reader.getContent('note')!;
		const rich = reader.getContent('tag')!;

		expect(plain.text).toBe(AUTHORED);
		expect(plain.marks).toHaveLength(0);
		// The same string, decoded by the other declared type: delimiters consumed,
		// emphasis carried as a mark.
		expect(rich.text).toBe('Wing Motto Here');
		expect(rich.marks).toHaveLength(1);

		doc.free();
	});

	it('mounts the literal text, asterisks intact', () => {
		const q = probeQuill();
		const doc = authored();
		const field = createField({
			doc,
			quill: q,
			addr: { field: 'note' },
			container: mount(),
			plaintext: true
		});
		expect(field.getContent().text).toBe(AUTHORED);
		field.destroy();
		doc.free();
	});

	it('commits the first edit CLEANLY, taking no recovery path', () => {
		// The commit half. `applyChange` reads an authored string as markdown whatever the
		// declared type, so a delta over the literal content would meet a shorter
		// pre-image and be refused. The leaf takes no op path at all: it hands its text to
		// the typed writer, which rests the field as the literal string.
		const q = probeQuill();
		const doc = authored();
		const errors: string[] = [];
		const field = createField({
			doc,
			quill: q,
			addr: { field: 'note' },
			container: mount(),
			plaintext: true,
			onError: (e) => errors.push(e.code)
		});

		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('!', 1));
		expect(errors).toEqual([]);
		expect(field.getContent().text).toBe(`!${AUTHORED}`);
		expect(q.reader(doc).getContent('note')!.text).toBe(`!${AUTHORED}`);
		// The literal string, asterisks unescaped: the rest form `toMarkdown` round-trips.
		expect(doc.getStored('note')).toBe(`!${AUTHORED}`);

		// And the next edit over that rest form is still literal.
		view.dispatch(view.state.tr.insertText('?', 2));
		expect(errors).toEqual([]);
		expect(doc.getStored('note')).toBe(`!?${AUTHORED}`);

		field.destroy();
		doc.free();
	});
});

describe('a plaintext leaf carries no marks', () => {
	// The field's value is literal text, and the boundary refuses to coerce a marked
	// content back to `plaintext` — the document renders with an error instead. The
	// commit path does not catch it (`applyChange` takes the mark op), so the mark must
	// be unreachable rather than rejected: the leaf mounts a schema declaring no mark
	// types, which is one mechanism covering every path that could mint one.
	function plaintextField(doc: Document, onError?: (code: string) => void): FieldController {
		return createField({
			doc,
			quill: probeQuill(),
			addr: { field: 'note' },
			container: mount(),
			plaintext: true,
			onError: (e) => onError?.(e.code)
		});
	}

	it('has no mark type for a format command to apply', () => {
		const doc = authored();
		const field = plaintextField(doc);
		const { schema } = viewOf(field).state;

		// The two lookups the format popover makes: whether to raise at all, and the
		// type its button would toggle (`FormatPopover.sync` / `toggle`). Every one of
		// the six is fetched by name off the view's schema, so `strong` stands for the set.
		expect(hasMarks(schema)).toBe(false);
		expect(schema.marks.strong).toBeUndefined();

		field.destroy();
		doc.free();
	});

	it('parses a pasted mark away, keeping the text', () => {
		const doc = authored();
		const field = plaintextField(doc);
		const view = viewOf(field);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1)));
		// jsdom implements no `ClipboardEvent`, and the paste path reads nothing off the
		// one `pasteHTML` wants: a bare event carries it.
		view.pasteHTML(
			'<p><strong>bold</strong> plain</p>',
			new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
		);

		expect(field.getContent().marks).toHaveLength(0);
		expect(field.getContent().text).toBe(`bold plain${AUTHORED}`);

		field.destroy();
		doc.free();
	});

	it('opens a value that already carries one, and drops it on the next commit', () => {
		// The state an older build left behind: a strong mark on a plaintext field, which
		// renders as a coercion error. Decode strips it, so the leaf shows the text, and
		// the first keystroke commits the text back as the literal string.
		const doc = authored();
		const marked: Content = {
			text: AUTHORED,
			lines: [{ containers: [], kind: 'para' }],
			marks: [{ type: 'strong', start: 0, end: 4 }],
			islands: []
		};
		doc.overwrite('note', marked);
		expect((doc.getStored('note') as Content).marks).toHaveLength(1);

		const codes: string[] = [];
		const field = plaintextField(doc, (c) => codes.push(c));
		const view = viewOf(field);
		expect(view.state.doc.textContent).toBe(AUTHORED);

		view.dispatch(view.state.tr.insertText('!', 1));
		expect(codes).toEqual([]);
		expect(doc.getStored('note')).toBe(`!${AUTHORED}`);
		expect(field.getContent().marks).toHaveLength(0);

		field.destroy();
		doc.free();
	});
});
