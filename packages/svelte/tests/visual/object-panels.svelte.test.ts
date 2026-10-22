// @vitest-environment jsdom
// Object panels (VISUAL_EDITOR §"Structure mirrors the schema"): the reference quill's
// `credits` kind declares no `ui.groups`, so each top-level object is a panel,
// headed by the object, and everything else stands unframed above them.
import { describe, it, expect, afterEach } from 'vitest';
import { quill, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	openGroup,
	openList,
	pick,
	settle,
	trigger,
	unmountAll
} from '../helpers/surface.svelte.js';

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
		openGroup(target, 'Who and what');
		const contact = field(target, 'Point of contact');
		expect(contact.closest('.qm-group')).not.toBeNull();
		expect(
			headers(target.querySelector('.qm-card')!).map((h) => h.textContent?.trim())
		).not.toContain('Point of contact');
	});
});

describe('a card-level variant enum', () => {
	const MARKED = `quill:
  name: marked
  version: 1.0.0
  backend: typst
  description: A variant enum beside an object, neither in a group.
typst:
  plate_file: plate.typ
main:
  fields:
    subject:
      type: text
    classification:
      type: enum
      values: [UNCLASSIFIED, CUI, SECRET]
      default: ""
      description: The banner.
      variants:
        CUI:
          controlled_by:
            type: text
            default: ""
    addressing:
      type: object
      properties:
        memo_for:
          type: text
`;
	function marked(extra = {}) {
		const q = quillFromYaml(MARKED);
		const { target } = mountEditor(q, q.seedDocument(), extra);
		return { target, card: target.querySelector<HTMLElement>('.qm-card')! };
	}

	it('is a panel of its own, headed by the field, in declaration order', () => {
		const { card } = marked();
		expect(headers(card).map((h) => h.textContent?.trim())).toEqual([
			'Classification',
			'Addressing'
		]);
		expect(card.querySelector('.qm-groups')!.contains(field(card, 'Subject'))).toBe(false);
	});

	it('names its discriminant by the header and draws its world inside the panel', () => {
		const { card } = marked();
		const classification = panel(card, 'Classification');
		const header = classification.querySelector<HTMLElement>('.qm-group-header')!;
		expect(classification.querySelector('.qm-field-label')).toBeNull();
		expect(trigger(classification).getAttribute('aria-labelledby')).toBe(header.id);
		expect(trigger(classification).hasAttribute('aria-label')).toBe(false);

		pick(classification, 'CUI');
		expect(classification.querySelector('[data-qm-prop="controlled_by"]')).not.toBeNull();
	});

	it('keeps the enum policy on its discriminant', () => {
		const { card } = marked({ enumOptionAllowed: (_: unknown, v: string) => v !== 'SECRET' });
		openList(panel(card, 'Classification'));
		const secret = [...document.querySelectorAll<HTMLElement>('.qm-select-item')].find(
			(el) => el.textContent?.trim() === 'SECRET'
		);
		expect(secret?.hasAttribute('data-disabled')).toBe(true);
	});
});
