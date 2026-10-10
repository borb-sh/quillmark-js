// @vitest-environment jsdom
// Markdown on the clipboard as text (CODEC §"Markdown at the edges"): a block leaf reads
// text holding a block's line head through `importMarkdown`, so a paste stores what the
// source editor would; any other text, any other leaf, a paste as plain text and a
// clipboard holding HTML keep the reading they had. Each paste is a browser's paste event
// on the leaf, read by the handler ProseMirror registers for one, and asserted on what the
// store holds.
import { describe, it, expect } from 'vitest';
import { splitBlock } from 'prosemirror-commands';
import { Selection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Content, Document } from '@quillmark/wasm';
import { createField } from '$lib/core/codec';
import { core, md, mount, probeQuill, quill, viewOf } from './_util.js';

type Clipboard = Record<string, string>;

/** A paste event jsdom can carry: it implements no `DataTransfer`, and `getData` is all
 *  ProseMirror's paste handler reads. */
function pasteEvent(data: Clipboard = {}): ClipboardEvent {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => data[type] ?? '', setData: () => {} }
	});
	return event as ClipboardEvent;
}

/** A body over `markdown`, its caret on a fresh line below it: where a writer pastes a
 *  draft. An empty `markdown` is an empty body. */
function body(markdown = 'para') {
	const doc = quill().seedDocument();
	doc.overwrite({}, md(markdown));
	const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
	const view = viewOf(field);
	view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
	if (markdown) splitBlock(view.state, view.dispatch);
	return { doc, field, view };
}

/** What a body over `markdown` stores after `data` is pasted on a fresh line below it. */
function pasted(data: Clipboard, markdown = 'para'): Content {
	const { field, view } = body(markdown);
	view.dom.dispatchEvent(pasteEvent(data));
	const content = field.getContent();
	field.destroy();
	return content;
}

const text = (markdown: string): Clipboard => ({ 'text/plain': markdown });

describe('a block leaf reads markdown text', () => {
	// The reported shape: sub-paragraphs drafted as indented bullets, which a literal paste
	// stored as top-level paragraphs reading `- first`.
	it('a bulleted draft lands as a list, its indented items nested', () => {
		const rt = pasted(text('- Purpose\n- Background\n  - first\n  - second\n- Action'));
		expect(core.exportMarkdown(rt)).toBe(
			core.exportMarkdown(md('para\n\n- Purpose\n- Background\n  - first\n  - second\n- Action'))
		);
		expect(rt.lines.at(-2)?.containers).toHaveLength(2);
	});

	// What an LLM chat's copy button writes: markdown and no HTML.
	it('an answer copied out of a chat keeps its heading, marks, list, quote, fence and table', () => {
		const answer = [
			'## Summary',
			'',
			'The unit **completed** the inspection on *time*.',
			'',
			'1. Submit the roster',
			'2. Brief the [commander](https://www.af.mil/)',
			'',
			'> Quoted guidance',
			'',
			'```yaml',
			'grade: O-3',
			'```',
			'',
			'| Grade | Count |',
			'| --- | ---: |',
			'| O-3 | 12 |'
		].join('\n');
		const rt = pasted(text(answer), '');
		expect(core.exportMarkdown(rt)).toBe(core.exportMarkdown(md(answer)));
		expect(rt.islands.map((island) => island.type)).toEqual(['table']);
	});

	it.each([
		['a `*` bullet after a line of prose', 'Tasks:\n* roster\n* brief'],
		['a `+` bullet', '+ roster\n+ brief'],
		['an ordered item closed by `)`', '1) roster\n2) brief'],
		['an indented ordered item', 'Tasks\n\n   3. roster'],
		['a heading', 'Purpose\n\n# Background'],
		['a `~~~` fence', '~~~\ngrade: O-3\n~~~'],
		['a delimiter row with no outer pipes', 'Grade | Count\n--- | ---\nO-3 | 12']
	])('%s opens the parse', (_, markdown) => {
		expect(core.exportMarkdown(pasted(text(markdown), ''))).toBe(core.exportMarkdown(md(markdown)));
	});

	it('a pipe table lands as an island, under an id the paste pass mints past the field’s', () => {
		const rt = pasted(
			text('| a | b |\n|---|---|\n| 1 | 2 |'),
			'| x | y |\n|---|---|\n| 3 | 4 |\n\npara'
		);
		expect(rt.islands.map((island) => island.id)).toEqual(['isl-0', 'isl-1']);
	});

	it('text with no block at a line head stays literal', () => {
		const rt = pasted(text('A dash - mid-sentence\nand **bold** with no block'));
		expect(rt.text).toBe('para\nA dash - mid-sentence\nand **bold** with no block');
		expect(rt.marks).toEqual([]);
		expect(rt.lines.every((line) => line.containers.length === 0)).toBe(true);
	});

	it.each([
		['a `#` with no space after it', '#1 priority\nfor the wing'],
		['a decimal at a line head', 'Budget\n1.5 million'],
		['a rule of dashes', 'Respectfully,\n---\nJ. Doe'],
		['a `**` at a line head', '**Note** the date\nand the time']
	])('%s stays literal', (_, markdown) => {
		expect(pasted(text(markdown)).text).toBe(`para\n${markdown}`);
	});

	it('nesting past the store’s depth stays literal', () => {
		const deep = `${'> '.repeat(101)}x`;
		expect(pasted(text(deep)).text).toBe(`para\n${deep}`);
	});

	// The DOM parse reads the source's own structure, so the text beside it is not read.
	it('HTML on the clipboard is the paste, and the text beside it is not read', () => {
		const rt = pasted({ 'text/html': '<h2>Purpose</h2>', 'text/plain': '# Purpose' });
		expect(rt.lines.at(-1)).toMatchObject({ kind: 'heading', attrs: { level: 2 } });
	});

	// `pasteText` is ProseMirror's paste as plain text, the one a Shift-held paste takes.
	it('a paste as plain text keeps the markdown as text', () => {
		const { doc, field, view } = body();
		view.pasteText('- Purpose\n- Action', pasteEvent());
		expect(doc.main.body.text).toBe('para\n- Purpose\n- Action');
		expect(doc.main.body.lines.every((line) => line.containers.length === 0)).toBe(true);
		field.destroy();
	});
});

// The reference quill declares no block `richtext` field and no `plaintext` one without
// `inline`, so the four leaves are built here.
describe('only a block leaf reads it', () => {
	const q = probeQuill(`
quill:
  name: paste_probe
  version: 0.1.0
  backend: typst
  description: One field per leaf schema.
typst:
  plate_file: plate.typ
main:
  fields:
    notes:
      type: richtext
    summary:
      type: richtext
      inline: true
    address:
      type: plaintext
    line:
      type: plaintext
      inline: true
`);
	const load = (): Document => core.Document.fromMarkdown('~~~\n$quill: paste_probe@0.1.0\n~~~\n');
	const LIST = '- Purpose\n- Action';

	function pasteInto(field: string, opts: { inline?: boolean; plaintext?: boolean }) {
		const doc = load();
		const f = createField({ doc, quill: q, addr: { field }, container: mount(), ...opts });
		const view: EditorView = viewOf(f);
		view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)));
		view.dom.dispatchEvent(pasteEvent(text(LIST)));
		f.destroy();
		return q.reader(doc).getContent(field)!;
	}
	const listed = (rt: Content): boolean => rt.lines.some((line) => line.containers.length);

	it('a block richtext field', () => {
		const rt = pasteInto('notes', {});
		expect(rt.text).toBe('Purpose\nAction');
		expect(rt.lines.every((line) => line.containers.length === 1)).toBe(true);
	});

	it('an inline richtext field keeps the text', () => {
		const rt = pasteInto('summary', { inline: true });
		expect(rt.text).toMatch(/^- Purpose/);
		expect(listed(rt)).toBe(false);
	});

	it('a plaintext field keeps the text, line for line', () => {
		const rt = pasteInto('address', { plaintext: true });
		expect(rt.text).toBe(LIST);
		expect(listed(rt)).toBe(false);
	});

	it('an inline plaintext field keeps the text', () => {
		const rt = pasteInto('line', { plaintext: true, inline: true });
		expect(rt.text).toMatch(/^- Purpose/);
		expect(listed(rt)).toBe(false);
	});
});
