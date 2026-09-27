// @vitest-environment jsdom
// What names a card, drawn. A header is the instance's rename, else its kind's
// `title`, else its own first short text cell, else the humanized kind; a picker that
// names a kind before any instance exists reads the `title`, else the humanized kind.
// The reference quill carries both shapes: `section` declares no `title` and is named
// by its `heading`, `figure` declares one.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { fieldValues, humanize } from '$lib/visual/structure';
import {
	activeView,
	field,
	mountEditor,
	mountInner,
	press,
	type,
	unmountAll
} from '../helpers/surface.svelte.js';
import { quill, quillFromYaml, template } from '../helpers/fixtures.js';

afterEach(unmountAll);

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
		const mounted = mountEditor(q, doc);
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
		const mounted = mountEditor(q, template());
		const { target, editor } = mounted;
		editor.insertCard('section');
		flushSync();

		const fresh = cards(target).at(-1)!;
		expect(header(fresh).placeholder).toBe(humanize('section'));
		type(field(fresh, 'Heading').querySelector('input')!, 'Methods');
		expect(header(fresh).placeholder).toBe('Methods');
	});

	it('keeps a rename over whatever the heading says', () => {
		const q = quill();
		const mounted = mountEditor(q, template());
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
		const mounted = mountEditor(q, template());
		press([...mounted.target.querySelectorAll<HTMLElement>('.qm-add-btn')].at(-1)!, 'ArrowDown');

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
		press(document.querySelector<HTMLElement>('.qm-menu-item')!, 'Escape');
		await new Promise((settled) => setTimeout(settled, 50));
		expect(document.querySelector('.qm-menu-item')).toBeNull();
	});
});

// A kind named by a one-line prose field: that lane commits without a re-derive, so the
// header follows the leaf's own commit. On its own quill, the reference quill naming its
// untitled kind by a `string`.
const PERSON = `quill:
  name: person_probe
  version: 1.0.0
  backend: typst
  description: A kind with no title, named by an inline prose field.
typst:
  plate_file: plate.typ
main:
  fields: {}
card_kinds:
  person:
    fields:
      name:
        type: plaintext
        inline: true
`;

describe('a header named by an inline prose field', () => {
	it('follows the leaf’s commit, which re-derives nothing', async () => {
		const q = quillFromYaml(PERSON);
		// A seed carries one card of each declared kind.
		const { target, editor, changes } = mountInner(q, q.seedDocument());
		const titles = () =>
			[...target.querySelectorAll<HTMLInputElement>('.qm-card-title')].map((i) => i.placeholder);
		expect(titles()).toEqual([humanize('person')]);

		await editor.focusField('cards.person[0].name');
		const view = activeView(editor);
		view.dispatch(view.state.tr.insertText('Jane Q. Roe', 1));
		flushSync();

		expect(changes.map((c) => c.source)).toEqual(['prose']);
		expect(titles()).toEqual(['Jane Q. Roe']);
	});
});
