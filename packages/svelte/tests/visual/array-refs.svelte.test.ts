// @vitest-environment jsdom
// The array element refs, from both ends of the one decision.
//
// `ArrayField` keeps its elements' focus handles in a record keyed by element id and
// binds into it with `bind:this={els[id]}`. A plain object makes that a write Svelte
// cannot track, and it says so once per element per render — thirteen lines on the
// reference quill's first paint, in the console a consumer is reading to find its own
// defects. The record is `$state`, so: nothing is logged.
//
// The other end is what `$state` costs. It proxies a plain object deeply, and what
// goes in here is a component instance rather than a DOM node (the shape {@link Card}
// keeps its refs in), so the handle a focus hop calls through is the proxy's. The
// keyboard paths are driven here to prove `focus()` still lands: silence bought by
// breaking the refs is the same defect one console line quieter.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill, template } from '../helpers/fixtures.js';

const core = await init();

// The reference quill's `main.authors` is `string[]`, so its elements are `TextField`s:
// the array control with a component instance behind each row. Located by the
// accessible name each element carries (`${label} ${index + 1}`, ArrayField), the field
// declaring no `title` so the label is `humanize('authors')`.
const ELEMENT_LABEL = 'Authors ';

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return target;
}

/** The array control's element inputs, in DOM order. */
function inputs(target: HTMLElement): HTMLInputElement[] {
	const found = [
		...target.querySelectorAll<HTMLInputElement>(`input[aria-label^="${ELEMENT_LABEL}"]`)
	];
	if (found.length === 0)
		throw new Error(`fixture drift: no \`${ELEMENT_LABEL.trim()}\` array elements on the quill`);
	return found;
}

function press(el: HTMLElement, key: string): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
	flushSync();
}

/** Two ticks, not one: the focus hop awaits `span.resumes(tick())`, so it resumes one
 *  microtask deeper than the `tick()` a caller awaits, and a single await reads the
 *  list rebuilt with the caret not yet moved. */
async function settle(): Promise<void> {
	await tick();
	await tick();
}

describe('array element refs', () => {
	it('mounting over a document with array fields logs nothing', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const q = quill();
			mountEditor(q, template());
			// The messages, not just the count: a failure here should name what it saw.
			expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([]);
			expect(error.mock.calls.map((c) => String(c[0]))).toEqual([]);
		} finally {
			warn.mockRestore();
			error.mockRestore();
		}
	});

	it('Enter inserts a sibling and takes focus there, through the proxied handle', async () => {
		const q = quill();
		const target = mountEditor(q, template());
		const before = inputs(target).length;

		press(inputs(target)[0], 'Enter');
		// The focus hop is post-flush by construction: a mutation commits the array by
		// value, so the row does not exist until the parent has re-derived.
		await settle();

		const after = inputs(target);
		expect(after.length).toBe(before + 1);
		expect(document.activeElement).toBe(after[1]);
	});

	it('Backspace on an empty element removes it and hands focus back up the list', async () => {
		const q = quill();
		const target = mountEditor(q, template());
		press(inputs(target)[0], 'Enter');
		await settle();
		const grown = inputs(target).length;

		// The inserted element is empty, which is what makes Backspace a removal.
		press(inputs(target)[1], 'Backspace');
		await settle();

		const after = inputs(target);
		expect(after.length).toBe(grown - 1);
		expect(document.activeElement).toBe(after[0]);
	});
});
