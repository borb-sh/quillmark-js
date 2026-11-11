// @vitest-environment jsdom
// Undoing review answers: ⌘Z from anywhere in the editor takes back the answers since the
// reader's last edit, newest first, each item reopened with what was written for it.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import type { ReviewEvent, ReviewItem } from '$lib/visual';
import { quill, example } from '../helpers/fixtures.js';
import {
	answerOn,
	leaf,
	mountEditor,
	openField,
	press,
	settle,
	typeLeaf,
	unmountAll,
	type EditorRef,
	type Mounted
} from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const main = quill().schema.main;
const mod = { ctrlKey: true };

interface Journaled extends Mounted<EditorRef> {
	doc: Document;
	events: ReviewEvent[];
}

/** An editor over `items`; a `host` edits its list per answer, an answered item off it and a
 *  reopened one back on, which the editor bears though the set-once contract does not ask it. */
function journaled(items: (doc: Document) => ReviewItem[], host = false): Journaled {
	const doc = example();
	const events: ReviewEvent[] = [];
	const all = items(doc);
	const mounted = mountEditor(quill(), doc, {
		review: all,
		onReview: (e) => {
			events.push(e);
			if (!host) return;
			const listed = mounted.props.review ?? [];
			mounted.props.review =
				e.action === 'reopen'
					? all.filter((it) => it.id === e.id || listed.includes(it))
					: listed.filter((it) => it.id !== e.id);
		}
	});
	return { ...mounted, doc, events };
}

/** The first block of a rich text field, or of the body, as the place a proposal replaces. */
function first(doc: Document, field?: string): { field: string; replace: string[] } {
	const addr = field ? { field } : {};
	return { field: doc.pathFor(addr), replace: [doc.blocks(addr)[0].id] };
}

const abstractText = (doc: Document): string =>
	(doc.getStored('abstract') as { text: string }).text;

/** Accept item `id` from the answer card, the change made current by a press on it. */
const accept = (target: HTMLElement, id: string): void => answerOn(target, id, 'accept');

const mixed = (doc: Document): ReviewItem[] => [
	{ id: 'A', ...first(doc), after: 'The body, proposed.' },
	{ id: 'F', field: doc.pathFor('columns'), after: 2 },
	{ id: 'B', ...first(doc, 'abstract'), after: 'The abstract, proposed.' }
];

describe('the answer journal', () => {
	it('takes back two field proposals one ⌘Z each, and reopens both', async () => {
		const r = journaled((doc) => [
			{ id: 'cols', field: doc.pathFor('columns'), after: 2 },
			{ id: 'sub', field: doc.pathFor('subtitle'), after: 'A new subtitle' }
		]);
		const before = r.doc.getStored('subtitle');
		openField(r.target, main, 'columns');
		accept(r.target, 'cols');
		accept(r.target, 'sub');
		expect(r.doc.getStored('columns')).toBe(2);
		const root = r.target.querySelector<HTMLElement>('.qm-editor')!;
		press(root, 'z', mod);
		press(root, 'z', mod);
		await settle();
		expect(r.doc.getStored('subtitle')).toEqual(before);
		expect(r.doc.getStored('columns')).toBeUndefined();
		expect(r.events.slice(2)).toEqual([
			{ id: 'sub', action: 'reopen' },
			{ id: 'cols', action: 'reopen' }
		]);
		expect(r.target.querySelector('.qm-number-review [data-qm-review~="cols"]')).not.toBeNull();
		expect(r.target.querySelector('.qm-review-ins[data-qm-review~="sub"]')).not.toBeNull();
	});

	it('takes back answers across leaves and fields newest first, from inside the first leaf', async () => {
		const r = journaled(mixed);
		const body = r.doc.main.body.text;
		const abstract = abstractText(r.doc);
		openField(r.target, main, 'columns');
		openField(r.target, main, 'abstract');
		accept(r.target, 'A');
		accept(r.target, 'F');
		accept(r.target, 'B');
		const bodyLeaf = [...r.target.querySelectorAll<HTMLElement>('.ProseMirror')].find((el) =>
			el.textContent?.includes('The body, proposed.')
		)!;
		bodyLeaf.focus();
		press(bodyLeaf, 'z', mod);
		expect(r.events.at(-1)).toEqual({ id: 'B', action: 'reopen' });
		expect(abstractText(r.doc)).toBe(abstract);
		press(bodyLeaf, 'z', mod);
		expect(r.events.at(-1)).toEqual({ id: 'F', action: 'reopen' });
		expect(r.doc.getStored('columns')).toBeUndefined();
		press(bodyLeaf, 'z', mod);
		expect(r.events.at(-1)).toEqual({ id: 'A', action: 'reopen' });
		expect(r.doc.main.body.text).toBe(body);
		await settle();
	});

	it('is emptied by the reader’s next edit, whose own undo is then the key’s', async () => {
		const r = journaled(mixed);
		openField(r.target, main, 'abstract');
		accept(r.target, 'A');
		const accepted = r.doc.main.body.text;
		const abstract = openField(r.target, main, 'abstract');
		const before = abstractText(r.doc);
		typeLeaf(abstract, 'Typed over.');
		expect(abstractText(r.doc)).toBe('Typed over.');
		press(leaf(abstract), 'z', mod);
		await settle();
		expect(abstractText(r.doc)).toBe(before);
		expect(r.doc.main.body.text).toBe(accepted);
		expect(r.events.filter((e) => e.action === 'reopen')).toEqual([]);
	});

	it('reopens a dismissal the host took off its list', async () => {
		const r = journaled(mixed, true);
		await settle();
		answerOn(r.target, 'A', 'dismiss');
		expect(r.props.review!.map((it) => it.id)).not.toContain('A');
		press(r.target.querySelector<HTMLElement>('.qm-editor')!, 'z', mod);
		await settle();
		expect(r.events).toEqual([
			{ id: 'A', action: 'dismiss' },
			{ id: 'A', action: 'reopen' }
		]);
		expect(r.target.querySelector('.ProseMirror [data-qm-review="A"]')).not.toBeNull();
	});

	it('takes back a whole batch with one ⌘Z, raising no toast', async () => {
		const r = journaled(mixed);
		const body = r.doc.main.body.text;
		await settle();
		expect([...r.editor.answerReview('all', 'accept')].sort()).toEqual(['A', 'B', 'F']);
		flushSync();
		expect(r.target.querySelector('.qm-toast')).toBeNull();
		press(r.target.querySelector<HTMLElement>('.qm-editor')!, 'z', mod);
		await settle();
		expect(
			r.events
				.filter((e) => e.action === 'reopen')
				.map((e) => e.id)
				.sort()
		).toEqual(['A', 'B', 'F']);
		expect(r.doc.main.body.text).toBe(body);
		expect(r.doc.getStored('columns')).toBeUndefined();
	});
});
