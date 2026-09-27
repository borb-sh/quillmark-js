// Two structural properties the fixed-example suites miss:
//   (1) decode → lower round-trip under a seeded generator over random line
//       kinds / containers / continues / marks:
//       `normalize(pmToContent(decode(rt))) == normalize(rt)`;
//   (2) the chain the leaf actually runs, under the same generator:
//       `decode → press → pmToContent → lower → applyChange`, asserting the
//       projection validates, the store equals the optimistic PM, the position map
//       still inverts after the structural edit, and the store decodes back to the leaf.
//
// They are different statements about different halves. (1) is about the
// codec's two pure functions and holds over contents a producer can build; (2) is
// about the documents the *keymaps* can reach, which is the larger set — a shape no
// `importMarkdown` produces still has to project.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Content } from '@quillmark/wasm';
import {
	blockSchema,
	bodyKeymap,
	buildLineIndex,
	contentEdit,
	decode,
	inputRulesPlugin,
	lower,
	pmToContent,
	usvLength,
	usvToPM
} from '$lib/core/codec';
import { linebreakPlugin } from '$lib/core/codec/breaks.js';
import {
	assertPositionInverse,
	contentEqual,
	freshDoc,
	keyDriver,
	md,
	normalize
} from './_util.js';

// ── A deterministic PRNG (mulberry32) ───────────────────────────────────────
// Seeded so any failure is reproducible from the reported seed: `Math.random`
// would make a red build un-rerunnable.
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ── A small markdown content generator ───────────────────────────────────────
// Markdown (not raw `Content`) is the source so every sample is a guaranteed-
// valid content via `importMarkdown`: the generator explores line kinds, list/
// quote containers, the hard-break `continues` flag, inline marks, code fences and
// nesting to three levels, while staying clear of islands (own round-trip concerns)
// and mark-on-code overlap, a range no projection carries (CODEC §Marks).
// At most one mark per word, so no overlap that would blur the property under test.
//
// The fence and the nesting are what the fixed suites cover apart and never cross:
// `decode.test.ts` holds the nesting shapes and no code, `code-keys.test.ts` the
// `list_item > code_block` cases and no generation. A fence carries astral characters
// for the same reason a paragraph does —
// a code block's `\n`s ride a `text` run, where PM and USV advance together and an
// off-by-one would show.
const WORDS = ['alpha', 'beta', 'gamma', 'x', 'the', 'quick', '😀', '🎉', '漢字', '日本語'];
const LANGS = ['', '', 'rust', 'typ', 'py'];

function pick<T>(r: () => number, arr: T[]): T {
	return arr[Math.floor(r() * arr.length)];
}

function genInline(r: () => number): string {
	const n = 1 + Math.floor(r() * 4);
	const parts: string[] = [];
	for (let i = 0; i < n; i++) {
		const w = pick(r, WORDS);
		const roll = r();
		if (roll < 0.18) parts.push(`**${w}**`);
		else if (roll < 0.32) parts.push(`*${w}*`);
		else if (roll < 0.42) parts.push(`\`${w}\``);
		else if (roll < 0.48) parts.push(`[${w}](https://ex.com)`);
		else parts.push(w);
	}
	return parts.join(' ');
}

/** A fence, sometimes empty, sometimes carrying a `lang` no editor gesture mints. */
function genFence(r: () => number): string {
	const open = '```' + pick(r, LANGS);
	if (r() < 0.15) return `${open}\n\`\`\``;
	const n = 1 + Math.floor(r() * 3);
	const body = Array.from({ length: n }, () => pick(r, WORDS)).join('\n');
	return `${open}\n${body}\n\`\`\``;
}

/** Prefix every line of a block so it sits one container in: `marker` opens the
 *  first line, its own width continues the rest. A blank line stays blank, which is
 *  what keeps a multi-block item one item. */
function nest(block: string, marker: string): string {
	const pad = ' '.repeat(marker.length);
	return block
		.split('\n')
		.map((line, i) => (i === 0 ? marker + line : line ? pad + line : ''))
		.join('\n');
}

function quoted(block: string): string {
	return block
		.split('\n')
		.map((line) => (line ? `> ${line}` : '>'))
		.join('\n');
}

function genList(r: () => number, depth: number, ordered: boolean): string {
	const start = ordered && r() < 0.3 ? 2 + Math.floor(r() * 4) : 1;
	const items = Array.from({ length: 1 + Math.floor(r() * 3) }, (_, i) =>
		nest(genBlocks(r, depth, r() < 0.3 ? 2 : 1), ordered ? `${start + i}. ` : '- ')
	);
	// A blank line between items only where one spans lines: a tight list and a loose
	// one are two shapes, and both are worth generating.
	return items.join(items.some((item) => item.includes('\n')) ? '\n\n' : '\n');
}

function genBlock(r: () => number, depth: number): string {
	const kind = r();
	if (kind < 0.26) return genInline(r); // paragraph
	if (kind < 0.38) return `# ${genInline(r)}`; // heading
	if (kind < 0.54) return genFence(r);
	if (kind < 0.62) return `${genInline(r)}\\\n${genInline(r)}`; // hard break → `continues`
	if (depth === 0) return genInline(r);
	if (kind < 0.78) return genList(r, depth - 1, false);
	if (kind < 0.9) return genList(r, depth - 1, true);
	return quoted(genBlocks(r, depth - 1, 1 + Math.floor(r() * 2)));
}

function genBlocks(r: () => number, depth: number, n: number): string {
	return Array.from({ length: n }, () => genBlock(r, depth)).join('\n\n');
}

function genMarkdown(r: () => number): string {
	return genBlocks(r, 2, 1 + Math.floor(r() * 5));
}

describe('generative decode → lower round-trip', () => {
	it('is identity up to normalization over random corpora', () => {
		for (let seed = 1; seed <= 200; seed++) {
			const source = genMarkdown(rng(seed));
			const rt = md(source);
			const back = pmToContent(decode(rt, blockSchema));
			expect(contentEqual(normalize(back), normalize(rt)), `seed ${seed}\n${source}`).toBe(true);
		}
	});
});

// ── The chain the leaf runs, under the same generator ────────────────────────
// `decode → press → pmToContent → lower → applyChange`, against a real `Document`,
// with the gestures drawn from the keys `bodyKeymap` binds falling through to
// `baseKeymap`, over the normalizer the leaf mounts beneath them — the composition
// `proseLeafPlugins` assembles, so precedence is under test alongside the codec. Four
// assertions per step, and the first is the one the pure round-trip cannot make:
// **every document the keymaps can reach projects to a valid `Content`**. A projection
// that carries more segments than lines does not throw on the way out; it
// under-specifies the bundle, `applyChange` accepts it, and the field diverges from
// the leaf for the rest of the session.
//
// The fourth closes the loop the other way: the store decodes back to the document the
// writer is looking at. A leaf holding a second spelling of a shape stores and previews
// correctly and still draws something else, until a re-hydrate swaps it out from under
// the caret. It is what `representable` asserts per fixed case (`_util.ts`), against
// the reachable set rather than the written one.

const { press } = keyDriver(bodyKeymap(blockSchema));
const rules = inputRulesPlugin(blockSchema);
const KEYS = ['Enter', 'Backspace', 'Delete', 'Tab', 'Shift-Tab', 'Mod-Enter'];
const SHORTHANDS = ['# ', '> ', '- ', '2. ', '```', '---', '**w** '];

/** Type `text` a character at a time through the input-rule plugin, falling back to
 *  a plain insert where no rule claims the char: the browser's path, without a view
 *  (the plugin's props read `state` / `dispatch` and nothing else off one). */
function type(state: EditorState, text: string): EditorState {
	let cur = state;
	for (const ch of text) {
		const { from, to } = cur.selection;
		const view = {
			state: cur,
			composing: false,
			dispatch: (tr: ReturnType<EditorState['tr']['insertText']>) => {
				cur = cur.apply(tr);
			}
		};
		const input = rules.props.handleTextInput as
			((v: unknown, f: number, t: number, s: string) => boolean) | undefined;
		if (!input?.(view, from, to, ch)) cur = cur.apply(cur.tr.insertText(ch, from, to));
	}
	return cur;
}

/** A random selection: a caret at a USV offset (so never inside a surrogate pair),
 *  widened to a range often enough that the range branches are reached. */
function place(r: () => number, state: EditorState): EditorState {
	const index = buildLineIndex(state.doc);
	const total = usvLength(pmToContent(state.doc).text);
	const usv = (n: number) => usvToPM(index, Math.min(n, total));
	const head = usv(Math.floor(r() * (total + 1)));
	const anchor = r() < 0.2 ? usv(Math.floor(r() * (total + 1))) : head;
	const sel = TextSelection.between(state.doc.resolve(anchor), state.doc.resolve(head));
	return state.apply(state.tr.setSelection(sel));
}

function gesture(r: () => number, state: EditorState): EditorState {
	const roll = r();
	if (roll < 0.1) return type(state, pick(r, SHORTHANDS));
	if (roll < 0.22) return type(state, pick(r, WORDS));
	return press(state, pick(r, KEYS));
}

describe('generative keymap → lower → applyChange', () => {
	it('every document the keymaps reach projects, stores and maps', () => {
		// One scratch `Document` for the normalizer, reused across every step:
		// `overwrite` replaces the content, and seeding a document is what a step costs.
		const scratch = freshDoc();
		const canonical = (rt: Content): Content => {
			scratch.overwrite({}, rt);
			return scratch.main.body;
		};
		for (let seed = 1; seed <= 100; seed++) {
			const r = rng(seed);
			const source = genMarkdown(r);
			const doc = freshDoc();
			doc.overwrite({}, md(source));
			let stored = doc.main.body;
			let state = EditorState.create({
				doc: decode(stored, blockSchema),
				plugins: [linebreakPlugin(blockSchema)]
			});
			for (let step = 0; step < 10; step++) {
				const where = `seed ${seed} step ${step}\n${source}`;
				state = gesture(r, place(r, state));
				const projected = pmToContent(state.doc);
				// (1) valid: `overwrite` is where the content invariants are checked.
				const optimistic = canonical(projected);
				doc.applyChange({}, lower(contentEdit(stored, projected)));
				stored = doc.main.body;
				// (2) the store is what the writer is looking at.
				expect(contentEqual(stored, optimistic), where).toBe(true);
				// (3) the caret still crosses the boundary in both directions.
				assertPositionInverse(state.doc, where);
				// (4) and a re-hydrate draws the leaf back, unchanged.
				expect(decode(stored, blockSchema).toString(), where).toBe(state.doc.toString());
			}
		}
	});
});
