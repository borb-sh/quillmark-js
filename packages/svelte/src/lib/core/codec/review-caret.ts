// Which review item a leaf's caret names. The reader arriving in the leaf, by a press or by
// the focus coming from elsewhere on the page, names the change on the caret's line, else the
// nearest change in the leaf, unless the current item is one of the leaf's already; the caret
// moving within the leaf names a change only on arriving at one. Typing names nothing: the item
// typed in stays quiet until the caret has left it.
import { Plugin, PluginKey, type EditorState } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { remoteKey } from './remote.js';

/** A change the leaf draws, by the stretch of the document the caret names it from. */
export interface CaretSpan {
	id: string;
	from: number;
	to: number;
	/** It only adds after what it covers: a rewrite of the same stretch is named first. */
	adds?: boolean;
}

/** The lines of `doc`, in order: each textblock, cut at its hard breaks. */
function linesOf(doc: PMNode): { from: number; to: number }[] {
	const lines: { from: number; to: number }[] = [];
	doc.descendants((node, pos) => {
		if (!node.isTextblock) return true;
		let from = pos + 1;
		node.forEach((child, offset) => {
			if (child.type.name !== 'hard_break') return;
			lines.push({ from, to: pos + 1 + offset });
			from = pos + 1 + offset + child.nodeSize;
		});
		lines.push({ from, to: pos + node.nodeSize - 1 });
		return false;
	});
	return lines;
}

/** The index of the line holding `pos`, the nearest before it between lines. */
function lineAt(lines: readonly { from: number }[], pos: number): number {
	let at = 0;
	while (at + 1 < lines.length && lines[at + 1].from <= pos) at++;
	return at;
}

/** `spans` widened to the whole lines they touch, so a caret anywhere on a changed line is in
 *  its change. */
export function widened(doc: PMNode, spans: readonly CaretSpan[]): CaretSpan[] {
	const lines = linesOf(doc);
	if (!lines.length) return [...spans];
	return spans.map((s) => ({
		...s,
		from: Math.min(s.from, lines[lineAt(lines, s.from)].from),
		to: Math.max(s.to, lines[lineAt(lines, s.to)].to)
	}));
}

/** The change holding `pos`: the one the caret was put into by id while it stays, else the
 *  narrowest, a rewrite before what only adds. */
export function changeAt(
	spans: readonly CaretSpan[],
	pos: number,
	entered?: string
): CaretSpan | undefined {
	let best: CaretSpan | undefined;
	for (const s of spans) {
		if (s.from > pos || pos > s.to) continue;
		if (s.id === entered) return s;
		const size = s.to - s.from;
		const held = best && best.to - best.from;
		if (!best || size < held! || (size === held && best.adds && !s.adds)) best = s;
	}
	return best;
}

/** The change nearest `pos`: the fewest lines away, then a rewrite before what only adds, then
 *  the fewest positions away, then the one above. */
export function nearestChange(
	doc: PMNode,
	spans: readonly CaretSpan[],
	pos: number
): CaretSpan | undefined {
	const lines = linesOf(doc);
	const line = lineAt(lines, pos);
	const rank = (s: CaretSpan): number[] => {
		const first = lineAt(lines, s.from);
		const last = lineAt(lines, s.to);
		const away = line < first ? first - line : line > last ? line - last : 0;
		const chars = pos < s.from ? s.from - pos : pos > s.to ? pos - s.to : 0;
		return [away, s.adds ? 1 : 0, chars, s.from];
	};
	let best: CaretSpan | undefined;
	let bestRank: number[] = [];
	for (const s of spans) {
		const r = rank(s);
		const i = r.findIndex((v, n) => v !== bestRank[n]);
		if (!best || (i >= 0 && r[i] < bestRank[i])) {
			best = s;
			bestRank = r;
		}
	}
	return best;
}

export interface ReviewCaret {
	/** The changes the leaf draws, by the stretches they stand on. */
	spans(state: EditorState): readonly CaretSpan[];
	/** The item the caret was put into by its id, while it stays where it was put. */
	entered(state: EditorState): string | undefined;
	/** Whether the current item is one the leaf draws. */
	litHere(): boolean;
	/** The item the caret names, `undefined` once it has left one. */
	point(id: string | undefined): void;
}

const caretKey = new PluginKey<number>('qm-review-caret');

/** Whether a focus coming from `from` is the reader arriving in the leaf: from elsewhere on the
 *  page, not handed back from a surface floating over the text. */
const arriving = (from: EventTarget | null): boolean =>
	from instanceof Element && !from.closest('.qm-popover-surface');

export function reviewCaretPlugin(caret: ReviewCaret): Plugin<number> {
	/** The item last named from inside a change, `undefined` outside one. */
	let named: string | undefined;
	/** The item the reader typed in, quiet until the caret has left it. */
	let muted: string | undefined;
	/** A press is down in the leaf: the caret it places names once it is up. */
	let pressing = false;

	const spansOf = (state: EditorState): CaretSpan[] => widened(state.doc, caret.spans(state));

	/** The caret moved, or the reader typed: an arrival at a change names it. */
	const follow = (view: EditorView, typed: boolean): void => {
		const { selection } = view.state;
		const at =
			view.hasFocus() && selection.empty
				? changeAt(spansOf(view.state), selection.head, caret.entered(view.state))?.id
				: undefined;
		if (at !== muted) muted = undefined;
		if (typed && at) muted = at;
		const next = at === muted ? undefined : at;
		if (next === named) return;
		named = next;
		caret.point(next);
	};

	/** The reader arrived in the leaf: the change on the caret's line, else, the current item
	 *  being another leaf's, the nearest change here. */
	const arrive = (view: EditorView): void => {
		if (view.isDestroyed || !view.hasFocus()) return;
		const { state } = view;
		const spans = spansOf(state);
		const head = state.selection.head;
		const at = changeAt(spans, head, caret.entered(state));
		muted = undefined;
		if (at) {
			named = at.id;
			caret.point(at.id);
			return;
		}
		named = undefined;
		if (caret.litHere()) return;
		const near = nearestChange(state.doc, spans, head);
		if (near) caret.point(near.id);
	};

	/** Hold the caret's report until the press at `view` is up, then arrive, or not where it
	 *  was cancelled or the press was on a change, which names that change itself. */
	const press = (view: EditorView, onChange: boolean): void => {
		pressing = true;
		const end = (event: Event): void => {
			window.removeEventListener('pointerup', end, true);
			window.removeEventListener('pointercancel', end, true);
			pressing = false;
			if (event.type === 'pointerup' && !onChange) setTimeout(() => arrive(view));
		};
		window.addEventListener('pointerup', end, true);
		window.addEventListener('pointercancel', end, true);
	};

	return new Plugin<number>({
		key: caretKey,
		state: {
			init: () => 0,
			apply: (tr, edits) => (tr.docChanged && !tr.getMeta(remoteKey) ? edits + 1 : edits)
		},
		props: {
			handleDOMEvents: {
				pointerdown: (view, event) => {
					if (event.button !== 0 || pressing) return false;
					const target = event.target instanceof Element ? event.target : null;
					press(view, !!target?.closest('[data-qm-review]'));
					return false;
				},
				focus: (view, event) => {
					if (pressing) return false;
					if (arriving(event.relatedTarget)) arrive(view);
					else follow(view, false);
					return false;
				},
				blur: (view) => {
					// The focus has not left yet when a blur fires.
					queueMicrotask(() => {
						if (!view.isDestroyed) follow(view, false);
					});
					return false;
				}
			}
		},
		view: () => ({
			update(view, prev) {
				if (pressing) return;
				follow(view, caretKey.getState(prev) !== caretKey.getState(view.state));
			},
			destroy() {
				if (named !== undefined) caret.point(undefined);
			}
		})
	});
}
