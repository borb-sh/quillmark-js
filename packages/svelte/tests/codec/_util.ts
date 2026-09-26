// Shared codec test helpers. A real Document is the normalizer: the content
// normalizes on write, so round-trips are idempotent only up to normalization:
// `normalize` installs a Content and reads it back through the WASM content so
// tests assert post-normalize equality.
import { expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { baseKeymap } from 'prosemirror-commands';
import { init, type Content, type Document } from '@quillmark/wasm';
import { contentEqual } from '$lib/core/codec/reconcile.js';
import {
	blockSchema,
	buildLineIndex,
	decode,
	pmToContent,
	pmToUsv,
	usvLength,
	usvToPM
} from '$lib/core/codec';
import { quill, template } from '../helpers/fixtures.js';

const core = await init();

export { quill, template };
export function freshDoc(): Document {
	return template();
}

/** Install `rt` into a fresh main body and read it back; the canonical (normalized) form. */
export function normalize(rt: Content): Content {
	const doc = freshDoc();
	doc.overwrite({}, rt);
	return doc.main.body;
}

/** Content value-equality (key-order-insensitive), re-exported for assertions. */
export { contentEqual };

/** A content from markdown; a guaranteed-valid `Content` for test inputs. */
export function md(markdown: string): Content {
	return core.importMarkdown(markdown);
}

/** The reference quill's seeded `title` (inline richtext) content. */
export function titleContent(): Content {
	return freshDoc().getStored('title') as Content;
}
/** The reference quill's seeded main body content. */
export function bodyContent(): Content {
	return freshDoc().main.body;
}

/** The doc's textblocks in document order, with their content-start positions. */
export function textblocks(doc: PMNode): { node: PMNode; start: number }[] {
	const out: { node: PMNode; start: number }[] = [];
	doc.descendants((node, pos) => {
		if (node.isTextblock) out.push({ node, start: pos + 1 });
		return !node.isTextblock;
	});
	return out;
}

/** A state with the caret at the start of the `index`-th textblock; where every
 * structural key branches, and the only way to address an empty item (it carries
 * no text to anchor on). */
export function atBlock(doc: PMNode, index: number): EditorState {
	const block = textblocks(doc)[index];
	if (!block) throw new Error(`no textblock at index ${index}`);
	return EditorState.create({ doc, selection: TextSelection.create(doc, block.start) });
}

/** A state with the caret at the end of the `index`-th textblock: the other side of
 * every boundary `atBlock` addresses, where a delete is about the block below rather
 * than about a character. */
export function atBlockEnd(doc: PMNode, index: number): EditorState {
	const block = textblocks(doc)[index];
	if (!block) throw new Error(`no textblock at index ${index}`);
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, block.start + block.node.content.size)
	});
}

/** A state over `markdown` with the caret at the start of the `index`-th textblock. */
export function startOf(markdown: string, index: number): EditorState {
	return atBlock(decode(md(markdown), blockSchema), index);
}

/** A state over `markdown` with the caret at the end of the `index`-th textblock. */
export function endOf(markdown: string, index: number): EditorState {
	return atBlockEnd(decode(md(markdown), blockSchema), index);
}

/** Run `cmd`; the new state, or null when the command declined the key. */
export function run(state: EditorState, cmd: Command): EditorState | null {
	let out: EditorState | null = null;
	const handled = cmd(state, (tr) => {
		out = state.apply(tr);
	});
	return handled ? out : null;
}

/** A container in the jsdom document for a mounted view: what every leaf test opens
 *  with, and what a `createField` needs to hold a view at all. */
export function mount(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	return el;
}

/** Drive one key at a mounted view the way the browser does, through the props the
 *  plugin stack registered. `init` carries the modifiers, which prosemirror-keymap
 *  reads off the event rather than off the key name. The `keyDriver` above is the other
 *  half of this: it runs a keymap directly, without a view, where what is under test is
 *  the binding. */
export function press(view: EditorView, key: string, init: KeyboardEventInit = {}): void {
	const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init });
	view.someProp('handleKeyDown', (f) => f(view, event));
}

/** `doc(bullet_list(list_item(paragraph("a"))))`: PM's own compact rendering. */
export const shape = (state: EditorState): string => state.doc.toString();

/** The mutation survives the boundary: encode → normalize → decode is a fixpoint. A
 * command that produces a shape `Content` cannot hold would pass a doc-shape
 * assertion and still lose the user's edit on commit. */
export function representable(state: EditorState): boolean {
	const stored = normalize(pmToContent(state.doc));
	return decode(stored, blockSchema).toString() === state.doc.toString();
}

/**
 * A press-and-check driver over one bound keymap: the leaf's own bindings, falling
 * through to `baseKeymap` exactly as the plugin stack does (`proseLeafPlugins`
 * mounts `editorKeymap` over `baseKeymap`).
 *
 * One driver for every caller: what a press means does not change with which link
 * of the chain is under test, so the list keys and the code-block keys drive
 * identically and differ only in the keymap passed in.
 */
export function keyDriver(keys: Record<string, Command>) {
	/** Run the leaf's binding for `key`, falling through to the base keymap. */
	function press(state: EditorState, key: string): EditorState {
		const bound = keys[key] ? run(state, keys[key]) : null;
		if (bound) return bound;
		const base = baseKeymap[key] ? run(state, baseKeymap[key]) : null;
		return base ?? state;
	}

	/** Assert a press's result and its representability in one place. */
	function expectPress(state: EditorState, key: string, expected: string): EditorState {
		const next = press(state, key);
		expect(shape(next)).toBe(expected);
		expect(representable(next), `not representable: ${shape(next)}`).toBe(true);
		return next;
	}

	return { press, expectPress };
}

/**
 * The position map's defining property, asserted over every USV offset of `doc`:
 * `pmToUsv ∘ usvToPM` is the identity, and every PM position it produces is in range.
 * The index is built fresh here, so a caller that mutated the doc asserts against the
 * rebuilt map rather than a stale one.
 *
 * One helper for every caller: the property does not change with the doc's origin, so a
 * decode (positions.test.ts) and a structural edit (roundtrip.test.ts) assert it
 * identically.
 */
export function assertPositionInverse(doc: PMNode, label = 'position map'): void {
	const index = buildLineIndex(doc);
	const total = usvLength(pmToContent(doc).text);
	for (let p = 0; p <= total; p++) {
		const pm = usvToPM(index, p);
		expect(pm, `${label}: usvToPM(${p}) below range`).toBeGreaterThanOrEqual(0);
		expect(pm, `${label}: usvToPM(${p}) above range`).toBeLessThanOrEqual(doc.content.size);
		expect(pmToUsv(index, pm), `${label}: roundtrip at USV ${p}`).toBe(p);
	}
}
