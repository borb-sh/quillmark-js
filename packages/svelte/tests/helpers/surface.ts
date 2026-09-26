// The mounted-surface helpers the depth suites share: the jsdom stubs a mount
// reaches, the mount itself, and the DOM lookups a test reads a field through. Each
// file still declares `@vitest-environment jsdom`; this module only assumes one at
// call time.
import { mount, unmount, flushSync, tick } from 'svelte';
import type { Document, Quill } from '@quillmark/wasm';
import type { EditorError } from '$lib/core';
import type { ActiveLeaf, EditorChange } from '$lib/visual';
import VisualEditor from '$lib/visual/VisualEditor.svelte';

/**
 * What jsdom does not implement and a mount reaches: the reveal's scroll hop, the
 * reorder trip's query, the arrival wash (stubbed to a run that never finishes, so the
 * wash node stays where a test can read its host), the caret rects PM measures, and
 * the pointer capture the enum trigger probes for. `??=` so a file stubbing its own
 * keeps it.
 */
export function stubLayout(): void {
	Element.prototype.scrollIntoView ??= () => {};
	Element.prototype.getAnimations ??= () => [];
	Element.prototype.animate ??= () => ({}) as Animation;
	Element.prototype.hasPointerCapture ??= () => false;
	Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
	Range.prototype.getBoundingClientRect ??= () => new DOMRect();
}

/** The instance surface a host binds to, as far as these suites drive it. */
export interface EditorRef {
	focusField(field: string): Promise<void>;
	setCaret(at: { field: string; pos?: number; granularity?: string }): Promise<void>;
}

export interface Mounted {
	target: HTMLElement;
	editor: EditorRef;
	changes: EditorChange[];
	errors: EditorError[];
	active: ActiveLeaf[];
	unmount(): void;
}

export function mountEditor(q: Quill, doc: Document, extra: Record<string, unknown> = {}): Mounted {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const changes: EditorChange[] = [];
	const errors: EditorError[] = [];
	const active: ActiveLeaf[] = [];
	const app = mount(VisualEditor, {
		target,
		props: {
			doc,
			quill: q,
			onChange: (c: EditorChange) => changes.push(c),
			onError: (e: EditorError) => errors.push(e),
			onActiveLeafChange: (a: ActiveLeaf) => active.push(a),
			...extra
		}
	});
	flushSync();
	return {
		target,
		editor: app as unknown as EditorRef,
		changes,
		errors,
		active,
		unmount() {
			void unmount(app);
			target.remove();
		}
	};
}

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

/** Pick an option off an enum trigger as a pointer does (see enum-policy). */
export function pick(trigger: HTMLElement, text: string): void {
	trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
	trigger.click();
	flushSync();
	const row = [...document.querySelectorAll<HTMLElement>('.qm-select-item')].find(
		(el) => !el.querySelector('.qm-select-ghost') && el.textContent?.trim() === text
	);
	if (!row) throw new Error(`no option ${text} in the open list`);
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

/** Where the caret sits, as the DOM reports it. */
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
