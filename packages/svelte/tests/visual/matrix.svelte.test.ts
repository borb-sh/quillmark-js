// @vitest-environment jsdom
// The matrix control (VISUAL_EDITOR §"Structure mirrors the schema"): ticks over the
// roster, columns unfolding under a held member, one sparse map committed whole.
// Driven off the reference quill's `checks` — six members on one flat roster,
// two columns — and read back through the document.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import { quill } from '../helpers/fixtures.js';
import {
	field,
	mountEditor,
	openGroup,
	pick,
	press,
	settle,
	stubLayout,
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
const count = (m: HTMLElement) => m.querySelector('.qm-matrix-count')?.textContent;

describe('a matrix field', () => {
	it('draws the roster as real checkboxes in declaration order, each titled by a label for it', () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
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
		// A matrix seeds empty, so nothing is stored and no member unfolds.
		expect(m.querySelectorAll('.qm-object')).toHaveLength(0);
		expect(m.querySelector('input[type="text"]')).toBeNull();
	});

	it('ticks, annotates, unticks and reticks without losing the columns', () => {
		const q = quill();
		const doc = q.seedDocument();
		mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);

		tick(m, 'Spelling').click();
		flushSync();
		expect(stored(doc)).toEqual({ spelling: { held: true } });
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

		pick(spelling.querySelector<HTMLElement>('.qm-select')!, 'major');
		expect(stored(doc)).toEqual({ spelling: { held: true, severity: 'major' } });

		// An untick keeps the columns under `held: false`, and stops drawing them.
		tick(m, 'Spelling').click();
		flushSync();
		expect(stored(doc)).toEqual({ spelling: { held: false, severity: 'major' } });
		expect(member(m, 'Spelling').querySelector('.qm-object')).toBeNull();
		expect(count(m)).toBe('0 of 6 held');

		tick(m, 'Spelling').click();
		flushSync();
		expect(stored(doc)).toEqual({ spelling: { held: true, severity: 'major' } });
		expect(member(m, 'Spelling').querySelector('.qm-select')?.textContent?.trim()).toBe('major');
	});

	it('reads the bare true spelling as held, and keeps it held through an edit elsewhere', () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { fonts: true });
		mounted = mountEditor(q, doc);
		const m = matrix(mounted.target);
		expect(tick(m, 'Fonts').checked).toBe(true);
		expect(count(m)).toBe('1 of 6 held');

		// Editing another member hands the map up with `fonts` as the document spelled it;
		// the typed writer then rests every member at the object form, so what holds is
		// that `fonts` stays held and carries nothing it did not have.
		tick(m, 'Margins').click();
		flushSync();
		expect(stored(doc)).toEqual({ fonts: { held: true }, margins: { held: true } });
		expect(tick(m, 'Fonts').checked).toBe(true);

		// A member unheld with no columns leaves the map; the last one out unsets the field.
		tick(m, 'Margins').click();
		flushSync();
		expect(stored(doc)).toEqual({ fonts: { held: true } });
		tick(m, 'Fonts').click();
		flushSync();
		expect(stored(doc)).toBeUndefined();
	});

	it('keys as a checkbox group: every tick a tab stop, and no arrow walk', () => {
		const q = quill();
		mounted = mountEditor(q, q.seedDocument());
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
		doc.storeField('checks', { fonts: { held: true, note: 'kerning off' } });
		mounted = mountEditor(q, doc);
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
		expect(stored(doc)).toEqual({ fonts: { held: true, note: 'kerning off' } });
		expect(mounted.errors).toHaveLength(0);
	});

	it('draws a diagnostic under the member it names, and under its column when drawn', () => {
		const q = quill();
		const doc = q.seedDocument();
		doc.storeField('checks', { fonts: { held: true, severity: 'major' } });
		const diagnostics = [
			{ severity: 'error' as const, message: 'not a severity', path: 'main.checks.fonts.severity' },
			{ severity: 'error' as const, message: 'no such column', path: 'main.checks.margins.note' }
		];
		mounted = mountEditor(q, doc, { diagnostics });
		const m = matrix(mounted.target);

		// Held: the column is drawn, so the message sits under it.
		const severity = member(m, 'Fonts').querySelector('[data-qm-prop="severity"]')!;
		expect(severity.querySelector('.qm-diag-line')?.textContent).toBe('not a severity');
		// Unheld: no column to draw under, so the member's head holds it.
		expect(member(m, 'Margins').querySelector('.qm-diag-line')?.textContent).toBe('no such column');
		expect(m.querySelectorAll('.qm-diag-line')).toHaveLength(2);
	});
});
