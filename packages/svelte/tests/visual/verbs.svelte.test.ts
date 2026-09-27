// @vitest-environment jsdom
// The editor's verbs reached from outside its chrome, which is the whole point of
// them: a host toolbar, command palette or shortcut drives the same functions the
// card header calls, through `bind:this`, and gets the same `onChange`. They speak
// the public vocabulary — a `CardId` for a card, a `DocPath` for a place — so a host
// drives them with what the hooks handed it.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync, tick } from 'svelte';
import type { Document, Quill } from '@quillmark/wasm';
import { addrForFieldPath } from '$lib/core';
import { quill, template } from '../helpers/fixtures.js';
import { caret, mountEditor, press, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const slots = (target: HTMLElement) => [...target.querySelectorAll<HTMLElement>('.qm-card-slot')];
const leafKeys = (slot: HTMLElement) =>
	[...slot.querySelectorAll('[data-leaf-key]')].map((e) => e.getAttribute('data-leaf-key'));

describe('the card verbs', () => {
	it('insert, move, retype and remove, all reported as the click is', () => {
		const q = quill();
		const doc = template();
		const { target, editor, changes } = mountEditor(q, doc);
		// The blueprint seeds one card per declared kind; the verbs are asserted
		// against that count rather than a number pinned to the fixture's inventory.
		const seeded = slots(target).length;
		expect(seeded).toBeGreaterThan(0);
		const newId = `c${seeded}`;

		// The insert hands back the key, which is what a host tracking the new card
		// needs and the only thing the click path had no way to give it.
		const id = editor.insertCard('section');
		flushSync();
		expect(id).toBe(newId);
		expect(slots(target)).toHaveLength(seeded + 1);
		expect(changes.at(-1)).toEqual({
			source: 'structure',
			cardId: newId,
			path: `cards.section[${seeded}]`
		});

		editor.moveCard(id!, -1);
		flushSync();
		expect(changes.at(-1)).toEqual({
			source: 'structure',
			cardId: newId,
			path: `cards.section[${seeded - 1}]`
		});
		expect(leafKeys(slots(target)[seeded - 1])).toContain(`${newId}:$body`);

		editor.setKind(id!, 'note');
		flushSync();
		expect(changes.at(-1)?.cardId).toBe(newId);

		editor.removeCard(id!);
		flushSync();
		expect(changes.at(-1)).toEqual({ source: 'structure', cardId: newId, path: undefined });
		expect(slots(target)).toHaveLength(seeded);
		expect(leafKeys(slots(target)[0])).toContain('c0:$body');
	});

	it('inserts at a given index, and clamps one outside the stack', () => {
		const q = quill();
		const { target, editor } = mountEditor(q, template());
		const seeded = slots(target).length;

		const first = editor.insertCard('section', 0);
		flushSync();
		expect(leafKeys(slots(target)[0])).toContain(`${first}:$body`);

		// Past the end lands at the end rather than throwing or dropping the card.
		const last = editor.insertCard('section', 99);
		flushSync();
		expect(leafKeys(slots(target)[seeded + 1])).toContain(`${last}:$body`);
	});

	it('focuses a leaf by its path', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, template());

		await editor.focusField('cards.section[0].body');
		await tick();

		const focused = document.activeElement;
		expect(slots(target)[0].contains(focused)).toBe(true);
		expect(focused?.closest('[data-leaf-key]')?.getAttribute('data-leaf-key')).toBe('c0:$body');
	});
});

// A card's address does not survive a `moveCard` (`Addr` and `DocPath` are both
// positional), so every card-naming payload carries the session `cardId` beside it
// (VISUAL_EDITOR §"The address is the spine"): after a move the address a host captured
// names the other card, and the key still names the one that moved. The id-keyed
// commit-error map rides the same fact, so a refused write travels with its card.
describe('a reorder through the card control', () => {
	/**
	 * Exactly two `section` cards, the smallest stack a reorder is visible in. `section`
	 * carries the fixture's card-side `datetime` (`reviewed_at`), the one commit a mounted
	 * control cannot satisfy: the date control emits `YYYY-MM-DD` whatever the declared
	 * type, and a `datetime` coerces none (`edit::field_coercion_failed`).
	 */
	function twoSections(q: Quill): Document {
		const doc = q.seedDocument();
		for (let i = doc.cardCount - 1; i >= 0; i--) {
			if (doc.card(i).kind !== 'section') doc.removeCard(i);
		}
		const card = q.seedCard('section', doc.seedOverlay('section'));
		if (!card) throw new Error('fixture drift: the quill seeds no section card');
		doc.insertCard(card, 1);
		return doc;
	}
	/** Focus a card's body leaf where PM listens: on the view's own element, and focus
	 *  does not bubble. */
	function focusBody(slot: HTMLElement): void {
		slot
			.querySelector('[data-leaf-key$="$body"] .ProseMirror')!
			.dispatchEvent(new FocusEvent('focus'));
		flushSync();
	}
	function moveDown(slot: HTMLElement): void {
		slot.querySelectorAll<HTMLButtonElement>('.qm-card-reorder button')[1].click();
		flushSync();
	}
	const refusal = (slot: HTMLElement) => slot.querySelector<HTMLElement>('.qm-diag-line');

	it('moves the key with the card and leaves the address behind', () => {
		const q = quill();
		const { target, changes, active } = mountEditor(q, twoSections(q));
		expect(slots(target)).toHaveLength(2);

		focusBody(slots(target)[0]);
		const captured = active.at(-1)!;
		expect(captured).toEqual({ field: 'cards.section[0].body', cardId: 'c0' });

		moveDown(slots(target)[0]);
		// The path names the card, not the body leaf inside it: a card op is about the card.
		expect(changes.at(-1)).toEqual({ source: 'structure', cardId: 'c0', path: 'cards.section[1]' });

		const after = slots(target);
		const staleIndex = addrForFieldPath(captured.field)!.card!;
		expect(leafKeys(after[staleIndex])).toContain('c1:$body');
		expect(leafKeys(after[1])).toContain(`${captured.cardId}:$body`);
	});

	it('carries a refused commit with the card, not with the index', () => {
		const q = quill();
		const { target } = mountEditor(q, twoSections(q));

		// One ArrowUp per segment completes the date, which the writer refuses.
		for (const seg of slots(target)[0].querySelectorAll<HTMLElement>('[data-date-field-segment]'))
			if (seg.getAttribute('data-segment') !== 'literal') press(seg, 'ArrowUp');
		expect(refusal(slots(target)[0])?.textContent).toContain('could not be coerced');
		expect(refusal(slots(target)[1])).toBeNull();

		moveDown(slots(target)[0]);
		const after = slots(target);
		expect(refusal(after[0])).toBeNull();
		expect(refusal(after[1])?.textContent).toContain('could not be coerced');
		expect(leafKeys(after[1])).toContain('c0:$body');
	});

	// The post-mutation scroll is one per tick, on the terms of that tick's last mutation.
	// An insert and a move of the same card are the pair a per-id handle cannot tell
	// apart: two calls naming one id, one asking for `center` and one for `nearest`.
	it('scrolls once for two mutations inside one tick, on the terms of the last', async () => {
		const q = quill();
		const { editor } = mountEditor(q, twoSections(q));
		const trips: (ScrollIntoViewOptions | undefined)[] = [];
		const scroll = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
			trips.push(arg as ScrollIntoViewOptions);
		};

		const id = editor.insertCard('section', 1);
		editor.moveCard(id!, -1);
		await settle();

		expect(trips.map((t) => t?.block)).toEqual(['nearest']);
		Element.prototype.scrollIntoView = scroll;
	});
});

// A document's scalar fields are its front matter, and the preview reports a region for
// them (`session.regions()` names `main.signature_block` beside `main.body`), so a
// landing that reached content leaves only covered the smaller half of the bridge.
describe('the landing verbs over a form control', () => {
	it('focuses a string field, revealing the collapsed group holding it', async () => {
		const q = quill();
		const { target, editor, errors } = mountEditor(q, template());

		// `meta` is not the initially-expanded group, so the control starts inside
		// an `inert` panel: the reveal is half of the landing, not a nicety.
		const header = [...target.querySelectorAll<HTMLElement>('.qm-group-header')].find((h) =>
			h.textContent?.includes('Metadata')
		);
		expect(header?.getAttribute('aria-expanded')).toBe('false');

		await editor.focusField('main.tracking_id');
		await tick();

		expect(header?.getAttribute('aria-expanded')).toBe('true');
		// The input the field's own `<label for>` names, inside the panel the reveal
		// opened: the same place a click on that label lands, which is the point of the
		// two reading one function.
		const focused = document.activeElement as HTMLElement;
		expect(focused.tagName).toBe('INPUT');
		const panel = document.getElementById(header!.getAttribute('aria-controls')!);
		expect(panel?.contains(focused)).toBe(true);
		expect(panel?.querySelector(`label[for="${focused.id}"]`)).not.toBeNull();
		expect(errors).toHaveLength(0);
	});

	// The landing measures its target one flush after asking for the reveal, and a track
	// animating from `0fr` still reads its start value there: a target under a group that
	// had to open was measured against a panel that had not moved, and settled past the
	// fold. Layout is a thing jsdom does not have, so the seam is the flag rather than the
	// rect: the reveal moves the accordion instantly, and the header gesture the motion is
	// there for is what restores it.
	it('reveals a group instantly, and animates again for a header click', async () => {
		const q = quill();
		const { target, editor } = mountEditor(q, template());
		const header = [...target.querySelectorAll<HTMLElement>('.qm-group-header')].find((h) =>
			h.textContent?.includes('Metadata')
		);
		const groups = header?.closest('.qm-groups');
		expect(groups?.classList.contains('qm-instant')).toBe(false);

		await editor.focusField('main.tracking_id');
		await tick();
		expect(groups?.classList.contains('qm-instant')).toBe(true);

		header?.click();
		await tick();
		expect(groups?.classList.contains('qm-instant')).toBe(false);
	});

	it('focuses an array field at its first element, and a date field at its first segment', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		// The array's own answer to "focus this field", the one its label click takes.
		await editor.focusField('main.authors');
		await tick();
		expect(document.activeElement?.closest('.qm-array-row')).not.toBeNull();

		await editor.focusField('main.issued');
		await tick();
		expect(document.activeElement?.getAttribute('data-segment')).toBeTruthy();

		expect(errors).toHaveLength(0);
	});

	it('reports the focused control as the active leaf, as a prose leaf reports', async () => {
		const q = quill();
		const { editor, active } = mountEditor(q, template());

		await editor.focusField('main.tracking_id');
		await tick();
		expect(active.at(-1)).toEqual({ field: 'main.tracking_id', cardId: 'main' });

		// An array of `richtext`: the element is a PM view with no controller of its own,
		// and the report is the wrapper's bubbling `focusin` like every other control's.
		await editor.focusField('main.keywords');
		await tick();
		expect(active.at(-1)).toEqual({ field: 'main.keywords', cardId: 'main' });
	});

	it('lands a preview hit on a control by focusing it, placing no caret', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		// A `pos` a control has no coordinate to spend: the field is revealed and
		// focused, which is the whole of what a click on plate-placed ink can mean.
		await editor.setCaret({ field: 'main.tracking_id', pos: 3 });
		await tick();

		expect(document.activeElement?.tagName).toBe('INPUT');
		expect(errors).toHaveLength(0);
	});

	it('lands a pick that carries no caret, the rung a plate-placed field answers on', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		// `main.signature_block` is placed with its content untracked: the preview's
		// second rung names the field and has no offset to hand over.
		await editor.setCaret({ field: 'main.signature_block' });
		await tick();

		expect(document.activeElement?.closest('.qm-array-row')).not.toBeNull();
		expect(errors).toHaveLength(0);
	});
});

// An array element address (`main.keywords[0]`) is a granularity `Addr` cannot name
// and the registry is not keyed at: the ladder reads the trailing index segment under
// a field the schema declares an array, reveals the parent, and takes the row.
describe('a landing on an array element', () => {
	it('takes the row the address names rather than the first', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		await editor.setCaret({ field: 'main.keywords[1]', pos: 4 });
		await tick();

		// The element's own accessible name is `label` + its 1-based index, so this
		// distinguishes the row from the one a bare `focusField` would land on.
		expect(document.activeElement?.getAttribute('aria-label')).toBe('Keywords 2');
		expect(errors).toHaveLength(0);
	});

	it('places the caret at the offset the compile resolved, inside the row', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		// `keywords[0]` is `*Schema* shapes`: 13 USV of content, the markup stripped.
		// USV 5 is inside the emphasized word, so a caret that landed on the row and
		// guessed would sit at 0 in some other text node.
		await editor.setCaret({ field: 'main.keywords[0]', pos: 5, granularity: 'cluster' });
		await tick();

		expect(document.activeElement?.getAttribute('aria-label')).toBe('Keywords 1');
		expect(caret()).toEqual({ text: 'Schema', offset: 5 });
		expect(errors).toHaveLength(0);
	});

	it('takes the row with a bare focus for a segment hit and for a pick with no pos', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		await editor.setCaret({ field: 'main.keywords[0]', pos: 5, granularity: 'cluster' });
		await tick();

		// A `'segment'` hit landed on origin-less ink: `pos` is the segment start, not a
		// caret the click resolved, so it is dropped on this lane as on the other. Asserted
		// as a caret that did not move, a landing at 0 being what a guess would also give.
		await editor.setCaret({ field: 'main.keywords[0]', pos: 0, granularity: 'segment' });
		await tick();
		expect(caret()).toEqual({ text: 'Schema', offset: 5 });

		await editor.setCaret({ field: 'main.keywords[0]' });
		await tick();
		expect(caret()).toEqual({ text: 'Schema', offset: 5 });
		expect(errors).toHaveLength(0);
	});

	it('clamps an offset past the row to its end', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		// A landing off a compile the row's value has moved past: the field and the row
		// are right and the offset is not, which clamps rather than throws.
		await editor.setCaret({ field: 'main.keywords[0]', pos: 999, granularity: 'cluster' });
		await tick();

		expect(document.activeElement?.getAttribute('aria-label')).toBe('Keywords 1');
		expect(caret()).toEqual({ text: ' shapes', offset: 7 });
		expect(errors).toHaveLength(0);
	});

	it('falls back to the field for a row this document no longer has', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		// A landing off a compile the document has moved past: the field is right and
		// the row is gone, so the array's own focus answer stands.
		await editor.focusField('main.keywords[9]');
		await tick();

		expect(document.activeElement?.getAttribute('aria-label')).toBe('Keywords 1');
		expect(errors).toHaveLength(0);
	});
});

describe('a verb handed a target the surface does not hold', () => {
	it('no-ops and reports target-unknown at dev, for a card and for a path', async () => {
		const q = quill();
		const { target, editor, changes, errors } = mountEditor(q, template());

		editor.removeCard('c99');
		editor.moveCard('c99', 1);
		const seeded = slots(target).length;
		editor.setKind('c99', 'section');
		await editor.focusField('main.no_such_field');
		flushSync();

		// Nothing moved and nothing was reported as a change: the document is untouched.
		expect(slots(target)).toHaveLength(seeded);
		expect(changes).toHaveLength(0);
		expect(errors.map((e) => e.code)).toEqual(Array(4).fill('target-unknown'));
		expect(errors.every((e) => e.severity === 'dev')).toBe(true);
		expect(errors.at(-1)?.path).toBe('main.no_such_field');
	});

	it('reports an element path whose array is not one, through either verb', async () => {
		const q = quill();
		const { editor, errors } = mountEditor(q, template());

		// The element rung is schema-guarded: a trailing index under a field that is no
		// array is a nested address the tree mounts nothing at, and reading it as a row
		// would land the caret in a field the path does not name. `tracking_id` is
		// a string; `no_such_field` is nothing at all.
		await editor.focusField('main.tracking_id.0');
		await editor.setCaret({ field: 'main.no_such_field.0', pos: 0 });
		flushSync();

		expect(errors.map((e) => e.code)).toEqual(['target-unknown', 'target-unknown']);
		expect(errors.every((e) => e.severity === 'dev')).toBe(true);
		expect(errors.at(-1)?.path).toBe('main.no_such_field.0');
	});
});
