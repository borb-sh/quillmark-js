// A field's whole proposed value, drawn as a word diff over a one-line leaf: the words it would
// strike struck where they stand, the words it would write tinted beside them, nothing written.
// The leaf holds its own text throughout, so the caret, a selection and a copy read what the
// field holds; taking the proposal is the field's own write, not this plugin's.
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { wordDiff } from './review-diff.js';

/** A field's proposed value as the leaf draws it. */
export interface ValueProposal {
	id: string;
	/** The text the field would hold. */
	after: string;
	/** It is the current item, drawn a step stronger. */
	lit: boolean;
}

export const valueDiffKey = new PluginKey<void>('qm-value-diff');

/** The text of the leaf and where each of its characters stands. */
function textOf(state: EditorState): { text: string; at: (offset: number) => number } {
	let text = '';
	const starts: { offset: number; pos: number }[] = [];
	state.doc.descendants((node, pos) => {
		if (node.isText) {
			starts.push({ offset: text.length, pos });
			text += node.text;
		} else if (node.isLeaf && node.isInline) {
			starts.push({ offset: text.length, pos });
			text += '￼';
		}
		return true;
	});
	const end = state.doc.content.size - (state.doc.firstChild?.isTextblock ? 1 : 0);
	const at = (offset: number): number => {
		for (let i = starts.length - 1; i >= 0; i--)
			if (starts[i].offset <= offset) return starts[i].pos + (offset - starts[i].offset);
		return starts.length ? starts[0].pos : end;
	};
	return { text, at };
}

function draw(state: EditorState, p: ValueProposal): DecorationSet {
	const { text, at } = textOf(state);
	const decos: Decoration[] = [];
	const name = { 'data-qm-review': p.id };
	const lit = p.lit ? ' qm-review-lit' : '';
	wordDiff(text, p.after).forEach(({ at: from, end, insert }, n) => {
		if (end > from)
			decos.push(
				Decoration.inline(at(from), at(end), {
					nodeName: 'del',
					class: `qm-review-del${lit}`,
					...name
				})
			);
		if (!insert) return;
		decos.push(
			Decoration.widget(
				end > from ? at(end) : at(from),
				() => {
					const el = document.createElement('ins');
					el.className = `qm-review-ins${lit}`;
					el.contentEditable = 'false';
					el.setAttribute('data-qm-review', p.id);
					el.textContent = insert;
					return el;
				},
				{ side: end > from ? -1 : 1, key: `value:${p.id}:${n}:${insert}:${p.lit}` }
			)
		);
	});
	return DecorationSet.create(state.doc, decos);
}

/** The plugin, reading the proposal live: a caller that moves it redraws with `setProps`. */
export function valueDiffPlugin(read: () => ValueProposal | undefined): Plugin {
	return new Plugin({
		key: valueDiffKey,
		props: {
			decorations(state) {
				const p = read();
				return p ? draw(state, p) : null;
			}
		}
	});
}
