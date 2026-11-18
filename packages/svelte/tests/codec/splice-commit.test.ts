// @vitest-environment jsdom
// A text edit inside one block commits as one splice against the hash the leaf last wrote, and
// the leaf then holds the value it sent without reading the field back: what it holds is the
// store's value after every such edit, at mark edges, inside links, beside anchors and over
// surrogate pairs; a structural edit and a store written behind the leaf's back take the diff.
import { describe, it, expect, beforeEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Change, Document } from '@quillmark/wasm';
import { createField } from '$lib/core/codec';
import type { FieldController } from '$lib/core/codec';
import { spliceOf } from '$lib/core/codec/encode.js';
import { mount, quill, example, md, viewOf, press, contentEqual } from './_util.js';

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const BODY = [
	'# Heading **bold** end',
	'Plain then **strong run** and *emph run* and [a link](https://example.com) and `code` tail 😀 x.',
	'- item **one**\n- item [two](https://example.org)\n    - nested *three*',
	'Last paragraph.'
].join('\n\n');

/** The splices `doc.apply` took with a base, counted, and the field over the body. */
function setup(doc: Document): { field: FieldController; based: () => number } {
	doc.replace({}, md(BODY));
	let based = 0;
	const apply = doc.apply.bind(doc);
	doc.apply = (addr, change, opts) => {
		const receipt = apply(addr, change, opts);
		if (opts?.base) based++;
		return receipt;
	};
	const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
	return { field, based: () => based };
}

/** Whether the leaf holds the stored value: a re-read then keeps its state. */
function holdsStored(field: FieldController): boolean {
	const view = viewOf(field);
	const state = view.state;
	field.applyExternal();
	return view.state === state;
}

/** Whether offset `i` of `s` falls inside a surrogate pair, where no caret stands. */
function splitsPair(s: string, i: number): boolean {
	const c = s.charCodeAt(i);
	return c >= 0xdc00 && c <= 0xdfff;
}

/** A deterministic PRNG, so a failing walk replays. */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}

/** Every text position in the doc that sits inside a textblock, with that block's bounds. */
function textPositions(field: FieldController): { pos: number; start: number; end: number }[] {
	const out: { pos: number; start: number; end: number }[] = [];
	viewOf(field).state.doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		const start = pos + 1;
		const end = pos + 1 + node.content.size;
		const text = node.textBetween(0, node.content.size, undefined, '\ufffc');
		for (let p = start; p <= end; p++)
			if (!splitsPair(text, p - start)) out.push({ pos: p, start, end });
		return false;
	});
	return out;
}

describe('a text edit inside one block', () => {
	let doc: Document;
	beforeEach(() => {
		doc = example();
	});

	it.each([7, 11, 23])(
		'holds the stored value after each step of walk %i: typing, deleting, formatting',
		(seed) => {
			const { field, based } = setup(doc);
			const view = viewOf(field);
			field.insertAnchor('a1', 20, 30);
			field.insertAnchor('a2', 60);
			const next = rng(seed);
			const schema = view.state.schema;
			for (let i = 0; i < 300; i++) {
				const all = textPositions(field);
				const { pos, start, end } = all[Math.floor(next() * all.length)];
				const r = next();
				let tr = view.state.tr;
				if (r < 0.45) {
					tr = tr.setSelection(TextSelection.create(tr.doc, pos));
					const m = next();
					if (m < 0.2) tr = tr.addStoredMark(schema.marks.strong.create());
					else if (m < 0.3)
						tr = tr.addStoredMark(schema.marks.link.create({ href: 'https://q.r' }));
					view.dispatch(tr.insertText(next() < 0.1 ? '😀' : 'xy'.slice(0, 1 + (i % 2))));
				} else if (r < 0.75) {
					const to = Math.min(end, pos + 1 + Math.floor(next() * 3));
					if (to <= pos || !all.some((p) => p.pos === to)) continue;
					view.dispatch(tr.delete(pos, to));
				} else {
					const to = Math.min(end, pos + Math.floor(next() * 5));
					if (pos < start || to <= pos || !all.some((p) => p.pos === to)) continue;
					view.dispatch(tr.insertText('Q', pos, to));
				}
				expect(holdsStored(field), `step ${i}`).toBe(true);
			}
			expect(based()).toBeGreaterThan(200);
			field.destroy();
		}
	);

	it('takes the diff for an Enter, and splices again after it', () => {
		const { field, based } = setup(doc);
		const view = viewOf(field);
		field.setCaret(4);
		view.dispatch(view.state.tr.insertText('a', view.state.selection.head));
		const typed = based();
		press(view, 'Enter');
		expect(based()).toBe(typed);
		expect(holdsStored(field)).toBe(true);
		view.dispatch(view.state.tr.insertText('b', view.state.selection.head));
		expect(based()).toBe(typed + 1);
		expect(holdsStored(field)).toBe(true);
		field.destroy();
	});

	it('takes the diff over a store written behind its back, keeping that write', () => {
		const { field } = setup(doc);
		const view = viewOf(field);
		field.setCaret(4);
		view.dispatch(view.state.tr.insertText('a', view.state.selection.head));
		view.dispatch(view.state.tr.insertText('b', view.state.selection.head));
		const last = doc.getStored({}) as { text: string };
		doc.apply({}, { steps: [{ splice: { at: last.text.length - 1, insert: 'Z' } }] });
		view.dispatch(view.state.tr.insertText('c', view.state.selection.head));
		const text = field.getContent().text;
		expect(text.slice(0, 7)).toBe(viewOf(field).state.doc.textContent.slice(0, 7));
		expect(text.endsWith('Z.')).toBe(true);
		field.destroy();
	});
});

describe('spliceOf', () => {
	const splice = (change: Change | null) =>
		change && 'splice' in change.steps[0] ? change.steps[0].splice : null;

	it('names one splice with the marks the insert carries', () => {
		const before = md('one **two** three');
		const after = md('one **twoX** three');
		expect(splice(spliceOf(before, after))).toEqual({
			at: 7,
			insert: 'X',
			marks: [{ start: 0, end: 1, type: 'strong' }]
		});
	});

	it('answers null where blocks change, text is equal, or only formatting moves', () => {
		expect(spliceOf(md('a b'), md('a\n\nb'))).toBeNull();
		expect(spliceOf(md('a b'), md('a b'))).toBeNull();
		expect(spliceOf(md('a b'), md('a **b**'))).toBeNull();
	});

	it('leaves the value it names, as the store writes it', () => {
		const before = md('one **two** [link](https://x.y) three');
		const change = spliceOf(before, md('one **twX** [link](https://x.y) three'));
		expect(change).not.toBeNull();
		const doc = example();
		doc.replace({}, before);
		doc.apply({}, change!);
		expect(
			contentEqual(doc.getStored({}) as never, md('one **twX** [link](https://x.y) three'))
		).toBe(true);
	});
});
