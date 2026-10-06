// @vitest-environment jsdom
// The matrix control (VISUAL_EDITOR §"The matrix"): ticks over the roster, columns
// unfolding under a held member, one sparse map committed whole, a member held by being
// present. Driven off the reference quill's `checks` — six members on one flat roster,
// open to added items, two columns — and read back through the document; a probe quill
// carries an open checklist and a declared default.
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
const addBox = (m: HTMLElement) => m.querySelector<HTMLInputElement>('.qm-matrix-add input')!;
/** The added items' titles, in the order they draw. */
const addedTitles = (m: HTMLElement) =>
	[...m.querySelectorAll<HTMLInputElement>('.qm-member.added .qm-member-title-input')].map(
		(i) => i.value
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

	it('adds a title the list already carries as a second item under its own id', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		for (const title of ['Kerning pairs', 'Kerning pairs', 'KERNING PAIRS']) {
			press(typeAdd(m, title), 'Enter', { cancelable: true });
			await settle();
		}
		expect(stored(doc)).toEqual({
			kerning_pairs: { title: 'Kerning pairs' },
			kerning_pairs_2: { title: 'Kerning pairs' },
			kerning_pairs_3: { title: 'KERNING PAIRS' }
		});
		expect(addedTitles(m)).toEqual(['Kerning pairs', 'Kerning pairs', 'KERNING PAIRS']);
		expect(count(m)).toBe('3 of 9 held');
		expect(mounted.errors).toHaveLength(0);
	});

	it('adds nothing on Enter over whitespace or mid-composition', () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		const box = typeAdd(m, '   ');
		press(box, 'Enter', { cancelable: true });
		expect(stored(doc)).toBeUndefined();
		type(box, 'Kerning');
		press(box, 'Enter', { cancelable: true, isComposing: true });
		expect(stored(doc)).toBeUndefined();
		expect(box.value).toBe('Kerning');
	});

	it('clears on Escape, taking the key only where there was something to clear', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const m = matrix(mounted.target);
		let reached = 0;
		const onEscape = (e: KeyboardEvent) => void (e.key === 'Escape' && reached++);
		document.addEventListener('keydown', onEscape);
		try {
			const box = typeAdd(m, 'Kerning');
			press(box, 'Escape', { cancelable: true });
			expect(box.value).toBe('');
			expect(reached).toBe(0);
			press(box, 'Escape', { cancelable: true });
			expect(reached).toBe(1);
		} finally {
			document.removeEventListener('keydown', onEscape);
		}
	});

	it('is a plain text input, with no combobox role and no listbox under it', () => {
		const q = quill();
		const mounted = mountEditor(q, q.seedDocument());
		const m = matrix(mounted.target);

		const box = typeAdd(m, 'f');
		expect(box.type).toBe('text');
		expect(box.getAttribute('aria-label')).toBe(box.placeholder);
		for (const attr of [
			'role',
			'aria-autocomplete',
			'aria-expanded',
			'aria-controls',
			'aria-activedescendant'
		])
			expect(box.hasAttribute(attr), attr).toBe(false);
		expect(m.querySelector('[role="listbox"], [role="option"]')).toBeNull();
	});

	it('mints an added id past a roster id its title folds to', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		press(typeAdd(m, 'Fonts!'), 'Enter', { cancelable: true });
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
  description: An open checklist and a matrix declaring a default.
typst:
  plate_file: plate.typ
main:
  fields:
    tags:
      type: matrix
      title: Tags
      open: true
      members:
        draft: Draft
    preset:
      type: matrix
      title: Preset
      members:
        a: Alpha
        b: Beta
      default:
        a: true
`;

describe('an open checklist', () => {
	it('keeps the caret in the add box for the next item', async () => {
		const q = quillFromYaml(LISTS);
		const doc = q.seedDocument();
		const mounted = mountEditor(q, doc);
		const tags = field(mounted.target, 'Tags');

		press(typeAdd(tags, 'Reviewed'), 'Enter', { cancelable: true });
		await settle();
		expect(doc.getStored('tags')).toEqual({ reviewed: { title: 'Reviewed' } });
		expect(document.activeElement).toBe(addBox(tags));
		expect(addBox(tags).value).toBe('');

		type(addBox(tags), 'Signed');
		press(addBox(tags), 'Enter', { cancelable: true });
		await settle();
		expect(addedTitles(tags)).toEqual(['Reviewed', 'Signed']);
		expect(document.activeElement).toBe(addBox(tags));
		expect(mounted.errors).toHaveLength(0);
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
