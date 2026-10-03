// @vitest-environment jsdom
// A control's local: the value its input shows. An edit assigns it and holds through any
// re-render, and a change to the prop it reads replaces it. Mounted bare, where a prop
// can change under an edit.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TextField from '$lib/visual/TextField.svelte';
import { stubLayout, type } from '../helpers/surface.svelte.js';

const mounted: (() => void)[] = [];
afterEach(() => {
	for (const off of mounted.splice(0)) off();
});

describe('a control’s local', () => {
	it('holds an edit until the value it reads changes', () => {
		stubLayout();
		const commits: (string | undefined)[] = [];
		const props = $state({
			value: 'draft' as string | undefined,
			placeholder: undefined as string | undefined,
			onCommit: (v: string | undefined) => void commits.push(v)
		});
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(TextField, { target, props });
		mounted.push(() => {
			void unmount(app);
			target.remove();
		});
		flushSync();
		const input = target.querySelector('input')!;
		expect(input.value).toBe('draft');

		// Committed and not written back: a declined write, or one still in flight.
		type(input, 'draft two');
		expect(commits).toEqual(['draft two']);
		props.placeholder = 'None';
		flushSync();
		expect(input.value).toBe('draft two');

		props.value = 'final';
		flushSync();
		expect(input.value).toBe('final');
	});
});
