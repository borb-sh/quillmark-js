// @vitest-environment jsdom
// A flat subform (VISUAL_EDITOR §"Structure mirrors the schema"): the reference quill's
// `imprint`, alone in its group, draws no label and no figure of its own; the section
// header names it and carries its description.
import { describe, it, expect, afterEach } from 'vitest';
import { quill } from '../helpers/fixtures.js';
import { mountEditor, openGroup, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

function section(target: HTMLElement): HTMLElement {
	openGroup(target, 'Print run');
	const header = [...target.querySelectorAll<HTMLElement>('.qm-group-header')].find((h) =>
		h.textContent?.includes('Print run')
	)!;
	return header.closest<HTMLElement>('.qm-group')!;
}

describe('a flat field alone in its group', () => {
	it('is named by the section header and draws no label of its own', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const group = section(mounted.target);
		const header = group.querySelector<HTMLElement>('.qm-group-header')!;
		const subform = group.querySelector<HTMLElement>('.qm-object')!;

		expect(subform.classList.contains('qm-object-flat')).toBe(true);
		expect(subform.getAttribute('aria-labelledby')).toBe(header.id);
		expect([...group.querySelectorAll('.qm-field-label span')].map((l) => l.textContent)).toEqual([
			'Printer',
			'Copies'
		]);
	});

	it('parks its description on the header, where the subform reads it', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const group = section(mounted.target);
		const subform = group.querySelector<HTMLElement>('.qm-object')!;
		const parked = mounted.target.querySelector(`#${subform.getAttribute('aria-describedby')}`);

		expect(parked?.textContent).toBe(q.schema.main.fields.imprint.description);
		expect(group.querySelector('.qm-group-head')?.contains(parked!)).toBe(true);
	});
});
