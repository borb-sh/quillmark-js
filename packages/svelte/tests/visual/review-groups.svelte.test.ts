// @vitest-environment jsdom
// A review item's note and group: the note on the answer card over its item, the group a set
// the host steps through and answers alone.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Document } from '@quillmark/wasm';
import type { ReviewDrawn, ReviewEvent, ReviewItem } from '$lib/visual';
import { proposalsBetween } from '$lib/visual/proposals';
import { quill, example } from '../helpers/fixtures.js';
import { mountEditor, settle, unmountAll } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

function mount(items: (doc: Document) => ReviewItem[]) {
	const doc = example();
	const events: ReviewEvent[] = [];
	const drawn: ReviewDrawn[] = [];
	const mounted = mountEditor(quill(), doc, {
		review: items(doc),
		onReview: (e) => events.push(e),
		onReviewDrawn: (d) => drawn.push(d)
	});
	return { ...mounted, doc, events, drawn };
}

/** Three blocks of the body rewritten, the first and third in one group. */
function grouped(doc: Document): ReviewItem[] {
	const blocks = doc.blocks({});
	const field = doc.pathFor('body');
	return [0, 1, 2].map((n) => ({
		id: `b${n}`,
		field,
		replace: [blocks[n].id],
		after: `Line ${n}, proposed.`,
		group: n === 1 ? 'tone' : 'spelling',
		note: `Why line ${n} changes.`
	}));
}

describe('a note', () => {
	it('is shown on the answer card over its item, and is the card’s description', async () => {
		const r = mount(grouped);
		await settle();
		const card = r.target.querySelector<HTMLElement>('.qm-review-card')!;
		const note = card.querySelector<HTMLElement>('.qm-review-card-reason')!;
		expect(note.textContent).toBe('Why line 0 changes.');
		expect(card.getAttribute('aria-describedby')).toBe(note.id);
		await r.editor.stepReview(1, { focus: false });
		flushSync();
		expect(card.querySelector('.qm-review-card-reason')?.textContent).toBe('Why line 1 changes.');
	});

	it('is not drawn for an item without one', async () => {
		const r = mount((doc) => grouped(doc).map(({ note: _, ...item }) => item as ReviewItem));
		await settle();
		const card = r.target.querySelector<HTMLElement>('.qm-review-card')!;
		expect(card.querySelector('.qm-review-card-reason')).toBeNull();
		expect(card.hasAttribute('aria-describedby')).toBe(false);
	});
});

describe('a group', () => {
	it('is stepped through alone, round from the end', async () => {
		const r = mount(grouped);
		await settle();
		const { open } = r.drawn.at(-1)!;
		const spelling = open.filter((id) => id !== 'b1');
		const walked: (string | undefined)[] = [];
		for (let i = 0; i < spelling.length; i++)
			walked.push(await r.editor.stepReview(1, { focus: false, group: 'spelling' }));
		expect(walked).toEqual([...spelling.slice(1), spelling[0]]);
		expect(await r.editor.stepReview(1, { focus: false, group: 'none' })).toBeUndefined();
	});

	it('is answered alone, leaving the other groups open', async () => {
		const r = mount(grouped);
		await settle();
		const answered = r.editor.answerReview({ group: 'spelling' }, 'accept');
		flushSync();
		expect([...answered].sort()).toEqual(['b0', 'b2']);
		await settle();
		expect(r.drawn.at(-1)!.open).toEqual(['b1']);
	});
});

describe('proposalsBetween', () => {
	it('labels each item it makes as the host says', () => {
		const base = example();
		const answer = base.clone();
		const [first, second] = answer.blocks({});
		answer.applyBlocks({}, [
			{ op: 'replace', id: first.id, markdown: 'Rewritten.' },
			{ op: 'replace', id: second.id, markdown: 'Also rewritten.' }
		]);
		let n = 0;
		const { items } = proposalsBetween(quill(), base, answer, {
			mint: () => `p${n++}`,
			label: (item) =>
				'replace' in item && item.replace[0] === first.id
					? { note: 'Shorter.', group: 'tone' }
					: undefined
		});
		expect(items).toMatchObject([{ id: 'p0', note: 'Shorter.', group: 'tone' }, { id: 'p1' }]);
		expect(items[1]).not.toHaveProperty('note');
		expect(items[1]).not.toHaveProperty('group');
	});
});
