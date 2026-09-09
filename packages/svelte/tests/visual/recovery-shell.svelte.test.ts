// @vitest-environment jsdom
// The recovery shell, drawn. `Engine.open` refuses a document holding a card whose kind
// the schema does not declare, so the shell is the only surface that card is reachable
// from, and the retype it offers is what lets a session open over the document.
//
// A `CardInput` literal is the door in: schema-agnostic where the Quill-bound writer
// refuses an undeclared kind, which is what the playground's `?foreign` seeds.
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { Engine, init, type Document, type Quill } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { humanize } from '$lib/visual/structure';
import { quill } from '../helpers/fixtures.js';

const core = await init();

// jsdom implements neither; the first is the card operations' scroll hop and the flip a
// removal runs the survivors through.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return target;
}

/** A seeded document with one card the schema cannot project, last in the stack. */
function withForeignCard(q: Quill): Document {
	const doc = q.seedDocument();
	doc.insertCard({
		kind: 'legacy_kind',
		payloadItems: [{ type: 'field', key: 'label', value: 'Held' }],
		body: 'Trapped legacy body.'
	});
	return doc;
}

const shells = (target: HTMLElement) => [
	...target.querySelectorAll<HTMLElement>('.qm-card-recovery')
];

describe('the recovery shell', () => {
	it('draws for the card whose kind has no schema, and for no other', () => {
		const q = quill();
		const target = mountEditor(q, withForeignCard(q));

		expect(shells(target)).toHaveLength(1);
		const card = target.querySelector<HTMLElement>('.qm-card.qm-unschemable')!;
		expect(card).not.toBeNull();
		// Humanized in the title, verbatim in the note.
		expect(card.querySelector('.qm-card-title-static')?.textContent).toBe(humanize('legacy_kind'));
		expect(card.querySelector('.qm-recovery-note')?.textContent).toContain('legacy_kind');
		// The two exits, both drawn: retype offers every kind the quill declares, and delete
		// sits on the header a declared card carries.
		const offered = [...card.querySelectorAll<HTMLOptionElement>('.qm-recovery-retype option')]
			.map((o) => o.value)
			.filter(Boolean);
		expect(offered).toEqual(Object.keys(q.schema.card_kinds!));
		expect(card.querySelector('.qm-card-delete')).not.toBeNull();
	});

	it('retypes through the shell, keeping the payload, and the document opens after', async () => {
		const q = quill();
		const doc = withForeignCard(q);
		const engine = new Engine();

		// The refusal that puts the card out of every other surface's reach.
		await expect(engine.open(q, doc)).rejects.toThrow(/unknown card kind `legacy_kind`/);

		const target = mountEditor(q, doc);
		const select = target.querySelector<HTMLSelectElement>('.qm-recovery-retype select')!;
		select.value = 'note';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();

		// A retype swaps the kind alone: the fields and the body the card arrived with
		// are still authored.
		expect(shells(target)).toHaveLength(0);
		const markdown = doc.toMarkdown();
		expect(markdown).toContain('Trapped legacy body.');
		expect(markdown).toContain('label: Held');

		const session = await engine.open(q, doc);
		expect(session.pageCount).toBeGreaterThan(0);
		session.free();
		doc.free();
	});

	it('deletes the card the schema cannot take, the exit that needs no other kind', async () => {
		const q = quill();
		const doc = withForeignCard(q);
		const engine = new Engine();
		const target = mountEditor(q, doc);

		target.querySelector<HTMLButtonElement>('.qm-card.qm-unschemable .qm-card-delete')!.click();
		flushSync();

		expect(shells(target)).toHaveLength(0);
		expect(doc.toMarkdown()).not.toContain('legacy_kind');
		const session = await engine.open(q, doc);
		expect(session.pageCount).toBeGreaterThan(0);
		session.free();
		doc.free();
	});
});
