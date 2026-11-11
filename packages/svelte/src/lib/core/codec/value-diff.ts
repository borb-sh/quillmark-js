// A field's whole proposed value, drawn as a word diff over a leaf of lines: the words Accept would
// strike struck where they stand, the words it would write tinted beside them in their own
// formatting, nothing written. What is drawn is the difference between the leaf as it reads and
// what Accept would write (`planValue`), so the reader's words beside a proposal stay unstruck.
// The leaf holds its own text throughout, so the caret, a selection and a copy read what the field
// holds; taking the proposal is the field's own write, not this plugin's.
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Content } from '@quillmark/wasm';
import { DOMSerializer, type Schema } from 'prosemirror-model';
import { scanContent, scanDoc } from './encode.js';
import { lineIndexOf, offsetToPM } from './positions.js';
import { decode } from './decode.js';
import { hasMarks } from './schema.js';
import { planValue, valueChanges } from './value-plan.js';

/** A field's proposed value as the leaf draws it. */
export interface ValueProposal {
	id: string;
	/** The value the field would hold. */
	after: Content;
	/** The value as the proposal's writer read it, where it says. */
	before?: Content;
	/** It is the current item, drawn a step stronger. */
	lit: boolean;
}

export const valueDiffKey = new PluginKey<void>('qm-value-diff');

/** `[from, to)` of `c` as a value of its own, one line. */
function slice(c: Content, from: number, to: number): Content {
	const marks = (c.marks ?? []).flatMap((m) => {
		const start = Math.max(m.start, from);
		const end = Math.min(m.end, to);
		return end > start ? [{ ...m, start: start - from, end: end - from }] : [];
	});
	return { text: c.text.slice(from, to), blocks: [{ id: '', kind: 'para' }], marks };
}

/** The proposed words as they would read: in their own formatting where the leaf holds marks. */
function inserted(schema: Schema, c: Content, from: number, to: number): Node {
	const part = slice(c, from, to);
	if (!hasMarks(schema) || !part.marks?.length || part.text.includes('\n'))
		return document.createTextNode(part.text);
	const doc = decode(part, schema);
	const inline = doc.firstChild?.isTextblock ? doc.firstChild.content : doc.content;
	return DOMSerializer.fromSchema(schema).serializeFragment(inline);
}

function draw(
	state: EditorState,
	p: ValueProposal,
	planned?: (id: string, outdated: boolean) => void
): DecorationSet {
	const scan = scanDoc(state.doc);
	const live = scanContent(scan);
	const index = lineIndexOf(scan);
	const at = (offset: number): number => offsetToPM(index, offset);
	const { merged, outdated } = planValue(p.before, live, p.after);
	if (p.before) planned?.(p.id, outdated);
	const decos: Decoration[] = [];
	const name = { 'data-qm-review': p.id };
	const lit = p.lit ? ' qm-review-lit' : '';
	valueChanges(live, merged).forEach(({ at: from, end, from: start, to }, n) => {
		if (end > from)
			decos.push(
				Decoration.inline(at(from), at(end), {
					nodeName: 'del',
					class: `qm-review-del${lit}`,
					...name
				})
			);
		if (to <= start) return;
		const text = merged.text.slice(start, to);
		decos.push(
			Decoration.widget(
				end > from ? at(end) : at(from),
				() => {
					const el = document.createElement('ins');
					el.className = `qm-review-ins${lit}`;
					el.contentEditable = 'false';
					el.setAttribute('data-qm-review', p.id);
					el.append(inserted(state.schema, merged, start, to));
					return el;
				},
				{
					side: end > from ? -1 : 1,
					key: `value:${p.id}:${n}:${start}:${JSON.stringify(slice(merged, start, to).marks)}:${text}:${p.lit}`
				}
			)
		);
	});
	return DecorationSet.create(state.doc, decos);
}

/**
 * The plugin, reading the proposal live: a caller that moves it redraws with `setProps`.
 * `planned` hears, on each draw, whether the reader's writing meets the proposal.
 */
export function valueDiffPlugin(
	read: () => ValueProposal | undefined,
	planned?: (id: string, outdated: boolean) => void
): Plugin {
	return new Plugin({
		key: valueDiffKey,
		props: {
			decorations(state) {
				const p = read();
				return p ? draw(state, p, planned) : null;
			}
		}
	});
}
