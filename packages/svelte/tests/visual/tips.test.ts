// @vitest-environment jsdom
// The tips channel: the narrowing the derive reads, the markdown render
// the card paints, and the load-bearing one: that a write to the `editor` namespace
// carries its sibling keys through, so clearing `tips` leaves `title` standing.
//
// These exercise `patchEditorExt` itself, the function the editor calls, not a
// restatement of it: the invariant fails silently, so a test asserting a hand-copy
// would keep passing while the shipped write regressed.
import { describe, it, expect } from 'vitest';
import { MAIN_CARD_ADDR, type Document } from '@quillmark/wasm';
import { init } from '$lib/core';
import { tipsChannel, renderTip } from '$lib/visual/tips.js';
import { patchEditorExt } from '$lib/visual/ext.js';
import { loadFixtureTree } from '../helpers/fixtures.js';

const core = await init();
const quill = core.Quill.fromTree(loadFixtureTree());

/** The `editor` namespace as the Document holds it. */
function editorExt(doc: Document, addr = MAIN_CARD_ADDR): Record<string, unknown> {
	return ((doc.getExt(addr)?.editor ?? {}) as Record<string, unknown>) ?? {};
}
/** Render one tip and read back its HTML. */
function html(markdown: string): string {
	const host = document.createElement('div');
	host.appendChild(renderTip(markdown));
	return host.innerHTML;
}

describe('tipsChannel', () => {
	it('narrows an unusable channel to none', () => {
		// Consumer-authored and unvalidated: anything can arrive here, and every
		// unusable shape has to read as "no tips" rather than as an empty card.
		for (const raw of [undefined, null, 'a string', 42, {}, { 0: 'x' }])
			expect(tipsChannel(raw)).toEqual([]);
	});

	it('drops non-string and blank entries, keeping the rest', () => {
		expect(tipsChannel(['keep', '', '   ', 7, null, 'also'])).toEqual(['keep', 'also']);
	});
});

describe('renderTip', () => {
	it('renders the body mark vocabulary', () => {
		expect(html('Use **bold** here')).toBe('<p>Use <strong>bold</strong> here</p>');
		expect(html('_soft_ hint')).toBe('<p><em>soft</em> hint</p>');
		expect(html('Try `npm run dev`')).toBe('<p>Try <code>npm run dev</code></p>');
		expect(html('See [docs](https://example.com)')).toBe(
			'<p>See <a href="https://example.com">docs</a></p>'
		);
	});

	it('always yields one paragraph, whatever the tip', () => {
		// The inline schema is what pins this: a multi-line or block-shaped tip
		// cannot change the card's structure as the cursor advances.
		expect(html('line one\n\nline two')).toBe('<p>line one line two</p>');
		expect(html('- a\n- b')).toBe('<p>a b</p>');
		expect(html('')).toBe('<p></p>');
	});

	it('does not carry raw HTML through', () => {
		// markdown → Content → typed PM nodes → toDOM: the source never becomes
		// markup, so this is not the injection seam an `{@html}` would be.
		const out = html('<img src=x onerror="alert(1)">');
		expect(out).not.toContain('<img');
		expect(out).not.toContain('onerror');
	});

	it('draws a link the mark refuses as inert text', () => {
		// The card paints outside a `contenteditable`, so a rendered href is a plain
		// click away — and the tip is the document's own (`$ext.editor.tips`), which
		// makes the author of the tip the author of the document. An href is an
		// attribute value rather than markup, so the round-trip above does not reach
		// it; the mark's own gate does (`codec/schema.ts`).
		//
		// No anchor and no `href` is the whole of it: the refused value rides on the
		// span under a `data-` name so a copy keeps the mark (CODEC §Marks), which is a
		// value the DOM holds rather than a target anything follows.
		for (const scheme of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>']) {
			const el = document.createElement('div');
			el.innerHTML = html(`See [docs](${scheme})`);
			expect(el.querySelector('a')).toBe(null);
			expect(el.querySelector('[href]')).toBe(null);
			expect(el.textContent).toBe('See docs');
		}
	});

	it('draws the schemes a tip legitimately carries', () => {
		expect(html('Write [us](mailto:a@x.com)')).toBe('<p>Write <a href="mailto:a@x.com">us</a></p>');
		expect(html('Call [us](tel:+15550100)')).toBe('<p>Call <a href="tel:+15550100">us</a></p>');
	});
});

describe('patchEditorExt', () => {
	it('carries sibling keys through a patch', () => {
		// The rename path and the tips path share one namespace, so each write must
		// leave the other's key standing.
		const doc = quill.seedDocument();
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: ['a'] });
		patchEditorExt(doc, MAIN_CARD_ADDR, { title: 'Renamed' });
		expect(editorExt(doc)).toEqual({ tips: ['a'], title: 'Renamed' });
	});

	it('drops a key patched to undefined, keeping the rest — on main and on a card', () => {
		// The dismissal write (`VisualEditor.dismissTips`), and the hazard
		// a namespace-replacing write would cause: `tips` and `title` are sibling keys of one
		// namespace, so clearing the channel by removing the namespace destroys the
		// rename. Both addresses, since rename writes cards and tips write main.
		const doc = quill.seedDocument();
		const kind = Object.keys(quill.schema.card_kinds ?? {})[0];
		const card = quill.seedCard(kind, doc.seedOverlay(kind));
		if (!card) throw new Error(`the reference quill seeded no \`${kind}\` card`);
		doc.insertCard(card);

		for (const addr of [MAIN_CARD_ADDR, { card: 0 }]) {
			patchEditorExt(doc, addr, { title: 'Renamed', tips: ['a', 'b'] });
			patchEditorExt(doc, addr, { tips: undefined });
			expect(editorExt(doc, addr)).toEqual({ title: 'Renamed' });
			expect(tipsChannel(editorExt(doc, addr).tips)).toEqual([]);
		}
	});

	it('preserves sibling namespaces', () => {
		// Another consumer's `$ext` slot is not collateral.
		const doc = quill.seedDocument();
		doc.storeExt(MAIN_CARD_ADDR, { ...doc.getExt(MAIN_CARD_ADDR), other: { keep: 1 } });
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: ['x'] });
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: undefined });
		expect(doc.main.ext).toEqual({ other: { keep: 1 } });
	});

	it('takes the namespace, and `$ext` with it, once the last key drops', () => {
		const doc = quill.seedDocument();
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: ['x'] });
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: undefined });
		expect(doc.main.ext).toBeUndefined();
	});

	it('writes nothing when the patch drops keys the namespace does not have', () => {
		const doc = quill.seedDocument();
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: undefined });
		expect(doc.main.ext).toBeUndefined();
	});

	it('leaves a document the parser accepts back', () => {
		// A dismissed document parses back, which is what the removal in `ext.ts` is for.
		// What the emit makes of a namespace is the boundary's, so nothing here reads text.
		const doc = quill.seedDocument();
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: ['a tip'] });
		patchEditorExt(doc, MAIN_CARD_ADDR, { tips: undefined });
		expect(() => core.Document.fromMarkdown(doc.toMarkdown())).not.toThrow();
	});
});
