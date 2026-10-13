// A task item is a `list_item` whose `checked` is a boolean (CODEC §"Task items"). Its
// `toDOM` draws a checkbox ahead of the item's blocks, disabled, which is the drawing a
// held leaf, a copy and `renderContent` take; a leaf that edits mounts the item through
// `taskItemView`, whose checkbox toggles. A task item is minted by source mode and by a
// paste alone: no shorthand, command or key makes one.
import {
	DOMSerializer,
	type DOMOutputSpec,
	type Node as PMNode,
	type NodeType
} from 'prosemirror-model';
import { Plugin, type Command } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { splitListItem } from 'prosemirror-schema-list';

const SVG = 'http://www.w3.org/2000/svg';

/** The id the checkbox names its item's blocks by, fresh per drawing. */
let drawn = 0;

/** The `checked` an `<li>` states: `data-qm-checked`, which `toDOM` writes, else none. */
export function taskChecked(el: HTMLElement): boolean | null {
	const stated = el.getAttribute('data-qm-checked');
	return stated === null ? null : stated === 'true';
}

/** Where an `<li>`'s blocks are: a task item's body, past its checkbox; the item itself
 *  otherwise. */
export function taskBody(el: Node): HTMLElement {
	const li = el as HTMLElement;
	const body = li.hasAttribute('data-qm-checked')
		? li.querySelector<HTMLElement>(':scope > [data-qm-task-body]')
		: null;
	return body ?? li;
}

/** A task item's `<li>`: the checkbox, unreachable by the caret, then the body holding
 *  the item's blocks, which names it. The mark is the check glyph a matrix tick draws. */
export function taskDOM(checked: boolean): DOMOutputSpec {
	const body = `qm-task-${++drawn}`;
	return [
		'li',
		{ 'data-qm-checked': String(checked) },
		[
			'span',
			{ class: 'qm-task', contenteditable: 'false' },
			[
				'input',
				{
					type: 'checkbox',
					class: 'qm-task-box',
					'aria-labelledby': body,
					checked: checked ? '' : null,
					disabled: ''
				}
			],
			[
				`${SVG} svg`,
				{
					class: 'qm-task-mark',
					viewBox: '0 0 24 24',
					fill: 'none',
					stroke: 'currentColor',
					'stroke-width': '2',
					'stroke-linecap': 'round',
					'stroke-linejoin': 'round',
					'aria-hidden': 'true'
				},
				[`${SVG} path`, { d: 'M20 6 9 17l-5-5' }]
			]
		],
		['div', { id: body, 'data-qm-task-body': '' }, 0]
	];
}

const isTask = (node: PMNode): boolean => node.attrs.checked !== null;

/**
 * Every `list_item` in a leaf that edits, drawn by its own `toDOM`. A task item's checkbox
 * is enabled, and a change to it is one `checked` transaction, so one `Mod-z` takes it
 * back; where the leaf declines the edit the box returns to the item's value. The box
 * keeps the press from the caret: a mousedown leaves the selection and the focus where
 * they were, and ProseMirror reads no event aimed at it.
 */
function taskItemView(node: PMNode, view: EditorView, getPos: () => number | undefined): NodeView {
	const { dom, contentDOM } = DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node)) as {
		dom: HTMLElement;
		contentDOM: HTMLElement;
	};
	const box = isTask(node)
		? dom.querySelector<HTMLInputElement>(':scope > .qm-task > input')
		: null;
	if (box) {
		box.disabled = false;
		box.addEventListener('mousedown', (e) => e.preventDefault());
		box.addEventListener('change', () => {
			const pos = getPos();
			if (pos === undefined || !view.editable) {
				box.checked = node.attrs.checked as boolean;
				return;
			}
			view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', box.checked));
		});
	}
	return {
		dom,
		contentDOM,
		update(next) {
			if (next.type !== node.type || isTask(next) !== isTask(node)) return false;
			node = next;
			if (box) {
				box.checked = next.attrs.checked as boolean;
				dom.setAttribute('data-qm-checked', String(next.attrs.checked));
			}
			return true;
		},
		stopEvent: (e) => box !== null && e.target === box,
		ignoreMutation: (m) => m.type !== 'selection' && !contentDOM.contains(m.target)
	};
}

/** The node view a block leaf mounts its list items through. */
export function taskPlugin(): Plugin {
	return new Plugin({ props: { nodeViews: { list_item: taskItemView } } });
}

/**
 * `splitListItem`, leaving the item that takes none of a task item's text an open task:
 * the one below, or the one above where Enter is pressed at the head of the item's text.
 * An empty item the split lifts out of a nested list keeps its own `checked`, as a
 * Shift-Tab lift keeps it.
 */
export function splitTaskItem(itemType: NodeType): Command {
	const split = splitListItem(itemType);
	return (state, dispatch, view) => {
		const { $from, empty } = state.selection;
		const item = $from.depth >= 2 ? $from.node(-1) : null;
		if (!dispatch || item?.type !== itemType || !isTask(item)) return split(state, dispatch, view);
		const lifted = $from.parent.content.size === 0 && item.childCount === 1;
		const atHead = empty && $from.parentOffset === 0 && $from.index(-1) === 0;
		return split(state, (tr) => {
			const $at = tr.selection.$from;
			const below = $at.before($at.depth - 1);
			if (lifted) tr.setNodeAttribute(below, 'checked', item.attrs.checked);
			else if (atHead) {
				const above = tr.doc.resolve(below).nodeBefore;
				if (above) tr.setNodeAttribute(below - above.nodeSize, 'checked', false);
			} else tr.setNodeAttribute(below, 'checked', false);
			dispatch(tr);
		});
	};
}
