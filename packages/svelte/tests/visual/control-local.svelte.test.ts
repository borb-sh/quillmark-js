// @vitest-environment jsdom
// A control's local holds an edit until what it derives from changes. Driven on
// `TextField`, mounted bare over a model rebuilt the way the editor re-derives one on
// every commit: the re-render an edit's own commit causes leaves the text as typed, and
// a `value` changed from elsewhere replaces it.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TextField from '$lib/visual/TextField.svelte';

const mounted: (() => void)[] = [];
afterEach(() => {
	for (const off of mounted.splice(0)) off();
});

function control(value: string | undefined, fallback?: string) {
	let model = $state.raw({ value, fallback });
	const commits: (string | undefined)[] = [];
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(TextField, {
		target,
		props: {
			get value() {
				return model.value;
			},
			get fallback() {
				return model.fallback;
			},
			label: 'Title',
			onCommit: (v) => commits.push(v)
		}
	});
	flushSync();
	mounted.push(() => {
		void unmount(app);
		target.remove();
	});
	const input = target.querySelector('input')!;
	return {
		input,
		/** Type `text` and re-render over the document its commit wrote. */
		edit(text: string) {
			input.value = text;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			flushSync();
			model = { ...model, value: commits.at(-1) };
			flushSync();
		},
		/** Re-render over a `value` written elsewhere. */
		external(next: string | undefined) {
			model = { ...model, value: next };
			flushSync();
		}
	};
}

describe('a text field’s local', () => {
	it('holds an edit through a re-render, and takes a changed value over it', () => {
		const { input, edit, external } = control('Draft');
		edit('Draft two');
		expect(input.value).toBe('Draft two');
		external('Final');
		expect(input.value).toBe('Final');
		edit('Final cut');
		expect(input.value).toBe('Final cut');
		external(undefined);
		expect(input.value).toBe('');
	});
});
