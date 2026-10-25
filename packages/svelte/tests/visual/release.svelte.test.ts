// @vitest-environment jsdom
// A host that drops both handles unmounts the surface, and from then on every prop getter
// it handed down answers null. ProseMirror's `destroy` redraws a view's decorations and
// attributes once more, so a leaf whose view read its props through them would re-derive
// the card model over the released quill in the middle of the teardown.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { example, quill } from '../helpers/fixtures.js';
import { stubLayout } from '../helpers/surface.svelte.js';
import ReleaseHost from './ReleaseHost.svelte';

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

describe('releasing the handles', () => {
	it('unmounts the subform prose cells without reading the released props', () => {
		stubLayout();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const props = $state({ doc: example(), quill: quill(), released: false });
		const app = mount(ReleaseHost, { target, props });
		cleanup = () => {
			void unmount(app);
			target.remove();
		};
		flushSync();
		expect(target.querySelector('.qm-prose-value')).not.toBeNull();

		props.released = true;
		expect(() => flushSync()).not.toThrow();
		expect(target.querySelector('.qm-editor, .qm-prose-value')).toBeNull();
	});
});
