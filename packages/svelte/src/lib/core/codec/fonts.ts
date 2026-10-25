// Font runs: `font_family` marks, which overlap as the store's do, so a text node may
// carry several. On each character the mark starting later sets the family, then the
// shorter mark, then the later name in canonical order (`familyRank`, the engine's
// `family_rank`). A mark's range is the store's: the touching text nodes carrying it, a
// hard break or an inline island ending one, as encode unions a mark (`encode.ts`). The
// winner stands last among a node's family marks, the innermost span, so the leaf draws
// what the render sets: decode orders them so, and `fontRankPlugin` restores it after an
// edit, which can move the winner outside its own range by leaving two marks starting
// together. The family names a face in the registry a host hands the editor
// (`engine.fontFaces(quill)`), which the leaf draws under an alias of its own rather
// than the family's name, so a registry face never joins a family the host page loads.
import { Plugin, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Mark, MarkType, Node as PMNode, Schema } from 'prosemirror-model';
import { fontPastePlugin } from './font-paste.js';

/** The families a leaf can set a run in, read live: a host can hand the editor a new
 *  registry while a leaf is mounted. */
export interface FontRegistry {
	/** The families, `undefined` while the host has handed over no registry. */
	families(): readonly string[] | undefined;
	/** Call `fn` each time the families change; returns the unsubscribe. */
	watch(fn: () => void): () => void;
}

/** The CSS family a registry face registers under: lowercased, as the engine matches a
 *  family, so a run naming `carlito` draws in the face registered for `Carlito`. */
export function fontAlias(family: string): string {
	return `qm ${family.toLowerCase()}`;
}

/** `s` as a CSS string. */
export function cssString(s: string): string {
	return `"${s.replace(/["\\]/g, '\\$&')}"`;
}

/** A family mark's range, in any coordinate the ranges it is ranked against share. */
export interface FamilyRange {
	start: number;
	end: number;
	name: string;
}

/** `a` against `b` in code point order, the order the engine compares strings in. */
function byCodePoint(a: string, b: string): number {
	const x = Array.from(a, (c) => c.codePointAt(0)!);
	const y = Array.from(b, (c) => c.codePointAt(0)!);
	for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
	return x.length - y.length;
}

/** How two family marks over one character rank, ascending, so the winner sorts last. */
export function familyRank(a: FamilyRange, b: FamilyRange): number {
	return (
		a.start - b.start ||
		b.end - a.end ||
		byCodePoint(JSON.stringify({ name: a.name }), JSON.stringify({ name: b.name }))
	);
}

/** A text node's family marks, in its own order, and the range of each. */
interface Carrier {
	from: number;
	to: number;
	marks: Mark[];
	ranges: FamilyRange[];
}

/** Every text node of the textblock at `pos` that carries a family mark. The ranges are
 *  shared between the nodes a mark spans. */
function carriers(block: PMNode, pos: number, type: MarkType): Carrier[] {
	const out: Carrier[] = [];
	let open = new Map<string, FamilyRange>();
	block.forEach((child, offset) => {
		const from = pos + 1 + offset;
		const to = from + child.nodeSize;
		const marks = child.isText ? child.marks.filter((m) => m.type === type) : [];
		const next = new Map<string, FamilyRange>();
		for (const mark of marks) {
			const name = mark.attrs.name as string;
			const range = open.get(name) ?? { start: from, end: to, name };
			range.end = to;
			next.set(name, range);
		}
		open = next;
		if (marks.length)
			out.push({ from, to, marks, ranges: marks.map((m) => next.get(m.attrs.name as string)!) });
	});
	return out;
}

/** Each carrier in `doc` between `from` and `to`, whole textblocks at a time. */
function carriersBetween(doc: PMNode, from: number, to: number, type: MarkType): Carrier[] {
	const out: Carrier[] = [];
	doc.nodesBetween(from, to, (node, pos) => {
		if (!node.isTextblock) return true;
		out.push(...carriers(node, pos, type));
		return false;
	});
	return out;
}

/** The index of a carrier's winning mark. */
function winner(c: Carrier): number {
	let best = 0;
	for (let i = 1; i < c.ranges.length; i++)
		if (familyRank(c.ranges[i], c.ranges[best]) > 0) best = i;
	return best;
}

/** `[from, to)` cut at the edges of `ranges`, each piece with whether it is inside one. */
function pieces(
	from: number,
	to: number,
	ranges: readonly { from: number; to: number }[]
): [number, number, boolean][] {
	const cuts = [
		from,
		to,
		...ranges.flatMap((r) => [r.from, r.to]).filter((p) => from < p && p < to)
	];
	const sorted = [...new Set(cuts)].sort((a, b) => a - b);
	return sorted
		.slice(1)
		.map((b, i) => [sorted[i], b, ranges.some((r) => r.from <= sorted[i] && b <= r.to)]);
}

/** Move each node's winning family last where a transaction left another there. */
export function fontRankPlugin(type: MarkType): Plugin {
	return new Plugin({
		appendTransaction(trs, _before, state) {
			if (!trs.some((tr) => tr.docChanged)) return null;
			const tr = state.tr;
			for (const c of carriersBetween(state.doc, 0, state.doc.content.size, type)) {
				const win = c.marks[winner(c)];
				if (win !== c.marks[c.marks.length - 1])
					tr.removeMark(c.from, c.to, win).addMark(c.from, c.to, win);
			}
			return tr.docChanged ? tr : null;
		}
	});
}

/** The selection's ranges, as positions. */
function selectedRanges(state: EditorState): { from: number; to: number }[] {
	return state.selection.ranges.map((r) => ({ from: r.$from.pos, to: r.$to.pos }));
}

/** The family the whole selection is set in, each text node's winner: `null` where none
 *  is set, `undefined` where nodes differ or the selection holds no text taking one. */
export function selectionFamily(state: EditorState): string | null | undefined {
	const type = state.schema.marks.font_family;
	if (!type) return undefined;
	let seen: string | null | undefined;
	let first = true;
	let mixed = false;
	for (const { from, to } of selectedRanges(state)) {
		state.doc.nodesBetween(from, to, (node, _pos, parent) => {
			if (mixed || !node.isText || !parent?.type.allowsMarkType(type)) return !mixed;
			const value = (node.marks.findLast((m) => m.type === type)?.attrs.name as string) ?? null;
			if (first) {
				seen = value;
				first = false;
			} else if (value !== seen) mixed = true;
			return !mixed;
		});
	}
	return mixed || first ? undefined : seen;
}

/**
 * Set a non-empty selection in `family`, the winning mark over every character it
 * covers. The family's mark goes on last, and joins the family's ranges touching the
 * selection into one, which ranks as a whole. Every other family ranking at or above
 * that range comes off the selection, and one that only the family's old range outranked
 * comes off that old range too, where it drew nothing and would now draw over the
 * family. A family the new range outranks stays whole, so removing this one later shows
 * it again.
 */
export function setFontFamily(family: string): Command {
	return (state, dispatch) => {
		const type = state.schema.marks.font_family;
		if (!type || state.selection.empty) return false;
		if (dispatch) {
			const selected = selectedRanges(state);
			const from = Math.min(...selected.map((r) => r.from));
			const to = Math.max(...selected.map((r) => r.to));
			const mark = type.create({ name: family });
			const before = carriersBetween(state.doc, from, to, type);
			const tr = state.tr;
			for (const r of selected) tr.removeMark(r.from, r.to, mark).addMark(r.from, r.to, mark);
			const off: [number, number, Mark][] = [];
			for (const c of carriersBetween(tr.doc, from, to, type)) {
				const own = c.marks.findIndex((m) => m.eq(mark));
				if (own < 0) continue;
				const range = c.ranges[own];
				if (!selected.some((r) => r.from < range.end && range.start < r.to)) continue;
				for (const [a, b, inside] of pieces(c.from, c.to, selected)) {
					const old = inside
						? undefined
						: before.find((x) => x.from <= a && a < x.to)?.ranges.find((x) => x.name === family);
					c.marks.forEach((m, i) => {
						if (i === own || familyRank(c.ranges[i], range) < 0) return;
						if (inside || (old && familyRank(c.ranges[i], old) < 0)) off.push([a, b, m]);
					});
				}
			}
			for (const [a, b, m] of off) tr.removeMark(a, b, m);
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
}

/** Take each family the selection draws in off the whole selection, so a family one sat
 *  in shows again where it did not draw. */
export const removeFontFamily: Command = (state, dispatch) => {
	const type = state.schema.marks.font_family;
	if (!type || state.selection.empty) return false;
	if (dispatch) {
		const selected = selectedRanges(state);
		const drawing: Mark[] = [];
		for (const { from, to } of selected) {
			state.doc.nodesBetween(from, to, (node) => {
				const win = node.isText ? node.marks.findLast((m) => m.type === type) : undefined;
				if (win && !drawing.some((m) => m.eq(win))) drawing.push(win);
			});
		}
		const tr = state.tr;
		for (const { from, to } of selected) for (const m of drawing) tr.removeMark(from, to, m);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/** The runs of `doc` whose winning family `held` lacks, compared lowercased. */
function missingRuns(doc: PMNode, type: MarkType, held: ReadonlySet<string>): DecorationSet {
	const decos: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return true;
		const win = node.marks.findLast((m) => m.type === type);
		if (win && !held.has((win.attrs.name as string).toLowerCase()))
			decos.push(Decoration.inline(pos, pos + node.nodeSize, { class: 'qm-font-missing' }));
		return false;
	});
	return DecorationSet.create(doc, decos);
}

/** Mark each run set in a family the registry does not hold, which the render sets in
 *  the surrounding font and warns about, and mark them again when the registry changes. */
export function fontMissingPlugin(type: MarkType, fonts: FontRegistry): Plugin {
	let drawn: { doc: PMNode; key: string | undefined; set: DecorationSet } | undefined;
	return new Plugin({
		view: (view) => ({ destroy: fonts.watch(() => view.setProps({})) }),
		props: {
			decorations(state) {
				const held = fonts.families()?.map((f) => f.toLowerCase());
				const key = held?.join('\0');
				if (drawn?.doc !== state.doc || drawn.key !== key)
					drawn = {
						doc: state.doc,
						key,
						set: held ? missingRuns(state.doc, type, new Set(held)) : DecorationSet.empty
					};
				return drawn.set;
			}
		}
	});
}

/** A leaf's font plugins: the rank pass wherever its schema holds the mark, and with a
 *  registry, the pass keeping a pasted run's family and the unavailable runs' marks. */
export function fontPlugins(schema: Schema, fonts: FontRegistry | undefined): Plugin[] {
	const type = schema.marks.font_family;
	if (!type) return [];
	return fonts
		? [fontRankPlugin(type), fontPastePlugin(fonts), fontMissingPlugin(type, fonts)]
		: [fontRankPlugin(type)];
}
