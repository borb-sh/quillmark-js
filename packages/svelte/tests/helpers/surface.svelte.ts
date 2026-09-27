// The mounted-surface helpers the visual suites share: the jsdom stubs a mount
// reaches, the mount itself, and the DOM lookups a test reads a field through. Each
// file still declares `@vitest-environment jsdom` and registers `afterEach(unmountAll)`:
// a hook registered here would bind to the first file that imported this module.
import { mount, unmount, flushSync, tick, type Component } from 'svelte';
import type { Document, Quill } from '@quillmark/wasm';
import type { EditorView } from 'prosemirror-view';
import type { EditorError } from '$lib/core';
import type { FieldController, LeafViews } from '$lib/core/codec';
import type { ActiveLeaf, CardId, EditorChange } from '$lib/visual';
import type { VisualEditorProps } from '$lib/visual/props';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import VisualEditorInner from '$lib/visual/VisualEditorInner.svelte';

/**
 * What jsdom does not implement and a mount reaches: the reveal's scroll hop, the
 * reorder trip's query, the arrival wash (stubbed to a run that never finishes, so the
 * wash node stays where a test can read its host), the caret rects PM measures, and
 * the pointer capture the enum trigger probes for. Every mount calls it; a file calls
 * it itself only to spy on a stub before its first mount. `??=` so a file stubbing its
 * own keeps it.
 */
export function stubLayout(): void {
	Element.prototype.scrollIntoView ??= () => {};
	Element.prototype.getAnimations ??= () => [];
	Element.prototype.animate ??= () => ({}) as Animation;
	Element.prototype.hasPointerCapture ??= () => false;
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}

/** The instance surface a host binds to. */
export interface EditorRef {
	focusField(field: string): Promise<void>;
	setCaret(at: { field: string; pos?: number; granularity?: string }): Promise<void>;
	insertCard(kind: string, at?: number): CardId | undefined;
	removeCard(cardId: CardId): void;
	moveCard(cardId: CardId, dir: -1 | 1): void;
	setKind(cardId: CardId, kind: string): void;
}

/** `VisualEditorInner` also holds the active leaf's controller. */
export interface InnerRef extends EditorRef {
	getActiveLeaf(): FieldController | undefined;
}

export interface Mounted<E = EditorRef> {
	target: HTMLElement;
	editor: E;
	/** The props the surface mounted over, reactive: a write re-renders it. */
	props: VisualEditorProps;
	changes: EditorChange[];
	errors: EditorError[];
	active: ActiveLeaf[];
	unmount(): void;
}

const live = new Set<() => void>();

/** Unmount every surface still mounted. */
export function unmountAll(): void {
	for (const off of [...live]) off();
}

function mountWith<E>(
	component: Component<VisualEditorProps>,
	q: Quill,
	doc: Document,
	extra: Partial<VisualEditorProps>
): Mounted<E> {
	stubLayout();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const changes: EditorChange[] = [];
	const errors: EditorError[] = [];
	const active: ActiveLeaf[] = [];
	const props: VisualEditorProps = $state({
		doc,
		quill: q,
		onChange: (c: EditorChange) => changes.push(c),
		onError: (e: EditorError) => errors.push(e),
		onActiveLeafChange: (a: ActiveLeaf) => active.push(a),
		...extra
	});
	const app = mount(component, { target, props });
	flushSync();
	const off = () => {
		if (!live.delete(off)) return;
		void unmount(app);
		target.remove();
	};
	live.add(off);
	return { target, editor: app as unknown as E, props, changes, errors, active, unmount: off };
}

export const mountEditor = (q: Quill, doc: Document, extra: Partial<VisualEditorProps> = {}) =>
	mountWith<EditorRef>(VisualEditor, q, doc, extra);

/** Mounted at `VisualEditorInner`, whose `getActiveLeaf` is the door an edit takes: jsdom
 *  drives no contenteditable, so one is a transaction dispatched into the leaf's view. */
export const mountInner = (q: Quill, doc: Document, extra: Partial<VisualEditorProps> = {}) =>
	mountWith<InnerRef>(VisualEditorInner as Component<VisualEditorProps>, q, doc, extra);

/** The focused leaf's own view, for a transaction to be dispatched into. */
export const activeView = (editor: InnerRef): EditorView =>
	(editor.getActiveLeaf() as FieldController & LeafViews).view;

/** A field by the text of its own label: the first label inside the field's box, which
 *  for a control that owns its label row (an array, a matrix) is that row's. */
export function field(target: HTMLElement, label: string): HTMLElement {
	const match = [...target.querySelectorAll<HTMLElement>('.qm-field')].find(
		(f) => f.querySelector('.qm-field-label span')?.textContent === label
	);
	if (!match) throw new Error(`no field labelled ${label}`);
	return match;
}

/** Open the group section whose header reads `label`, as a press does. */
export function openGroup(target: HTMLElement, label: string): void {
	const header = [...target.querySelectorAll<HTMLElement>('.qm-group-header')].find((h) =>
		h.textContent?.includes(label)
	);
	if (!header) throw new Error(`no group header ${label}`);
	if (header.getAttribute('aria-expanded') !== 'true') header.click();
	flushSync();
}

/** Type into a text control: the input event a text commit rides and the change a
 *  number settles at. */
export function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

export function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
	flushSync();
}

/** A paste as the DOM delivers one: jsdom implements no `DataTransfer`, and `getData`
 *  is all ProseMirror's paste handler reads. */
export function paste(el: HTMLElement, text: string): void {
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/plain' ? text : '') }
	});
	el.dispatchEvent(event);
	flushSync();
}

/** The note a held leaf draws, inside its own box and naming nothing but itself. */
export function heldNote(leaf: HTMLElement): HTMLElement | null {
	const note = document.getElementById(leaf.getAttribute('aria-describedby') ?? '');
	return note && leaf.closest('.qm-control-box')?.contains(note) ? note : null;
}

/** The enum trigger `scope` is or holds. */
export function trigger(scope: HTMLElement): HTMLElement {
	const found = scope.matches('.qm-select')
		? scope
		: scope.querySelector<HTMLElement>('.qm-select');
	if (!found) throw new Error('no enum trigger in scope');
	return found;
}

/** Open an enum's list as a pointer does: the primitive acts on `pointerdown`, and the
 *  click settles it. */
export function openList(scope: HTMLElement): HTMLElement {
	const el = trigger(scope);
	el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	el.click();
	flushSync();
	return el;
}

/** Pick an option off an enum as a pointer does, the primitive committing on
 *  `pointerup`. `null` picks the unset sentinel, found by class rather than text: it
 *  ghosts the resolved default, so its row can read as a member. */
export function pick(scope: HTMLElement, text: string | null): void {
	openList(scope);
	const row = [...document.querySelectorAll<HTMLElement>('.qm-select-item')].find((el) =>
		text === null
			? el.querySelector('.qm-select-ghost')
			: !el.querySelector('.qm-select-ghost') && el.textContent?.trim() === text
	);
	if (!row) throw new Error(`no option ${text ?? 'unset'} in the open list`);
	row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
	flushSync();
}

/** The collapsed rows' summary buttons, in DOM order, scoped to the first repeater
 *  under `scope` (or `scope` itself) and to its own rows: a nested list's are under an
 *  open row and read separately. */
export function summaries(scope: HTMLElement): HTMLButtonElement[] {
	const arr = scope.classList.contains('qm-array') ? scope : repeater(scope);
	return [
		...arr.querySelectorAll<HTMLButtonElement>(
			':scope > .qm-array-rows > .qm-array-row > .qm-element-head > .qm-element-summary'
		)
	];
}
export const summaryTexts = (arr: HTMLElement): string[] =>
	summaries(arr).map((s) => s.querySelector('.qm-element-title')?.textContent?.trim() ?? '');

/** The repeater inside a field or a cell: the `.qm-array` box a `Field` or a subform
 *  cell mounts. */
export function repeater(scope: HTMLElement): HTMLElement {
	const found = scope.querySelector<HTMLElement>('.qm-array');
	if (!found) throw new Error('no repeater in scope');
	return found;
}

/** Two ticks, not one: a post-flush hop awaits `span.resumes(tick())`, so it resumes
 *  one microtask deeper than the `tick()` a caller awaits. */
export async function settle(): Promise<void> {
	await tick();
	await tick();
}

/** Where the caret sits, as the DOM reports it: an array element registers no prose
 *  lane, so `onCaretMove` says nothing about one and the selection is the witness. */
export const caret = () => {
	const sel = window.getSelection();
	return { text: sel?.anchorNode?.textContent, offset: sel?.anchorOffset };
};

/** The one wash on the surface: a landing is a discrete act, so there is never a
 *  second host holding one at rest. */
export function washHost(target: HTMLElement): HTMLElement | undefined {
	const washes = [...target.querySelectorAll<HTMLElement>('.qm-bloom')];
	if (washes.length !== 1) throw new Error(`${washes.length} washes on the surface`);
	return washes[0].parentElement ?? undefined;
}
