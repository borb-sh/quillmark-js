// @vitest-environment jsdom
// A host's note draws under the field its path names, a nested path under the field it
// hangs off, and the body's under the body (VISUAL_EDITOR §"Field notes").
import { describe, it, expect, afterEach } from 'vitest';
import { createRawSnippet } from 'svelte';
import { quill } from '../helpers/fixtures.js';
import { field, mountEditor, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const note = (text: string) =>
	createRawSnippet(() => ({ render: () => `<p class="host-note">${text}</p>` }));

function open(notes: { path: string; note: ReturnType<typeof note> }[]) {
	const q = quill();
	return mountEditor(q, q.seedDocument(), { notes }).target;
}

describe('notes', () => {
	it('draws a note under the field its path names', () => {
		const target = open([{ path: 'main.title', note: note('Was: Draft title') }]);

		expect(field(target, 'Title').querySelector('.host-note')?.textContent).toBe(
			'Was: Draft title'
		);
		expect(target.querySelectorAll('.host-note')).toHaveLength(1);
	});

	it('draws a nested path under the field it hangs off', () => {
		const target = open([{ path: 'main.contact.email', note: note('Was: old@example.com') }]);

		const drawn = target.querySelector('.host-note');
		expect(drawn).not.toBeNull();
		expect(drawn!.closest('.qm-field')?.textContent).toContain('Point of contact');
	});

	it('draws the body note under the body', () => {
		const target = open([{ path: 'main.body', note: note('Was: the old body') }]);

		expect(target.querySelector('.qm-body-leaf .host-note')).not.toBeNull();
	});

	it('draws nothing for a path naming no field', () => {
		const target = open([{ path: 'main.nowhere', note: note('lost') }]);

		expect(target.querySelector('.host-note')).toBeNull();
	});
});
