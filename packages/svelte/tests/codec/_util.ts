// Shared codec test helpers. The store normalizes on write, so round-trips are
// idempotent only up to normalization: `normalize` is the canonical form `replace`
// stores, so tests assert post-normalize equality.
import { expect } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { baseKeymap } from 'prosemirror-commands';
import {
	init,
	type Content,
	type ContentContainer,
	type Document,
	type Quill
} from '@quillmark/wasm';
import { contentEqual } from '$lib/core/codec/reconcile.js';
import {
	blockSchema,
	buildLineIndex,
	decode,
	type FieldController,
	pmToContent,
	pmToOffset,
	offsetToPM
} from '$lib/core/codec';
import { quill, example, literal } from '../helpers/fixtures.js';

export const core = await init();

export { quill, example, literal };
export function freshDoc(): Document {
	return example();
}

/** The canonical (normalized) form of `rt`: what `replace` stores from it. */
export function normalize(rt: Content): Content {
	return core.normalize(rt);
}

/** Each block's containers, outermost first: the records its `path` names. */
export function pathsOf(rt: Content): ContentContainer[][] {
	const byId = new Map((rt.containers ?? []).map((c) => [c.id, c]));
	return rt.blocks.map((b) => (b.path ?? []).map((id) => byId.get(id)!));
}

/** One nesting level of a block: an item as its list's attrs, its place among the list's
 *  items and its own `checked`, or a quote. */
export type Level =
	| {
			container: 'list_item';
			attrs: { ordered: boolean; start: number; ordinal: number; checked?: boolean };
	  }
	| { container: 'quote' };

/** Each block's levels, outermost first: its path read as the nesting a reader sees. */
export function levelsOf(rt: Content): Level[][] {
	const items = new Map<string, string[]>();
	return pathsOf(rt).map((path) => {
		const out: Level[] = [];
		path.forEach((c, i) => {
			if (c.kind === 'quote') out.push({ container: 'quote' });
			if (c.kind !== 'item') return;
			const list = path[i - 1]!;
			if (list.kind !== 'list') return;
			const seen = items.get(list.id) ?? [];
			if (!seen.includes(c.id)) seen.push(c.id);
			items.set(list.id, seen);
			out.push({
				container: 'list_item',
				attrs: {
					ordered: list.attrs.ordered,
					start: list.attrs.start,
					ordinal: seen.indexOf(c.id),
					...(c.attrs?.checked !== undefined && { checked: c.attrs.checked })
				}
			});
		});
		return out;
	});
}

/** Each block's nesting depth, as the store counts it: a list's item or a quote is a
 *  level, the list around an item none. */
export function depthsOf(rt: Content): number[] {
	return pathsOf(rt).map((path) => path.filter((c) => c.kind !== 'list').length);
}

/** `rt` with its block and container ids renamed by order of appearance: the value a
 *  reader sees, which two spellings of one edit agree on where their ids differ. */
export function unnamed(rt: Content): Content {
	const names = new Map<string, string>();
	const name = (id: string) =>
		names.get(id) ?? (names.set(id, `c${names.size}`), `c${names.size - 1}`);
	const blocks = rt.blocks.map((b, i) => ({
		...b,
		id: `b${i}`,
		...(b.path && { path: b.path.map(name) })
	}));
	const containers = rt.containers?.map((c) => ({ ...c, id: name(c.id) }));
	return { ...rt, blocks, ...(containers && { containers }) };
}

/** Content value-equality (key-order-insensitive), re-exported for assertions. */
export { contentEqual };

/** A content from markdown; a guaranteed-valid `Content` for test inputs. */
export function md(markdown: string): Content {
	return core.importMarkdown(markdown).content;
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

/** The view a controller holds as an undocumented handle. */
export const viewOf = (f: FieldController): EditorView =>
	(f as FieldController & { view: EditorView }).view;

/** A quill over `yaml` and a one-line plate: for a suite whose variable no fixture
 *  quill isolates. */
export function probeQuill(yaml: string): Quill {
	// Re-wrapped in this realm's `Uint8Array`: under jsdom the encoder's output comes
	// from another realm and the boundary refuses it by identity.
	const bytes = (s: string): Uint8Array => new Uint8Array(new TextEncoder().encode(s));
	return core.Quill.fromTree(
		new Map([
			['Quill.yaml', bytes(yaml)],
			['plate.typ', bytes('#set page(width: 200pt)\n')]
		])
	);
}

/** Drive one key at a mounted view the way the browser does, through the props the
 *  plugin stack registered. `init` carries the modifiers, which prosemirror-keymap
 *  reads off the event rather than off the key name. `keyDriver` below is the other
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
 * The position map's defining property, asserted over every offset of `doc` off a surrogate pair's middle:
 * `pmToOffset ∘ offsetToPM` is the identity, and every PM position it produces is in range.
 * The index is built fresh here, so a caller that mutated the doc asserts against the
 * rebuilt map rather than a stale one.
 *
 * One helper for every caller: the property does not change with the doc's origin, so a
 * decode (positions.test.ts) and a structural edit (roundtrip.test.ts) assert it
 * identically.
 */
export function assertPositionInverse(doc: PMNode, label = 'position map'): void {
	const index = buildLineIndex(doc);
	const { text } = pmToContent(doc);
	const broken: string[] = [];
	for (let p = 0; p <= text.length; p++) {
		const low = text.charCodeAt(p);
		if (low >= 0xdc00 && low <= 0xdfff) continue;
		const pm = offsetToPM(index, p);
		const back = pm >= 0 && pm <= doc.content.size ? pmToOffset(index, pm) : NaN;
		if (back !== p) broken.push(`${p} → PM ${pm} → ${back}`);
	}
	expect(broken, label).toEqual([]);
}
