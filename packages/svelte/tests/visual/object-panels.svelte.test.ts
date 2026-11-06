// @vitest-environment jsdom
// Object panels (VISUAL_EDITOR §"Structure mirrors the schema"): the reference quill's
// `credits` kind declares no `ui.groups`, so each top-level object is a panel,
// headed by the object, and everything else stands unframed above them.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { quill } from '../helpers/fixtures.js';
import { field, mountEditor, openField, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

// A seed carries one card of each declared kind, after `main`.
function credits() {
	const q = quill();
	const doc = q.seedDocument();
	const at = doc.cards.findIndex((c) => c.kind === 'credits');
	const mounted = mountEditor(q, doc);
	const card = mounted.target.querySelectorAll<HTMLElement>('.qm-card')[at + 1];
	return { q, mounted, card, at };
}

const headers = (card: HTMLElement) => [
	...card.querySelectorAll<HTMLButtonElement>('.qm-group-header')
];

function panel(card: HTMLElement, label: string): HTMLElement {
	return headers(card)
		.find((h) => h.textContent?.includes(label))!
		.closest<HTMLElement>('.qm-group')!;
}

describe('a card grouped by top-level objects', () => {
	it('panels each object in declaration order, the first open', () => {
		const { card } = credits();
		expect(headers(card).map((h) => h.textContent?.trim())).toEqual(['Publisher', 'Rights']);
		expect(headers(card).map((h) => h.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
		expect(panel(card, 'Rights').querySelector<HTMLElement>('.qm-group-panel')?.inert).toBe(true);
	});

	it('opens and closes each panel on its own', () => {
		const { card } = credits();
		const expanded = () => headers(card).map((h) => h.getAttribute('aria-expanded'));
		headers(card)[1].click();
		flushSync();
		expect(expanded()).toEqual(['true', 'true']);
		headers(card)[0].click();
		flushSync();
		expect(expanded()).toEqual(['false', 'true']);
	});

	it('flags a closed panel holding a diagnostic, and links the message once open', () => {
		const q = quill();
		const doc = q.seedDocument();
		const at = doc.cards.findIndex((c) => c.kind === 'credits');
		const { target } = mountEditor(q, doc, {
			diagnostics: [
				{
					severity: 'error',
					code: 'validation::type_mismatch',
					path: `cards.credits[${at}].rights.holder`,
					message: 'holder is wrong'
				}
			]
		});
		const card = target.querySelectorAll<HTMLElement>('.qm-card')[at + 1];
		const rights = panel(card, 'Rights');
		expect(rights.querySelector('.qm-group-flag')).not.toBeNull();
		expect(panel(card, 'Publisher').querySelector('.qm-group-flag')).toBeNull();

		rights.querySelector<HTMLButtonElement>('.qm-group-header')!.click();
		flushSync();
		expect(rights.querySelector('.qm-group-flag')).toBeNull();
		const list = rights.querySelector<HTMLElement>('.qm-diag-list')!;
		const control = list.parentElement!.querySelector<HTMLElement>('[aria-invalid="true"]')!;
		expect(control.getAttribute('aria-errormessage')).toBe(list.id);
		expect(control.getAttribute('aria-describedby')?.split(' ')).toContain(list.id);
	});

	it('stands its other fields unframed above the panels', () => {
		const { card } = credits();
		const groups = card.querySelector('.qm-groups')!;
		for (const label of ['Edition', 'Translators']) {
			const f = field(card, label);
			expect(groups.contains(f)).toBe(false);
			expect(f.compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
		expect(field(card, 'Translators').querySelector('.qm-object')).toBeNull();
	});

	it('names the panel by its header, which carries the object’s description', () => {
		const { q, mounted, card } = credits();
		const publisher = panel(card, 'Publisher');
		const header = publisher.querySelector<HTMLElement>('.qm-group-header')!;
		const subform = publisher.querySelector<HTMLElement>('.qm-object')!;

		expect(subform.classList.contains('qm-object-flat')).toBe(true);
		expect(subform.getAttribute('aria-labelledby')).toBe(header.id);
		const parked = mounted.target.querySelector(`#${subform.getAttribute('aria-describedby')}`);
		expect(parked?.textContent).toBe(q.schema.card_kinds!.credits.fields.publisher.description);
		expect(publisher.querySelector('.qm-group-head')?.contains(parked!)).toBe(true);
	});

	it('draws an object inside the panel’s object as a subform, never a panel', () => {
		const { card } = credits();
		const publisher = panel(card, 'Publisher');
		expect(publisher.querySelectorAll('.qm-group')).toHaveLength(0);
		const address = publisher.querySelector('[data-qm-prop="address"] .qm-object');
		expect(address?.classList.contains('qm-object-flat')).toBe(false);
	});

	it('opens a closed panel for a landing on a property inside it', async () => {
		const { mounted, card, at } = credits();
		await mounted.editor.focusField(`cards.credits[${at}].rights.holder`);
		await settle();
		const rights = panel(card, 'Rights');
		expect(rights.querySelector('.qm-group-header')?.getAttribute('aria-expanded')).toBe('true');
		expect(rights.querySelector<HTMLElement>('.qm-group-panel')?.inert).toBe(false);
		expect(rights.querySelector('[data-qm-prop="holder"]')?.contains(document.activeElement)).toBe(
			true
		);
		expect(mounted.errors).toHaveLength(0);
	});

	it('keeps a legacy `ui.groups` card’s objects as subforms inside its groups', () => {
		const q = quill();
		const { target } = mountEditor(q, q.seedDocument());
		const contact = openField(target, q.schema.main, 'contact');
		expect(contact.closest('.qm-group')).not.toBeNull();
		expect(
			headers(target.querySelector('.qm-card')!).map((h) => h.textContent?.trim())
		).not.toContain(q.schema.main.fields.contact.title);
	});
});
