// @vitest-environment jsdom
// A file dragged onto the editor is refused at its root, or the browser opens it in place
// of the page; a text drag passes to the control under it.
import { describe, it, expect, afterEach } from 'vitest';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

/** jsdom has no `DragEvent`: a bubbling event carrying a `dataTransfer` of `types`. */
function drag(type: string, types: string[]): Event & { dataTransfer: { dropEffect: string } } {
	const e = new Event(type, { bubbles: true, cancelable: true });
	return Object.assign(e, { dataTransfer: { types, dropEffect: 'copy' } });
}

describe('a drop on the editor', () => {
	it('refuses a file, over and on drop, wherever in the editor it lands', () => {
		const { target } = mountEditor(quill(), example());
		const inner = target.querySelector<HTMLElement>('.qm-editor .qm-primary')!;
		for (const type of ['dragover', 'drop']) {
			const e = drag(type, ['Files']);
			inner.dispatchEvent(e);
			expect(e.defaultPrevented).toBe(true);
			expect(e.dataTransfer.dropEffect).toBe('none');
		}
	});

	it('leaves a text drag to the control under it', () => {
		const { target } = mountEditor(quill(), example());
		const root = target.querySelector<HTMLElement>('.qm-editor')!;
		for (const type of ['dragover', 'drop']) {
			const e = drag(type, ['text/plain']);
			root.dispatchEvent(e);
			expect(e.defaultPrevented).toBe(false);
		}
	});
});
