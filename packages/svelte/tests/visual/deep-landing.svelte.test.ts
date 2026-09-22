// @vitest-environment jsdom
// A landing resolves the whole path through nested rows (VISUAL_EDITOR §Surface): the
// ladder reads every step past the field against the schema, each rung opens what it
// names and hands the rest down, the arrival wash blooms the innermost row, and a
// diagnostic anchored at a nested leaf draws at the nearest cell the tree holds.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { init } from '@quillmark/wasm';
import { quill } from '../helpers/fixtures.js';
import {
	caret,
	field,
	mountEditor,
	openGroup,
	pick,
	repeater,
	settle,
	stubLayout,
	summaries,
	washHost,
	type Mounted
} from '../helpers/surface.js';

// The gate every mounted suite stands behind; the classes are reached off the fixture.
await init();
stubLayout();

let mounted: Mounted | undefined;
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
});

describe('a landing at depth', () => {
	it('opens each row on the way and places the caret in the leaf the address names', async () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
		openGroup(mounted.target, 'Content');
		const outer = field(mounted.target, 'Appendices');
		expect(outer.querySelector('.qm-element.open')).toBeNull();

		await mounted.editor.setCaret({
			field: 'main.appendices[0].entries[1].label',
			pos: 3,
			granularity: 'cluster'
		});
		await settle();

		// Appendix 0 opened, entry 1 under it opened, and the caret sits in the entry's
		// label leaf at the offset the compile resolved: `Sec|ondary`.
		const appendix = outer.querySelector<HTMLElement>('.qm-element.open')!;
		expect(appendix.querySelector('.qm-element-title')?.textContent).toBe('Sources');
		const inner = repeater(appendix.querySelector('.qm-object')!);
		const entry = inner.querySelector<HTMLElement>('.qm-element.open')!;
		expect(entry.querySelector('.qm-element-title')?.textContent).toBe('Secondary');
		expect(entry.contains(document.activeElement)).toBe(true);
		expect(caret()).toEqual({ text: 'Secondary', offset: 3 });
		// The wash marks the innermost row the address named, not the appendix around it.
		expect(washHost(mounted.target)).toBe(entry);
		expect(mounted.errors).toHaveLength(0);
	});

	it('lands on a row it has to open, revealing the group first', async () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
		const header = [...mounted.target.querySelectorAll<HTMLElement>('.qm-group-header')].find((h) =>
			h.textContent?.includes('Content')
		)!;
		expect(header.getAttribute('aria-expanded')).toBe('false');

		await mounted.editor.focusField('main.appendices[1]');
		await settle();
		expect(header.getAttribute('aria-expanded')).toBe('true');
		const outer = field(mounted.target, 'Appendices');
		const open = outer.querySelector<HTMLElement>('.qm-element.open')!;
		expect(open.querySelector('.qm-element-title')?.textContent).toBe('Glossary');
		expect(open.contains(document.activeElement)).toBe(true);
		expect(washHost(mounted.target)).toBe(open);
	});

	it('lands a property path on its cell, washing the field', async () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
		await mounted.editor.focusField('main.contact.email');
		await settle();
		const contact = field(mounted.target, 'Point of contact');
		const email = contact.querySelector('[data-qm-prop="email"] input')!;
		expect(document.activeElement).toBe(email);
		// A property under a field-level subform names no row, so the field's box is
		// what the wash falls to.
		expect(washHost(mounted.target)?.classList.contains('qm-field-control')).toBe(true);
		expect(mounted.errors).toHaveLength(0);
	});

	it('lands a live variant cell on its control, and a dormant one on the discriminant', async () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		openGroup(mounted.target, 'Metadata');
		const dist = field(mounted.target, 'Distribution');
		pick(dist.querySelector<HTMLElement>('.qm-select')!, 'public');

		await mounted.editor.focusField('main.distribution.license');
		await settle();
		// The licence cell's trigger, which its own `<label for>` names.
		const license = dist.querySelector<HTMLElement>('[data-qm-prop="license"] .qm-select')!;
		expect(document.activeElement).toBe(license);
		expect(dist.querySelector(`label[for="${license.id}"]`)).not.toBeNull();

		// `lift_on` is the embargoed world's: not drawn, so the trigger takes the landing.
		await mounted.editor.focusField('main.distribution.lift_on');
		await settle();
		expect(document.activeElement).toBe(dist.querySelector('.qm-select'));
		expect(mounted.errors).toHaveLength(0);
	});

	it('refuses a step the schema does not declare, through either verb', async () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
		await mounted.editor.focusField('main.appendices[0].nothing');
		await mounted.editor.setCaret({ field: 'main.contact.email.deeper', pos: 0 });
		await mounted.editor.focusField('main.contact[0]');
		flushSync();
		expect(mounted.errors.map((e) => e.code)).toEqual(Array(3).fill('target-unknown'));
	});
});

describe('a diagnostic anchored at a nested leaf', () => {
	const diagnostics = [
		{ severity: 'error' as const, message: 'bad page', path: 'main.appendices[0].entries[1].page' },
		{ severity: 'error' as const, message: 'bad email', path: 'main.contact.email' }
	];
	const lines = (scope: HTMLElement) =>
		[...scope.querySelectorAll<HTMLElement>('.qm-diag-line')].map((l) => l.textContent);

	it('draws under the nearest cell the tree holds, following the rows as they open', () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument(), { diagnostics });
		openGroup(mounted.target, 'Content');
		const outer = field(mounted.target, 'Appendices');

		// Collapsed all the way down: the appendix row's head carries it, where the user
		// can see a row, and the field's foot holds nothing.
		expect(lines(outer)).toEqual(['bad page']);
		const appendix0 = outer.querySelector<HTMLElement>('.qm-element')!;
		expect(appendix0.querySelector('.qm-diag-line')).not.toBeNull();

		// Open the appendix: the message walks into the entries list, onto entry 1's head.
		summaries(outer)[0].click();
		flushSync();
		const inner = repeater(outer.querySelector('.qm-element.open .qm-object')!);
		expect(lines(outer)).toEqual(['bad page']);
		const entry1 = [...inner.querySelectorAll<HTMLElement>('.qm-element')][1];
		expect(entry1.querySelector('.qm-diag-line')).not.toBeNull();

		// Open the entry: it walks onto the `page` cell itself.
		summaries(inner)[1].click();
		flushSync();
		const page = inner
			.querySelector<HTMLElement>('.qm-element.open')!
			.querySelector<HTMLElement>('[data-qm-prop="page"]')!;
		expect(page.querySelector('.qm-diag-line')?.textContent).toBe('bad page');
		expect(lines(outer)).toEqual(['bad page']);
	});

	it('draws a property diagnostic under that property, not under the whole subform', () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument(), { diagnostics });
		const contact = field(mounted.target, 'Point of contact');
		expect(contact.querySelector('[data-qm-prop="email"] .qm-diag-line')?.textContent).toBe(
			'bad email'
		);
		expect(lines(contact)).toEqual(['bad email']);
	});

	it("keeps a variant's discriminant off the box its world's cells sit in", () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument(), {
			diagnostics: [
				{ severity: 'error' as const, message: 'bad world', path: 'main.distribution.value' },
				{ severity: 'error' as const, message: 'bad date', path: 'main.distribution.lift_on' }
			]
		});
		openGroup(mounted.target, 'Metadata');
		const dist = field(mounted.target, 'Distribution');
		pick(dist.querySelector<HTMLElement>('.qm-select')!, 'embargoed');

		// The live cell's draws under that cell.
		expect(dist.querySelector('[data-qm-prop="lift_on"] .qm-diag-line')?.textContent).toBe(
			'bad date'
		);
		// The discriminant's draws under the field, where the control it is about is —
		// never at the subform's foot, which is inside a box holding the live world alone.
		const variant = dist.querySelector<HTMLElement>('.qm-variant')!;
		expect(
			[...variant.querySelectorAll<HTMLElement>(':scope > .qm-diag-list .qm-diag-line')].map(
				(l) => l.textContent
			)
		).toEqual(['bad world']);
		expect(
			variant.querySelectorAll(':scope > .qm-object > .qm-diag-list .qm-diag-line')
		).toHaveLength(0);
	});
});
