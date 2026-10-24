// Font runs: a `font_family` and a `font_size` mark, each excluding its own type, so a
// position carries one family and one step at most, as the store's keyed marks do. The
// family names a face in the registry a host hands the editor (`engine.fontFaces(quill)`),
// which the leaf draws under an alias of its own rather than the family's name, so a
// registry face never joins a family the host page already loads. A step is relative and
// draws in `em`.
import type { Command, EditorState } from 'prosemirror-state';
import type { MarkType } from 'prosemirror-model';

/** The size steps, `qm.font-steps`' keys. The surrounding size is no mark. */
export const FONT_STEPS = ['small', 'large'] as const;
export type FontStep = (typeof FONT_STEPS)[number];

export function isFontStep(value: unknown): value is FontStep {
	return (FONT_STEPS as readonly unknown[]).includes(value);
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

/** The families of a CSS `font-family` value, unquoted, in order. */
export function cssFamilies(value: string): string[] {
	const out: string[] = [];
	for (const match of value.matchAll(
		/\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+))\s*(?:,|$)/g
	)) {
		const name = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1').trim();
		if (name) out.push(name);
	}
	return out;
}

/** The registry's spelling of the first family in a CSS `font-family` value the
 *  registry holds, compared lowercased; `undefined` where it holds none. */
export function registryFamily(value: string, families: readonly string[]): string | undefined {
	for (const name of cssFamilies(value)) {
		const held = families.find((family) => family.toLowerCase() === name.toLowerCase());
		if (held) return held;
	}
	return undefined;
}

/** What a mark type's attribute reads over the selection: the value every text
 *  position taking the mark holds, `null` where none holds one, `undefined` where they
 *  differ. `undefined` too over a selection holding no such position. */
function selectionAttr(
	state: EditorState,
	type: MarkType,
	attr: string
): string | null | undefined {
	let seen: string | null | undefined;
	let first = true;
	let mixed = false;
	for (const { $from, $to } of state.selection.ranges) {
		state.doc.nodesBetween($from.pos, $to.pos, (node, _pos, parent) => {
			if (mixed || !node.isText || !parent?.type.allowsMarkType(type)) return !mixed;
			const value = (type.isInSet(node.marks)?.attrs[attr] as string | undefined) ?? null;
			if (first) {
				seen = value;
				first = false;
			} else if (value !== seen) mixed = true;
			return !mixed;
		});
	}
	return mixed || first ? undefined : seen;
}

/** The family the whole selection is set in, `null` for the surrounding family. */
export function selectionFamily(state: EditorState): string | null | undefined {
	const type = state.schema.marks.font_family;
	return type ? selectionAttr(state, type, 'name') : undefined;
}

/** The step the whole selection is set at, `null` for the surrounding size. */
export function selectionStep(state: EditorState): FontStep | null | undefined {
	const type = state.schema.marks.font_size;
	return type ? (selectionAttr(state, type, 'step') as FontStep | null | undefined) : undefined;
}

/** Set every range of a non-empty selection to one value of a font mark, `null` taking
 *  the mark off. The pair the mark diff lowers to a `remove` and an `add`. */
function setFontMark(
	name: 'font_family' | 'font_size',
	attrs: Record<string, string> | null
): Command {
	return (state, dispatch) => {
		const type = state.schema.marks[name];
		if (!type || state.selection.empty) return false;
		if (dispatch) {
			const tr = state.tr;
			for (const { $from, $to } of state.selection.ranges) {
				tr.removeMark($from.pos, $to.pos, type);
				if (attrs) tr.addMark($from.pos, $to.pos, type.create(attrs));
			}
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
}

export function setFontFamily(family: string | null): Command {
	return setFontMark('font_family', family === null ? null : { name: family });
}

export function setFontStep(step: FontStep | null): Command {
	return setFontMark('font_size', step === null ? null : { step });
}
