// @vitest-environment jsdom
// The standalone prose leaf: a `createField` over a real `showcase` `title` (inline)
// and body edits via applyChange; the caret survives own-edits through the PM StepMap;
// an external content change re-hydrates and the leaf's own edit does not; a narrowed
// field holds over a value upstream's `inline` rule refuses, and releases once it fits.
import { describe, it, expect, beforeEach } from 'vitest';
import { EditorView } from 'prosemirror-view';
import { Selection } from 'prosemirror-state';
import { createField, blockSchema, pmToContent } from '$lib/core/codec';
import type { FieldController } from '$lib/core/codec';
import type { Document, TableProps } from '@quillmark/wasm';
import { undo } from 'prosemirror-history';
import { mount, quill, template, normalize, contentEqual, md } from './_util.js';

// jsdom lays nothing out, and `setCaret`'s flagged dispatch asks PM for the caret's
// rect to reveal it. Stubbed rather than guarded in the source: a landing is right to
// reveal itself unconditionally in a browser, and a zero rect scrolls nothing here.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

/** The view is attached to the controller as an undocumented handle. */
function viewOf(f: FieldController): EditorView {
	return (f as FieldController & { view: EditorView }).view;
}

describe('createField over a real showcase leaf', () => {
	let doc: Document;
	beforeEach(() => {
		doc = template();
	});

	it('edits the inline `title` field via applyChange', () => {
		const caret: number[] = [];
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount(),
			inline: true,
			onCaretMove: (_addr, pos) => caret.push(pos)
		});
		const before = (doc.getStored('title') as { text: string }).text;
		const view = viewOf(field);
		// Place the caret after the first char (USV 1), then type "X" there;
		// the caret advances to USV 2 as real typing would.
		field.setCaret(1);
		view.dispatch(view.state.tr.insertText('X', view.state.selection.head));
		const after = (doc.getStored('title') as { text: string }).text;
		expect(after).not.toBe(before);
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe('X');
		// onCaretMove fired with the post-edit USV caret (past the inserted char).
		expect(caret.at(-1)).toBe(2);
		field.destroy();
	});

	it('edits the main body via applyChange and preserves marks path', () => {
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		const before = doc.main.body.text;
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('Z', 2)); // PM 2 = USV 1 (after first char)
		const after = doc.main.body.text;
		expect(after).not.toBe(before);
		expect(after[0]).toBe(before[0]);
		expect(after[1]).toBe('Z');
		field.destroy();
	});

	it('caret survives an own-edit through the StepMap', () => {
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount()
		});
		const view = viewOf(field);
		// Put the caret at USV 5, then insert two chars before it.
		field.setCaret(5);
		const head0 = view.state.selection.head;
		expect(head0).toBe(6); // inline single paragraph: USV k ↔ PM k+1
		view.dispatch(view.state.tr.insertText('AB', 1)); // insert before the caret
		// The selection mapped forward by 2 (StepMap): caret continuity across own-edits.
		expect(view.state.selection.head).toBe(head0 + 2);
		field.destroy();
	});
});

describe('field-level reconciliation', () => {
	it('applyExternal re-hydrates on a foreign edit; own edit does not', () => {
		const doc = template();
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount()
		});
		const view = viewOf(field);

		// The field's own edit: applyExternal must not re-hydrate (no divergence).
		view.dispatch(view.state.tr.insertText('Q', 1));
		const afterOwn = view.state.doc;
		field.applyExternal();
		expect(view.state.doc).toBe(afterOwn); // same state object → no re-hydrate

		// A foreign edit straight to the content (another source), then applyExternal.
		doc.applyChange(
			{ field: 'title' },
			{
				delta: {
					ops: [
						{ insert: 'EXT ' },
						{ retain: (doc.getStored('title') as { text: string }).text.length }
					]
				}
			}
		);
		field.applyExternal();
		expect(view.state.doc.textContent.startsWith('EXT ')).toBe(true);
		expect((field.getContent() as { text: string }).text.startsWith('EXT ')).toBe(true);
		field.destroy();
	});
});

describe('the hold on a narrowed field', () => {
	const STRUCTURED = '- one\n- two\n\npara ![i](a.png)';
	/** The transaction a keystroke dispatches, at the first text position. */
	const keystroke = (view: EditorView) =>
		view.dispatch(view.state.tr.insertText('Z', Selection.atStart(view.state.doc).from));
	const leaf = (doc: Document, field: string, holds: boolean[], plaintext = false) =>
		createField({
			doc,
			quill: quill(),
			addr: { field },
			container: mount(),
			inline: true,
			plaintext,
			onHold: (held) => holds.push(held)
		});

	it('releases when the value an external write leaves is inline, and then commits', () => {
		const doc = template();
		doc.storeField('title', STRUCTURED);
		const holds: boolean[] = [];
		const field = leaf(doc, 'title', holds);
		const view = viewOf(field);
		expect(holds).toEqual([true]);
		expect(view.editable).toBe(false);
		expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
		keystroke(view);
		expect(doc.getStored('title')).toBe(STRUCTURED);

		quill().writer(doc).set('title', 'plain');
		field.applyExternal();
		expect(holds).toEqual([true, false]);
		expect(view.editable).toBe(true);
		keystroke(view);
		expect(field.getContent().text).toBe('Zplain');
		field.destroy();
	});

	it('holds before a commit when an external store write gains structure', () => {
		const doc = template();
		const holds: boolean[] = [];
		const field = leaf(doc, 'title', holds);
		const view = viewOf(field);
		expect(view.editable).toBe(true);

		doc.storeField('title', STRUCTURED);
		field.applyExternal();
		expect(holds).toEqual([true]);
		expect(view.editable).toBe(false);
		expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
		keystroke(view);
		expect(doc.getStored('title')).toBe(STRUCTURED);
		field.destroy();
	});

	it('holds a plaintext(inline) field, whose refusal upstream names not_plain', () => {
		const doc = template();
		doc.overwrite({ field: 'subtitle' }, md(STRUCTURED));
		expect(
			quill()
				.validate(doc)
				.filter((d) => d.path === 'main.subtitle')
				.map((d) => d.code)
		).toEqual(['validation::not_plain']);
		const before = JSON.stringify(doc.getStored('subtitle'));
		const holds: boolean[] = [];
		const field = leaf(doc, 'subtitle', holds, true);
		expect(holds).toEqual([true]);
		expect(viewOf(field).editable).toBe(false);
		// A plaintext leaf commits through the typed writer, which would store it joined.
		keystroke(viewOf(field));
		expect(JSON.stringify(doc.getStored('subtitle'))).toBe(before);
		field.destroy();
	});

	it('does not hold for the trailing newline a YAML block scalar keeps', () => {
		const doc = template();
		doc.storeField('subtitle', 'one line\n');
		expect(
			quill()
				.validate(doc)
				.filter((d) => d.path === 'main.subtitle')
				.map((d) => [d.code, d.args?.trailingNewline])
		).toEqual([['validation::not_inline', true]]);
		const holds: boolean[] = [];
		const field = leaf(doc, 'subtitle', holds, true);
		expect(holds).toEqual([]);
		expect(viewOf(field).editable).toBe(true);
		field.destroy();
	});
});

describe('plaintext fields fire no markdown input rules', () => {
	// A `**x**` rule reaching a plaintext field would apply a strong mark and eat the
	// delimiters its author is entitled to. `plaintextSchema` declares no mark types, so
	// the rule is never built (`markdownInputRules` guards each on its type). The rule is
	// triggered the way a keystroke does: via `handleTextInput` with the char that
	// completes the pattern.
	function fireClosingStar(view: EditorView): unknown {
		const pos = view.state.selection.head;
		// `handleTextInput(view, from, to, text, deflt)`; the input-rules plugin
		// never calls `deflt`, so a no-op tr satisfies the type.
		return view.someProp('handleTextInput', (f) => f(view, pos, pos, '*', () => view.state.tr));
	}

	it('a plaintext field does NOT fire the strong rule — delimiters and no-marks survive', () => {
		const doc = template();
		const before = doc.getStored('subtitle') as string;
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'subtitle' }, // `plaintext`, `inline: true`
			container: mount(),
			plaintext: true,
			inline: true
		});
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('**x*', 1)); // literal; the closing `*` fires the rule
		expect(fireClosingStar(view)).toBeFalsy(); // no rule to match → not intercepted
		view.dispatch(view.state.tr.insertText('*', view.state.selection.head));
		// The literal string, the field's rest form: no mark had anywhere to land.
		expect(doc.getStored('subtitle')).toBe(`**x**${before}`);
		field.destroy();
	});

	it('a non-plaintext inline field DOES fire it (proving the schema is what suppresses it)', () => {
		const doc = template();
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'colophon' },
			container: mount(),
			inline: true
		});
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('**x*', 1));
		expect(fireClosingStar(view)).toBe(true); // the rule intercepts and transforms
		const rt = doc.getStored('colophon') as { text: string; marks: { type: string }[] };
		expect(rt.text).toBe('x');
		expect(rt.marks.some((m) => m.type === 'strong')).toBe(true);
		field.destroy();
	});
});

describe('createField over an ABSENT declared richtext field', () => {
	it('installs on the first edit (applyChange throws on absent), then applyChanges', () => {
		const doc = template();
		// `colophon` is `default:`-only, so it is absent from the seed.
		expect(doc.getStored('colophon')).toBeUndefined();
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'colophon' },
			container: mount(),
			inline: true
		});
		const view = viewOf(field);
		// First edit → the codec installs the field (creating it).
		view.dispatch(view.state.tr.insertText('Motto', 1));
		expect((doc.getStored('colophon') as { text: string } | undefined)?.text).toBe('Motto');
		// Second edit → the field is now present, so it lowers to applyChange and lands.
		field.setCaret(5);
		view.dispatch(view.state.tr.insertText('!', view.state.selection.head));
		expect((doc.getStored('colophon') as { text: string }).text).toBe('Motto!');
		field.destroy();
	});
});

describe('a within-block hard break', () => {
	it('lands in the store as a `continues` line, matching the optimistic PM', () => {
		const doc = template();
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		const view = viewOf(field);
		// Insert a hard_break into the first paragraph: the `continues` line that
		// `setContinues` reaches, so it commits through `applyChange`.
		field.setCaret(3);
		view.dispatch(view.state.tr.replaceSelectionWith(blockSchema.nodes.hard_break.create(), false));
		// The store now carries a within-block hard break (continues:true), and it
		// matches the optimistic PM up to normalization.
		const body = doc.main.body;
		expect(body.lines.some((l) => l.continues)).toBe(true);
		expect(contentEqual(body, normalize(pmToContent(view.state.doc)))).toBe(true);
		field.destroy();
	});
});

describe('anchor insertion', () => {
	/** The `anchor` identity marks of the stored body content, `id` lifted out of `attrs`. */
	function bodyAnchors(doc: Document): { id: string; start: number; end: number }[] {
		return doc.main.body.marks
			.filter((m) => m.type === 'anchor')
			.map((m) => ({ id: m.attrs.id, start: m.start, end: m.end }));
	}

	it('inserts a caller-supplied identity anchor that persists in the content', () => {
		const doc = template();
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		field.insertAnchor('a1', 3);
		const anchors = bodyAnchors(doc);
		expect(anchors).toHaveLength(1);
		expect(anchors[0]).toMatchObject({ id: 'a1', start: 3, end: 3 }); // zero-width
		field.destroy();
	});

	it('a duplicate id is a no-op; removeAnchor drops the anchor', () => {
		const doc = template();
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		field.insertAnchor('a1', 3);
		field.insertAnchor('a1', 5); // same id → ignored (unique + invariant, 0.97 policy)
		expect(bodyAnchors(doc)).toHaveLength(1);
		field.removeAnchor('a1');
		expect(bodyAnchors(doc)).toHaveLength(0);
		field.destroy();
	});

	it('the anchor rebases through a later text edit — it survives like a mark', () => {
		const doc = template();
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		field.insertAnchor('a1', 5);
		const view = viewOf(field);
		// Insert two chars at the very start (PM 1 = USV 0): the anchor shifts by 2.
		view.dispatch(view.state.tr.insertText('XY', 1));
		expect(bodyAnchors(doc)).toMatchObject([{ id: 'a1', start: 7 }]);
		field.destroy();
	});

	it('anchorsInRange reports coverage for the popover active state', () => {
		const doc = template();
		const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
		field.insertAnchor('a1', 4);
		expect(field.anchorsInRange(0, 10)).toEqual(['a1']);
		expect(field.anchorsInRange(0, 3)).toEqual([]);
		field.destroy();
	});
});

describe('createField accessible name (a11y follow-up)', () => {
	it('sets aria-label on the editable element when a label is given', () => {
		const doc = template();
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount(),
			inline: true,
			label: 'Title'
		});
		expect(viewOf(field).dom.getAttribute('aria-label')).toBe('Title');
		field.destroy();
	});

	it('leaves the editable element unnamed when no label is given', () => {
		const doc = template();
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: mount(),
			inline: true
		});
		expect(viewOf(field).dom.hasAttribute('aria-label')).toBe(false);
		field.destroy();
	});
});

// The ghost is chrome: it decorates an empty leaf, never enters the document, and
// moves without an edit. `setPlaceholder` is what a retyped card uses to take its
// new kind's wording; the leaf is keyed by card id, so it cannot remount to pick
// one up.
describe('the empty-leaf ghost', () => {
	const ghostOf = (f: FieldController): string | null =>
		viewOf(f).dom.querySelector('.qm-prose-placeholder')?.getAttribute('data-placeholder') ?? null;

	/** A freshly added card's body: empty, which the seeded main body is not.
	 *  This is the very leaf the fallback exists for. `note` is the kind declaring no
	 *  body `example`, so its seed carries nothing for the ghost to hide behind. */
	function emptyBodyDoc(): Document {
		const q = quill();
		const doc = template();
		const card = q.seedCard('note', doc.seedOverlay('note'));
		doc.insertCard(card!, doc.cardCount);
		return doc;
	}
	/** The card just added: the last one, whatever the blueprint seeded ahead of it. */
	const cardBody = (doc: Document) => ({ card: doc.cardCount - 1 });

	function emptyBody(doc: Document, placeholder?: string): FieldController {
		return createField({
			doc,
			quill: quill(),
			addr: cardBody(doc),
			container: mount(),
			placeholder
		});
	}

	it('decorates an empty leaf with the ghost, and no leaf without one', () => {
		const doc = emptyBodyDoc();
		expect(ghostOf(emptyBody(doc, 'Write…'))).toBe('Write…');
		expect(ghostOf(emptyBody(doc))).toBeNull();
		// Decoration only: a body that reads as empty stays empty in the store.
		expect(doc.cards.at(-1)!.body.text).toBe('');
	});

	it('moves the ghost after mount without touching the document', () => {
		const doc = emptyBodyDoc();
		const caret: number[] = [];
		const field = createField({
			doc,
			quill: quill(),
			addr: cardBody(doc),
			container: mount(),
			placeholder: 'Write…',
			onCaretMove: (_a, p) => caret.push(p)
		});
		const before = pmToContent(viewOf(field).state.doc);

		field.setPlaceholder('Say something unforgettable…');

		expect(ghostOf(field)).toBe('Say something unforgettable…');
		// Chrome only: no content edit, and no caret reported at a moment the caret
		// did not move (the reason this is not a transaction).
		expect(contentEqual(normalize(pmToContent(viewOf(field).state.doc)), normalize(before))).toBe(
			true
		);
		expect(caret).toEqual([]);
		field.destroy();
	});

	it('clears and re-installs the ghost on a leaf mounted without one', () => {
		const doc = emptyBodyDoc();
		const field = emptyBody(doc);
		// Installed late; the plugin rides every leaf, so a ghost can arrive after
		// mount rather than needing one at creation to be possible at all.
		field.setPlaceholder('Write…');
		expect(ghostOf(field)).toBe('Write…');
		field.setPlaceholder(undefined);
		expect(ghostOf(field)).toBeNull();
		field.destroy();
	});

	it('hides the ghost once the leaf holds content, whatever the text', () => {
		const doc = emptyBodyDoc();
		const field = emptyBody(doc, 'Write…');
		const view = viewOf(field);
		view.dispatch(view.state.tr.insertText('typed', view.state.selection.head));
		expect(ghostOf(field)).toBeNull();
		// Moving it while non-empty stays invisible; emptiness gates the decoration.
		field.setPlaceholder('Another…');
		expect(ghostOf(field)).toBeNull();
		// And emptying the leaf brings it back: the gate is the content, not the mount.
		view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
		expect(ghostOf(field)).toBe('Another…');
		field.destroy();
	});
});

describe('an island edit on the op path', () => {
	const TABLE_MD = 'para\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ntail';

	/** A body holding a block island between two paragraphs, mounted as a leaf. */
	function tableBody(doc: Document): FieldController {
		doc.overwrite({}, md(TABLE_MD));
		return createField({ doc, quill: quill(), addr: {}, container: mount() });
	}

	/** The block island node's PM position in `view`'s current doc. */
	function islandPos(view: EditorView): number {
		let pos = -1;
		view.state.doc.descendants((node, at) => {
			if (node.type.name === 'island_block') pos = at;
			return pos < 0;
		});
		if (pos < 0) throw new Error('no island node in the leaf');
		return pos;
	}

	it('a props edit reaches the store, and the leaf keeps committing after it', () => {
		const doc = template();
		const field = tableBody(doc);
		const view = viewOf(field);
		const pos = islandPos(view);
		const node = view.state.doc.nodeAt(pos)!;
		const props = JSON.parse(JSON.stringify(node.attrs.props)) as TableProps;
		props.rows[0][0].text = 'EDITED';
		view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, props }));
		expect((doc.main.body.islands[0].props as TableProps).rows[0][0].text).toBe('EDITED');
		// The reconciler advanced with it, so the next keystroke still diffs from
		// what the store holds rather than from a pre-edit content.
		field.setCaret(1);
		view.dispatch(view.state.tr.insertText('X', view.state.selection.head));
		expect(doc.main.body.text).toBe('pXara\n￼\ntail');
		field.destroy();
	});

	it('deleting a block island and undoing it re-places the slot, keeping the anchors', () => {
		const doc = template();
		const field = tableBody(doc);
		const view = viewOf(field);
		field.insertAnchor('a1', 2);
		view.dispatch(view.state.tr.delete(islandPos(view), islandPos(view) + 1));
		expect(doc.main.body.islands).toHaveLength(0);
		undo(view.state, view.dispatch);
		// The undo lowers to `{ op: 'insert' }` rather than an install, so the
		// island comes back with its id and the field's anchor is still there.
		expect(doc.main.body.text).toBe(md(TABLE_MD).text);
		expect(doc.main.body.islands.map((i) => i.id)).toEqual(['isl-0']);
		expect(doc.main.body.marks.some((m) => m.type === 'anchor')).toBe(true);
		field.destroy();
	});
});
