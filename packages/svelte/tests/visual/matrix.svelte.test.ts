// @vitest-environment jsdom
// The matrix control (VISUAL_EDITOR §"The matrix"): ticks over the roster, columns
// unfolding under a held member, one sparse map committed whole, a member held by being
// present. Driven off the reference quill's `checks` — six members on one flat roster,
// open to added items, two columns — and read back through the document; a probe quill
// carries the lists the add box searches across.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import { quill, quillFromYaml } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	openGroup,
	pick,
	press,
	settle,
	type,
	washHost,
	unmountAll
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const stored = (doc: Document) => doc.getStored('checks');
function matrix(target: HTMLElement): HTMLElement {
	openGroup(target, 'Metadata');
	return field(target, 'Checks');
}
/** A member's box, by its title. */
function member(m: HTMLElement, title: string): HTMLElement {
	const found = [...m.querySelectorAll<HTMLElement>('.qm-member')].find(
		(el) => el.querySelector('.qm-member-title')?.textContent === title
	);
	if (!found) throw new Error(`no member ${title}`);
	return found;
}
const tick = (m: HTMLElement, title: string) =>
	member(m, title).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
const count = (m: HTMLElement) => m.querySelector('.qm-matrix-count')?.textContent?.trim();
const addBox = (m: HTMLElement) => m.querySelector<HTMLInputElement>('input[role="combobox"]')!;
/** The add box's options as they read: title, then the note beside it. */
const offered = (m: HTMLElement) =>
	[...m.querySelectorAll<HTMLElement>('[role="option"]')].map((o) =>
		[...o.querySelectorAll('.qm-matrix-add-title, .qm-matrix-add-note')]
			.map((c) => c.textContent)
			.join(' | ')
	);
/** Focus the add box and type into it. */
function typeAdd(m: HTMLElement, words: string): HTMLInputElement {
	const box = addBox(m);
	box.focus();
	type(box, words);
	return box;
}

describe('a matrix field', () => {
	it('draws the roster as real checkboxes in declaration order, each titled by a label for it', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const m = matrix(mounted.target);

		expect([...m.querySelectorAll('.qm-member-title')].map((l) => l.textContent)).toEqual([
			'Spelling',
			'Citations',
			'Figures',
			'Margins',
			'Fonts',
			'Approved'
		]);
		const ticks = [...m.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
		expect(ticks).toHaveLength(6);
		for (const t of ticks) {
			expect(t.checked).toBe(false);
			expect(m.querySelector(`label[for="${t.id}"]`)).not.toBeNull();
		}
		expect(count(m)).toBe('0 of 6 held');
		// `ui.compact` sets the roster on the track ladder rather than packing the field.
		expect(m.querySelector('.qm-matrix-roster')?.classList.contains('qm-tracks')).toBe(true);
		// A matrix seeds empty, so nothing is stored and no member unfolds; the one text
		// input is the open list's add box.
		expect(m.querySelectorAll('.qm-object')).toHaveLength(0);
		expect(m.querySelectorAll('input[type="text"]')).toHaveLength(1);
		expect(addBox(m).placeholder).toBe('Add to Checks…');
	});

	it('ticks by writing the member and unticks by removing it, a retick restoring its columns', () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		tick(m, 'Spelling').click();
		flushSync();
		expect(stored(doc)).toEqual({ spelling: true });
		expect(count(m)).toBe('1 of 6 held');
		expect(member(m, 'Spelling').classList.contains('held')).toBe(true);
		// The columns unfold under the held member alone: a prose leaf and a select.
		const spelling = member(m, 'Spelling');
		expect(spelling.querySelector('.ProseMirror')).not.toBeNull();
		expect(spelling.querySelector('.qm-select')).not.toBeNull();
		expect(member(m, 'Citations').querySelector('.qm-object')).toBeNull();
		// The columns are a group the member's title names, so each reads under its member.
		const group = spelling.querySelector<HTMLElement>('.qm-object')!;
		expect(document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(
			'Spelling'
		);

		pick(spelling, 'major');
		expect(stored(doc)).toEqual({ spelling: { severity: 'major' } });

		// An untick removes the member and its answers: the document keeps none for a
		// member it does not hold, and a map left empty is an unset field.
		tick(m, 'Spelling').click();
		flushSync();
		expect(stored(doc)).toBeUndefined();
		expect(member(m, 'Spelling').querySelector('.qm-object')).toBeNull();
		expect(count(m)).toBe('0 of 6 held');

		// The editor kept them, so a retick in this mount restores them.
		tick(m, 'Spelling').click();
		flushSync();
		expect(stored(doc)).toEqual({ spelling: { severity: 'major' } });
		expect(member(m, 'Spelling').querySelector('.qm-select')?.textContent?.trim()).toBe('major');
		expect(mounted.errors).toHaveLength(0);
	});

	it('reads the bare true spelling as held, and keeps it held through an edit elsewhere', () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { fonts: true });
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		expect(tick(m, 'Fonts').checked).toBe(true);
		expect(count(m)).toBe('1 of 6 held');

		tick(m, 'Margins').click();
		flushSync();
		expect(stored(doc)).toEqual({ fonts: true, margins: true });
		expect(tick(m, 'Fonts').checked).toBe(true);

		// The last member out unsets the field.
		tick(m, 'Margins').click();
		flushSync();
		expect(stored(doc)).toEqual({ fonts: true });
		tick(m, 'Fonts').click();
		flushSync();
		expect(stored(doc)).toBeUndefined();
	});

	it('reads a mapping naming no tick as held, and one storing `held` as held too', () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { fonts: {}, margins: { held: true, note: 'x' } });
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		expect(tick(m, 'Fonts').checked).toBe(true);
		expect(tick(m, 'Margins').checked).toBe(true);
		// The stored `held` is the engine's refusal, drawn under the member it names.
		expect(member(m, 'Margins').querySelector('.qm-diag-line')).not.toBeNull();

		// The member's next edit writes it back without it.
		pick(member(m, 'Margins'), 'major');
		expect(stored(doc)).toEqual({ fonts: true, margins: { note: 'x', severity: 'major' } });
	});

	it('keys as a checkbox group: every tick a tab stop, and no arrow walk', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const m = matrix(mounted.target);
		const ticks = [...m.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
		for (const t of ticks) expect(t.tabIndex).toBe(0);
		const spelling = tick(m, 'Spelling');
		spelling.focus();
		press(spelling, 'ArrowDown', { cancelable: true });
		expect(document.activeElement).toBe(spelling);
		press(spelling, 'ArrowDown', { altKey: true, cancelable: true });
		expect(document.activeElement).toBe(spelling);
	});

	it('lands a member address on its tick and a column address on that column', async () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { fonts: { note: 'kerning off' } });
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		await mounted.editor.setCaret({
			field: 'main.checks.fonts.note',
			pos: 2,
			granularity: 'cluster'
		});
		await settle();
		expect(document.activeElement?.closest('.qm-member')).toBe(member(m, 'Fonts'));
		expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true);
		// The wash marks the member the address named.
		expect(washHost(mounted.target)).toBe(member(m, 'Fonts'));

		await mounted.editor.focusField('main.checks.margins');
		await settle();
		expect(document.activeElement).toBe(tick(m, 'Margins'));

		// A column of an unheld member is not drawn; the address lands on the tick that
		// would open it, never ticking it.
		await mounted.editor.focusField('main.checks.margins.note');
		await settle();
		expect(document.activeElement).toBe(tick(m, 'Margins'));
		expect(stored(doc)).toEqual({ fonts: { note: 'kerning off' } });
		expect(mounted.errors).toHaveLength(0);
	});

	it('draws a diagnostic under the member it names, and under its column when drawn', () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { fonts: { severity: 'major' } });
		const diagnostics = [
			{ severity: 'error' as const, message: 'not a severity', path: 'main.checks.fonts.severity' },
			{ severity: 'error' as const, message: 'no such column', path: 'main.checks.margins.note' }
		];
		const mounted = mountEditor(q, doc, { diagnostics });
		const m = matrix(mounted.target);

		// Held: the column is drawn, so the message sits under it.
		const severity = member(m, 'Fonts').querySelector('[data-qm-prop="severity"]')!;
		expect(severity.querySelector('.qm-diag-line')?.textContent).toBe('not a severity');
		// Unheld: no column to draw under, so the member's head holds it.
		expect(member(m, 'Margins').querySelector('.qm-diag-line')?.textContent).toBe('no such column');
		expect(m.querySelectorAll('.qm-diag-line')).toHaveLength(2);
	});
});

describe('an open matrix', () => {
	it('adds what was typed as a held item, titled, with the columns a member has', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		typeAdd(m, 'Kerning pairs');
		expect(offered(m)).toEqual(['Add “Kerning pairs”']);
		press(addBox(m), 'Enter', { cancelable: true });
		await settle();

		expect(stored(doc)).toEqual({ kerning_pairs: { title: 'Kerning pairs' } });
		expect(count(m)).toBe('1 of 7 held');
		const item = m.querySelector<HTMLElement>('.qm-member.added')!;
		expect(item.querySelector<HTMLInputElement>('.qm-member-title-input')?.value).toBe(
			'Kerning pairs'
		);
		// The caret lands in the item's first column, what the author came to fill.
		expect(document.activeElement?.closest('.qm-member')).toBe(item);
		expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true);
		expect(addBox(m).value).toBe('');
		expect(mounted.errors).toHaveLength(0);
	});

	it('retitles an added item in place and removes it whole', async () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { spelling: true, kerning: { title: 'Kerning', severity: 'major' } });
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		const item = () => m.querySelector<HTMLElement>('.qm-member.added');

		type(item()!.querySelector<HTMLInputElement>('.qm-member-title-input')!, 'Kerning pairs');
		// The id is the wire's, and a retitle leaves it where it is.
		expect(stored(doc)).toEqual({
			spelling: true,
			kerning: { title: 'Kerning pairs', severity: 'major' }
		});

		item()!.querySelector<HTMLButtonElement>('.qm-member-remove')!.click();
		await settle();
		expect(stored(doc)).toEqual({ spelling: true });
		expect(item()).toBeNull();
		expect(document.activeElement).toBe(addBox(m));
	});

	it("draws added items after the roster in id order, the plate's order", () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { zeta: { title: 'Zeta' }, alpha: { title: 'Alpha' } });
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		const titles = [...m.querySelectorAll<HTMLInputElement>('.qm-member-title-input')].map(
			(i) => i.value
		);
		expect(titles).toEqual(['Alpha', 'Zeta']);
		expect(m.querySelectorAll('.qm-member')[6]?.classList.contains('added')).toBe(true);
	});

	it("lands an added item's address and its title's on the title, a column on the column", async () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { kerning: { title: 'Kerning', note: 'tight' } });
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		const item = m.querySelector<HTMLElement>('.qm-member.added')!;
		const title = item.querySelector('.qm-member-title-input');

		await mounted.editor.focusField('main.checks.kerning');
		await settle();
		expect(document.activeElement).toBe(title);
		await mounted.editor.focusField('main.checks.kerning.title');
		await settle();
		expect(document.activeElement).toBe(title);
		await mounted.editor.focusField('main.checks.kerning.note');
		await settle();
		expect(document.activeElement?.closest('.qm-member')).toBe(item);
		expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true);
		expect(mounted.errors).toHaveLength(0);
	});

	it('finds a member before offering to add, and ticks it where it stands', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		typeAdd(m, 'fon');
		expect(offered(m)).toEqual(['Fonts', 'Add “fon”']);
		press(addBox(m), 'Enter', { cancelable: true });
		await settle();
		expect(stored(doc)).toEqual({ fonts: true });
		expect(document.activeElement).toBe(tick(m, 'Fonts'));

		// A held member is found as held, picking it lands on it and ticks nothing, and
		// words an item of this list already carries offer no add.
		typeAdd(m, 'fonts');
		expect(offered(m)).toEqual(['Fonts | held']);
		press(addBox(m), 'Enter', { cancelable: true });
		await settle();
		expect(stored(doc)).toEqual({ fonts: true });
		expect(document.activeElement).toBe(tick(m, 'Fonts'));
	});

	it('offers no add where an item of the list carries the words past the results shown', () => {
		const q = quill();
		const doc = q.seedDocument();
		// The search reads each as the one word `kerning`, so each ties the exact title
		// and, ahead of it in id order, takes its place in the results.
		const near = [
			'Kerning!',
			'Kerning?',
			'Kerning.',
			'Kerning:',
			'(Kerning)',
			'"Kerning"',
			'Kérning',
			'Kerning…'
		];
		doc.storeField('checks', {
			...Object.fromEntries(near.map((title, i) => [`a${i}`, { title }])),
			kerning: { title: 'Kerning' }
		});
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		typeAdd(m, 'Kerning');
		expect(offered(m)).toEqual(near.map((title) => `${title} | held`));
	});

	it('walks its options with the arrows and clears on Escape', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const m = matrix(mounted.target);
		const box = typeAdd(m, 'f');
		expect(box.getAttribute('aria-expanded')).toBe('true');
		const active = () => document.getElementById(box.getAttribute('aria-activedescendant') ?? '');
		expect(active()?.textContent).toContain('Figures');
		press(box, 'ArrowDown', { cancelable: true });
		expect(active()?.textContent).toContain('Fonts');
		press(box, 'ArrowUp', { cancelable: true });
		press(box, 'ArrowUp', { cancelable: true });
		expect(active()?.getAttribute('aria-selected')).toBe('true');
		expect(active()?.textContent).toContain('Add');
		press(box, 'Escape', { cancelable: true });
		expect(box.value).toBe('');
		expect(box.getAttribute('aria-expanded')).toBe('false');

		// It closes while the focus is elsewhere, and keeps what was typed.
		type(box, 'f');
		expect(box.getAttribute('aria-expanded')).toBe('true');
		box.blur();
		flushSync();
		expect(box.getAttribute('aria-expanded')).toBe('false');
		expect(box.value).toBe('f');
	});

	it('takes the add option on Enter where the words name a result only loosely', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		const box = typeAdd(m, 'fnt');
		expect(offered(m)).toEqual(['Fonts', 'Add “fnt”']);
		// An Enter mid-composition picks nothing.
		press(box, 'Enter', { cancelable: true, isComposing: true });
		expect(stored(doc)).toBeUndefined();
		press(box, 'Enter', { cancelable: true });
		await settle();
		expect(stored(doc)).toEqual({ fnt: { title: 'fnt' } });
	});

	it('mints an added id past a roster id its title folds to', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		const box = typeAdd(m, 'Fonts!');
		// `Fonts` is named outright, so the add option is an arrow away.
		press(box, 'ArrowUp', { cancelable: true });
		press(box, 'Enter', { cancelable: true });
		await settle();
		expect(stored(doc)).toEqual({ fonts_2: { title: 'Fonts!' } });
	});

	it('hands the caret to the next added item when one is removed', async () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', {
			a_one: { title: 'A' },
			b_two: { title: 'B' },
			c_three: { title: 'C' }
		});
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		const removes = [...m.querySelectorAll<HTMLButtonElement>('.qm-member-remove')];
		expect(removes.map((b) => b.getAttribute('aria-label'))).toEqual([
			'Remove A',
			'Remove B',
			'Remove C'
		]);
		removes[1].click();
		await settle();
		expect(stored(doc)).toEqual({ a_one: { title: 'A' }, c_three: { title: 'C' } });
		expect((document.activeElement as HTMLInputElement).value).toBe('C');
	});
});

const LISTS = `quill:
  name: lists
  version: 1.0.0
  backend: typst
  description: Checklists the add box searches across.
typst:
  plate_file: plate.typ
main:
  fields:
    leadership:
      type: matrix
      title: Leadership
      members:
        sq_cc: Squadron CC
        flight_cc: Flight CC
    staff:
      type: matrix
      title: Staff
      open: true
      members:
        haf: HAF Staff
        joint: Joint Staff
      properties:
        detail:
          type: string
          default: ""
    wrap:
      type: object
      title: Wrap
      properties:
        inner:
          type: matrix
          title: Inner
          open: true
          members:
            x: Flight X
    preset:
      type: matrix
      title: Preset
      members:
        a: Alpha
        b: Beta
      default:
        a: true
card_kinds:
  unit:
    title: Unit
    fields:
      quals:
        type: matrix
        title: Quals
        members:
          range_safety: Range Safety
`;

describe('the add box across the document', () => {
	it('offers a member of another list, and ticks it there', async () => {
		const q = quillFromYaml(LISTS);
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const staff = field(mounted.target, 'Staff');

		typeAdd(staff, 'flt cc');
		expect(offered(staff)).toEqual(['Flight CC | in Leadership', 'Add “flt cc”']);
		// Met only by abbreviation, so it is an arrow away from the add option Enter takes.
		press(addBox(staff), 'ArrowDown', { cancelable: true });
		press(addBox(staff), 'Enter', { cancelable: true });
		await settle();
		expect(doc.getStored('leadership')).toEqual({ flight_cc: true });
		expect(doc.getStored('staff')).toBeUndefined();
		// The landing is the member's own address: its tick.
		expect(document.activeElement).toBe(tick(field(mounted.target, 'Leadership'), 'Flight CC'));
		expect(mounted.errors).toHaveLength(0);
	});

	it("reaches a card's list, naming the card", async () => {
		const q = quillFromYaml(LISTS);
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const staff = field(mounted.target, 'Staff');

		typeAdd(staff, 'range');
		const [first] = offered(staff);
		expect(first.startsWith('Range Safety | in Quals · ')).toBe(true);
		press(addBox(staff), 'Enter', { cancelable: true });
		await settle();
		expect(doc.getStored({ card: 0, field: 'quals' })).toEqual({ range_safety: true });
	});
});

describe('a matrix nested in a container', () => {
	it('searches its own items alone', () => {
		const q = quillFromYaml(LISTS);
		const mounted = mountEditor(q, q.seedDocument());
		const inner = mounted.target.querySelector<HTMLElement>('.qm-object .qm-matrix')!;
		typeAdd(inner, 'flight');
		expect(offered(inner)).toEqual(['Flight X', 'Add “flight”']);
	});
});

describe('a matrix declaring a default', () => {
	it('draws the default set at the default rung, and the first gesture writes it whole', () => {
		const q = quillFromYaml(LISTS);
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const preset = field(mounted.target, 'Preset');
		expect(tick(preset, 'Alpha').checked).toBe(true);
		expect(preset.querySelector('.qm-matrix-roster')?.hasAttribute('data-default')).toBe(true);
		expect(doc.getStored('preset')).toBeUndefined();

		tick(preset, 'Beta').click();
		flushSync();
		expect(doc.getStored('preset')).toEqual({ a: true, b: true });
		expect(preset.querySelector('.qm-matrix-roster')?.hasAttribute('data-default')).toBe(false);

		// Nothing held is an answer that outranks the default, not a return to it.
		tick(preset, 'Alpha').click();
		flushSync();
		tick(preset, 'Beta').click();
		flushSync();
		expect(doc.getStored('preset')).toEqual({});
		expect(tick(preset, 'Alpha').checked).toBe(false);
	});
});
