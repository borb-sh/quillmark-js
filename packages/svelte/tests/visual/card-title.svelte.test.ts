// @vitest-environment jsdom
// What names a card, drawn. A header is the instance's rename, else its kind's
// `title`, else its own first short text cell, else the humanized kind; a picker that
// names a kind before any instance exists reads the `title`, else the humanized kind.
// The reference quill carries both shapes: `section` declares no `title` and is named
// by its `heading`, `figure` declares one.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { fieldValues, humanize } from '$lib/visual/structure';
import { field, mountEditor, stubLayout, type, type Mounted } from '../helpers/surface.js';
import { quill, template } from '../helpers/fixtures.js';

stubLayout();

let mounted: Mounted | undefined;
afterEach(() => {
	mounted?.unmount();
	mounted = undefined;
});

const cards = (target: HTMLElement) => [
	...target.querySelectorAll<HTMLElement>('.qm-card:not(.qm-main)')
];
const header = (card: HTMLElement) =>
	card.querySelector<HTMLInputElement>('.qm-card-header .qm-card-title')!;
/** The first card of `kind`, by the document's own order. */
const cardOf = (target: HTMLElement, kinds: string[], kind: string) =>
	cards(target)[kinds.indexOf(kind)];

describe('the card header', () => {
	it('names an untitled kind’s card by its heading, and a titled kind’s by the title', () => {
		const q = quill();
		const doc = template();
		const kinds = doc.cards.map((c) => c.kind);
		mounted = mountEditor(q, doc);
		const { target } = mounted;

		expect(q.schema.card_kinds!.section.title).toBeUndefined();
		const heading = fieldValues(doc.cards[kinds.indexOf('section')].payloadItems).heading;
		expect(heading).toBeTruthy();
		expect(header(cardOf(target, kinds, 'section')).placeholder).toBe(heading);

		const figure = q.schema.card_kinds!.figure.title;
		expect(figure).toBeTruthy();
		expect(header(cardOf(target, kinds, 'figure')).placeholder).toBe(figure);
	});

	it('names a fresh card by its kind until its heading is typed, then follows it', () => {
		const q = quill();
		mounted = mountEditor(q, template());
		const { target, editor } = mounted;
		(editor as unknown as { insertCard(kind: string): string }).insertCard('section');
		flushSync();

		const fresh = cards(target).at(-1)!;
		expect(header(fresh).placeholder).toBe(humanize('section'));
		type(field(fresh, 'Heading').querySelector('input')!, 'Methods');
		expect(header(fresh).placeholder).toBe('Methods');
	});

	it('keeps a rename over whatever the heading says', () => {
		const q = quill();
		mounted = mountEditor(q, template());
		const section = cards(mounted.target)[0];
		const title = header(section);
		title.value = 'Renamed';
		title.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		type(field(section, 'Heading').querySelector('input')!, 'Methods');
		expect(title.value).toBe('Renamed');
	});
});

describe('the add menu', () => {
	it('names each kind by its title, else its humanized key', async () => {
		const q = quill();
		mounted = mountEditor(q, template());
		const trigger = [...mounted.target.querySelectorAll<HTMLElement>('.qm-add-btn')].at(-1)!;
		trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		flushSync();

		const offered = [...document.querySelectorAll<HTMLElement>('.qm-menu-item')].map((el) =>
			el.textContent?.trim()
		);
		expect(offered).toEqual(
			Object.entries(q.schema.card_kinds!).map(([kind, s]) => s.title ?? humanize(kind))
		);
		expect(offered).toContain(q.schema.card_kinds!.note.title);
		expect(offered).toContain(humanize('section'));

		// Closed and let settle inside the test: the open menu locks the body's scroll, and
		// the primitive restores it on a timer that must not outlive the environment.
		document
			.querySelector('.qm-menu-item')!
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		await new Promise((settled) => setTimeout(settled, 50));
		expect(document.querySelector('.qm-menu-item')).toBeNull();
	});
});
