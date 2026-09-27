// @vitest-environment jsdom
// The array element refs. `ArrayField` binds its elements' focus handles into a `$state`
// record, which is what keeps a mount from logging an untracked write per element
// (the mount `plaintext-array` asserts silent). `$state` proxies deeply, and what goes
// in is a component instance, so the handle a focus hop calls through is the proxy's:
// the keyboard paths prove `focus()` still lands through it.
import { describe, it, expect, afterEach } from 'vitest';
import { quill, template } from '../helpers/fixtures.js';
import { mountEditor, press, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

// The reference quill's `main.authors` is `string[]`, so its elements are `TextField`s:
// the array control with a component instance behind each row. Located by the
// accessible name each element carries (`${label} ${index + 1}`, ArrayField).
const ELEMENT_LABEL = 'Authors ';

/** The array control's element inputs, in DOM order. */
function inputs(target: HTMLElement): HTMLInputElement[] {
	const found = [
		...target.querySelectorAll<HTMLInputElement>(`input[aria-label^="${ELEMENT_LABEL}"]`)
	];
	if (found.length === 0)
		throw new Error(`fixture drift: no \`${ELEMENT_LABEL.trim()}\` array elements on the quill`);
	return found;
}

describe('array element refs', () => {
	it('Enter inserts a sibling and takes focus there, through the proxied handle', async () => {
		const q = quill();
		const { target } = mountEditor(q, template());
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
		const { target } = mountEditor(q, template());
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
