// @vitest-environment jsdom
// A list proposal at the depth its writer wrote it: an answer's blocks carry the store's spelling
// of a nested item, indented two spaces per list around its own, and the leaf reads that back as
// depth, so what it draws and what Accept writes is the answer's list.
import { describe, it, expect, afterEach } from 'vitest';
import { createField, type FieldController, type TextReview } from '$lib/core/codec';
import { proposalsBetween } from '$lib/visual/proposals';
import { example, md, mount, quill } from '../codec/_util.js';

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const open: FieldController[] = [];
afterEach(() => {
	for (const field of open.splice(0)) field.destroy();
});

/** A leaf over `from` holding the review of an answer that revised its body to `to`. */
function reviewing(from: string, to: string) {
	const doc = example();
	doc.replace({}, md(from));
	const answer = doc.clone();
	quill().writer(answer).revise({}, to);
	const el = mount();
	const field = createField({ doc, quill: quill(), addr: {}, container: el });
	open.push(field);
	const items = proposalsBetween(quill(), doc, answer).items as TextReview[];
	field.setReview(items);
	const acceptAll = (): void => {
		for (const item of items) expect(field.answerReview(item.id, 'accept')).toBe(true);
	};
	return { doc, answer, el, acceptAll };
}

describe('a list proposal', () => {
	it.each([
		['under an item with no children', '- One\n- Two', '- One\n  - Sub\n- Two'],
		['under an item two lists deep', '- One\n  - Deep', '- One\n  - Deep\n    - Deeper'],
		['ahead of the children an item has', '- One\n  - A\n- Two', '- One\n  - New\n  - A\n- Two'],
		['as a run under an item', '- One\n- Two', '- One\n  - Sub\n  - Sub2\n- Two'],
		['with a child of its own', '- One\n- Two', '- One\n  - Sub\n    - SubSub\n- Two'],
		['under a numbered item', '1. One\n2. Two', '1. One\n   1. Sub\n2. Two'],
		['under an item in a quote', '> - One\n> - Two', '> - One\n>   - Sub\n> - Two'],
		['beside a nested item', '- One\n  - A\n- Two', '- One\n  - A\n  - B\n- Two'],
		['back out of a nested list', '- One\n  - A\n- Two', '- One\n  - A\n- New\n- Two'],
		[
			'rewriting an item two lists deep',
			'- One\n  - Deep\n    - Deeper',
			'- One\n  - Deep\n    - Deeper still'
		]
	])('lands %s at the depth it was written', (_, from, to) => {
		const { doc, answer, acceptAll } = reviewing(from, to);
		acceptAll();
		expect(doc.toMarkdown({})).toBe(answer.toMarkdown({}));
	});

	it('draws an item it nests inside the item it nests under', () => {
		const { el } = reviewing('- One\n- Two', '- One\n  - Sub\n- Two');
		const added = el.querySelector('.qm-review-add')!;
		expect(added.tagName).toBe('UL');
		expect(added.closest('li')!.firstElementChild!.textContent).toBe('One');
	});
});
