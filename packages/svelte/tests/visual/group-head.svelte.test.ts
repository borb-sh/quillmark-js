// @vitest-environment jsdom
// An object alone in its group (VISUAL_EDITOR §"Structure mirrors the schema"): the
// reference quill's `imprint` draws no label and no figure of its own; the section
// header names it and carries its description.
import { describe, it, expect, afterEach } from 'vitest';
import type { Quill } from '@quillmark/wasm';
import { fieldTitle, groupLabel } from '$lib/visual/structure';
import { quill } from '../helpers/fixtures.js';
import { mountEditor, openGroup, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

function section(q: Quill, target: HTMLElement): HTMLElement {
	const label = groupLabel(q.schema.main, q.schema.main.fields.imprint.ui!.group!);
	openGroup(target, label);
	const header = [...target.querySelectorAll<HTMLElement>('.qm-group-header')].find((h) =>
		h.textContent?.includes(label)
	)!;
	return header.closest<HTMLElement>('.qm-group')!;
}

describe('an object alone in its group', () => {
	it('is named by the section header and draws no label of its own', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const group = section(q, mounted.target);
		const header = group.querySelector<HTMLElement>('.qm-group-header')!;
		const subform = group.querySelector<HTMLElement>('.qm-object')!;

		expect(subform.classList.contains('qm-object-flat')).toBe(true);
		expect(subform.getAttribute('aria-labelledby')).toBe(header.id);
		expect([...group.querySelectorAll('.qm-field-label span')].map((l) => l.textContent)).toEqual(
			Object.entries(q.schema.main.fields.imprint.properties!).map(([k, p]) => fieldTitle(k, p))
		);
	});

	it('parks its description on the header, where the subform reads it', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const group = section(q, mounted.target);
		const subform = group.querySelector<HTMLElement>('.qm-object')!;
		const parked = mounted.target.querySelector(`#${subform.getAttribute('aria-describedby')}`);

		expect(parked?.textContent).toBe(q.schema.main.fields.imprint.description);
		expect(group.querySelector('.qm-group-head')?.contains(parked!)).toBe(true);
	});
});
