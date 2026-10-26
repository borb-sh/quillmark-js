// Font runs: `font_family` marks, one family per character as the store keeps them. The
// mark excludes its own type, so setting a family over text replaces the one it was set
// in, as the store's `add` of a keyed mark does, and touching text in one family joins
// into one run. The family names a face in the registry a host hands the editor
// (`engine.fontFaces(quill)`), which the leaf draws under an alias of its own rather
// than the family's name, so a registry face never joins a family the host page loads.
import { Plugin, type Command, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { MarkType, Node as PMNode, Schema } from 'prosemirror-model';
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

/** The selection's ranges, as positions. */
function selectedRanges(state: EditorState): { from: number; to: number }[] {
	return state.selection.ranges.map((r) => ({ from: r.$from.pos, to: r.$to.pos }));
}

/** The family the whole selection is set in: `null` where none is set, `undefined`
 *  where text nodes differ or the selection holds no text taking one. */
export function selectionFamily(state: EditorState): string | null | undefined {
	const type = state.schema.marks.font_family;
	if (!type) return undefined;
	let seen: string | null | undefined;
	let first = true;
	let mixed = false;
	for (const { from, to } of selectedRanges(state)) {
		state.doc.nodesBetween(from, to, (node, _pos, parent) => {
			if (mixed || !node.isText || !parent?.type.allowsMarkType(type)) return !mixed;
			const value = (type.isInSet(node.marks)?.attrs.name as string) ?? null;
			if (first) {
				seen = value;
				first = false;
			} else if (value !== seen) mixed = true;
			return !mixed;
		});
	}
	return mixed || first ? undefined : seen;
}

/** Set a non-empty selection in `family`, replacing whatever family it was set in, as
 *  the store's `add` of a keyed mark does. */
export function setFontFamily(family: string): Command {
	return (state, dispatch) => {
		const type = state.schema.marks.font_family;
		if (!type || state.selection.empty) return false;
		if (dispatch) {
			const mark = type.create({ name: family });
			const tr = state.tr;
			for (const { from, to } of selectedRanges(state)) tr.addMark(from, to, mark);
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
}

/** Take every family off a non-empty selection, which then draws in the surrounding
 *  font. */
export const removeFontFamily: Command = (state, dispatch) => {
	const type = state.schema.marks.font_family;
	if (!type || state.selection.empty) return false;
	if (dispatch) {
		const tr = state.tr;
		for (const { from, to } of selectedRanges(state)) tr.removeMark(from, to, type);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

/** The runs of `doc` whose family `held` lacks, compared lowercased. */
function missingRuns(doc: PMNode, type: MarkType, held: ReadonlySet<string>): DecorationSet {
	const decos: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!node.isText) return true;
		const mark = type.isInSet(node.marks);
		if (mark && !held.has((mark.attrs.name as string).toLowerCase()))
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

/** A leaf's font plugins, given a registry and a schema holding the mark: the pass
 *  keeping a pasted run's family and the unavailable runs' marks. */
export function fontPlugins(schema: Schema, fonts: FontRegistry | undefined): Plugin[] {
	const type = schema.marks.font_family;
	return type && fonts ? [fontPastePlugin(fonts), fontMissingPlugin(type, fonts)] : [];
}
