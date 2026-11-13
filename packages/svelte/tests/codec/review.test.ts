// @vitest-environment jsdom
// The review layer of a prose leaf: a proposal draws over the blocks it names, in the leaf's own
// flow, and writes nothing while it stands; it reads as an edit of its paragraph, and taking it
// writes what was drawn as plain text. The leaf draws no answers of its own: the editor's answer
// card answers through `answerReview`.
import { describe, it, expect, afterEach } from 'vitest';
import { redo, undo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { createField, REVIEW_KEYS } from '$lib/core/codec';
import type {
	BlockPlace,
	FieldController,
	ReviewAction,
	ReviewReport,
	ReviewVia,
	TextReview
} from '$lib/core/codec';
import type { Document } from '@quillmark/wasm';
import { core, example, md, mount, press, quill, viewOf } from './_util.js';

Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

interface Leaf {
	doc: Document;
	field: FieldController;
	el: HTMLElement;
	acts: [string, ReviewAction][];
	points: [string | undefined, ReviewVia][];
	drawn: string[][];
	reports: ReviewReport[];
}

const open: FieldController[] = [];
afterEach(() => {
	for (const field of open.splice(0)) field.destroy();
});

function leafOver(markdown: string): Leaf {
	const doc = example();
	doc.replace({}, md(markdown));
	const el = mount();
	const acts: Leaf['acts'] = [];
	const points: Leaf['points'] = [];
	const drawn: string[][] = [];
	const reports: ReviewReport[] = [];
	const field = createField({
		doc,
		quill: quill(),
		addr: {},
		container: el,
		onReview: (id, action) => acts.push([id, action]),
		onReviewPoint: (id, via) => points.push([id, via]),
		onReviewDrawn: (report) => {
			drawn.push([...report.ids]);
			reports.push(report);
		}
	});
	open.push(field);
	return { doc, field, el, acts, points, drawn, reports };
}

/** The offset of the first `text` in the body. */
function offsetOf(leaf: Leaf, text: string): number {
	const at = leaf.doc.main.body.text.indexOf(text);
	if (at < 0) throw new Error(`no ${text} in the body`);
	return at;
}

/** The body's blocks from the one holding the first `from` to the one holding the first `to`. */
function over(leaf: Leaf, from: string, to = from): { replace: string[] } {
	const start = offsetOf(leaf, from);
	const end = offsetOf(leaf, to) + to.length;
	const replace = leaf.doc
		.blocks({})
		.filter((b) => b.start < end && b.end > start)
		.map((b) => b.id);
	return { replace };
}

/** Beside the block holding the first `text`: before it where `text` opens the body, else
 *  after it. */
function beside(leaf: Leaf, text: string): { insert: BlockPlace } {
	const at = offsetOf(leaf, text);
	const blocks = leaf.doc.blocks({});
	const block = blocks.find((b) => b.start <= at && at <= b.end)!;
	return { insert: at === 0 ? { before: block.id } : { after: block.id } };
}

/** Put the caret a character into the first `text` of the body, in a focused leaf. */
function caretIn(leaf: Leaf, text: string): void {
	const view = viewOf(leaf.field);
	const at = 2 + leaf.doc.main.body.text.indexOf(text);
	view.focus();
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
}

/** Answer the first item the leaf draws, as the editor's answer card does. */
function answerFirst(leaf: Leaf, action: 'accept' | 'dismiss'): void {
	const id = leaf.el.querySelector('[data-qm-review]')?.getAttribute('data-qm-review');
	expect(id).toBeTruthy();
	expect(leaf.field.answerReview(id!, action)).toBe(true);
}

/** What the reader would read were every proposal taken: the leaf's text less what is struck. */
function proposedText(el: HTMLElement): string {
	const copy = el.querySelector('.ProseMirror')!.cloneNode(true) as HTMLElement;
	for (const gone of copy.querySelectorAll('.qm-review-out, del')) gone.remove();
	for (let emptied; (emptied = copy.querySelector('li:empty, ul:empty, ol:empty'));)
		emptied.remove();
	return [...copy.children].map((block) => block.textContent).join('\n');
}

/** The leaf's blocks as the reader reads them. */
const shownText = (el: HTMLElement): string =>
	[...el.querySelector('.ProseMirror')!.children].map((block) => block.textContent).join('\n');

const texts = (el: HTMLElement, selector: string): string[] =>
	[...el.querySelectorAll(selector)].map((node) => node.textContent ?? '');

describe('a proposal', () => {
	it('reads its paragraph as rewritten: the words that go struck, the words that come added', () => {
		const leaf = leafOver('The quick brown fox jumps over the lazy dog.');
		const after = 'The quick red fox leaps over the lazy dog.';
		const before = leaf.doc.toMarkdown();
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'brown'), after }]);
		expect(texts(leaf.el, 'del.qm-review-del')).toEqual(['brown', 'jumps']);
		expect(texts(leaf.el, 'ins.qm-review-ins')).toEqual(['red', 'leaps']);
		expect(proposedText(leaf.el)).toBe(after);
		expect(leaf.doc.toMarkdown()).toBe(before);
	});

	it('covers the whole of every paragraph it names', () => {
		const leaf = leafOver('First paragraph here.\n\nSecond paragraph here.\n\nThird stays.');
		leaf.field.setReview([
			{
				id: 'r1',

				...over(leaf, 'here', 'Second'),
				after: 'First paragraph rewritten.\n\nSecond paragraph rewritten.'
			}
		]);
		expect(leaf.el.querySelectorAll('.qm-review-held')).toHaveLength(2);
		expect(proposedText(leaf.el)).toBe(
			'First paragraph rewritten.\nSecond paragraph rewritten.\nThird stays.'
		);
	});

	it('keeps the formatting the proposal carries on the words it adds', () => {
		const leaf = leafOver('Submit the report by Friday.');
		leaf.field.setReview([
			{
				id: 'r1',

				...over(leaf, 'report'),
				after: 'Submit the **signed** report by Friday.'
			}
		]);
		expect(leaf.el.querySelector('ins.qm-review-ins strong')?.textContent).toBe('signed');
	});

	it('strikes the stretch whose formatting alone would change', () => {
		const leaf = leafOver('Submit the report by Friday.');
		leaf.field.setReview([
			{
				id: 'r1',

				...over(leaf, 'report'),
				after: 'Submit the **report** by Friday.'
			}
		]);
		expect(texts(leaf.el, 'del.qm-review-del')).toEqual(['report']);
		expect(leaf.el.querySelector('ins.qm-review-ins strong')?.textContent).toBe('report');
	});

	it('sets the paragraphs it adds in flow under the one it rewrites', () => {
		const leaf = leafOver('Opening line.\n\nClosing line.');
		leaf.field.setReview([
			{
				id: 'r1',

				...over(leaf, 'Opening'),
				after: 'Opening line.\n\nA new middle.'
			}
		]);
		const blocks = [...leaf.el.querySelector('.ProseMirror')!.children];
		expect(blocks.map((b) => b.classList.contains('qm-review-add'))).toEqual([false, true, false]);
		expect(proposedText(leaf.el)).toBe('Opening line.\nA new middle.\nClosing line.');
	});

	it('strikes a paragraph it would remove', () => {
		const leaf = leafOver('Keep this.\n\nDrop this.');
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'Drop'), after: '' }]);
		expect(texts(leaf.el, 'del.qm-review-del').join('')).toBe('Drop this.');
		expect(leaf.el.querySelector('.qm-review-out')?.textContent).toContain('Drop this.');
	});

	it('proposes new paragraphs after the one it names', () => {
		const leaf = leafOver('Opening line.\n\nClosing line.');
		leaf.field.setReview([{ id: 'r1', ...beside(leaf, 'line'), after: 'Inserted.' }]);
		expect(proposedText(leaf.el)).toBe('Opening line.\nInserted.\nClosing line.');
		expect(leaf.el.querySelector('del')).toBeNull();
	});

	it('proposes new paragraphs before the first', () => {
		const leaf = leafOver('Opening line.');
		leaf.field.setReview([{ id: 'r1', ...beside(leaf, 'Opening'), after: 'A preamble.' }]);
		expect(proposedText(leaf.el)).toBe('A preamble.\nOpening line.');
	});

	it('writes into the empty paragraph a leaf holds alone', () => {
		const leaf = leafOver('');
		leaf.field.setReview([{ id: 'r1', insert: 'end', after: 'A first line.' }]);
		expect(leaf.el.querySelector('.ProseMirror')!.children).toHaveLength(1);
		expect(texts(leaf.el, 'ins.qm-review-ins')).toEqual(['A first line.']);
	});

	it('adds an item to the list its paragraph is in, as an item of that list', () => {
		const leaf = leafOver('- first item\n- second item');
		leaf.field.setReview([
			{ id: 'r1', ...over(leaf, 'second'), after: '- second item\n- third item' }
		]);
		const list = leaf.el.querySelector('ul')!;
		expect(leaf.el.querySelectorAll('ul')).toHaveLength(1);
		expect([...list.children].map((li) => li.tagName)).toEqual(['LI', 'LI', 'LI']);
		expect(list.lastElementChild!.classList.contains('qm-review-add')).toBe(true);
		expect(list.lastElementChild!.textContent).toContain('third item');
	});

	it('replaces a paragraph it would turn into another kind of block, whole', () => {
		const leaf = leafOver('A plain line.');
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'plain'), after: '# A heading' }]);
		expect(texts(leaf.el, 'del.qm-review-del').join('')).toBe('A plain line.');
		expect(leaf.el.querySelector('h1.qm-review-add')?.textContent).toContain('A heading');
	});

	it('gives a paragraph to the first proposal that names it', () => {
		const leaf = leafOver('One paragraph only.');
		leaf.field.setReview([
			{ id: 'r1', ...over(leaf, 'One'), after: 'One paragraph, first.' },
			{ id: 'r2', ...over(leaf, 'only'), after: 'One paragraph, second.' }
		]);
		expect(leaf.reports.at(-1)).toEqual({
			ids: ['r1'],
			outdated: [],
			undrawn: [{ id: 'r2', reason: 'taken' }]
		});
	});

	it('gives a paragraph one proposal that rewrites it and one that adds after it', () => {
		const leaf = leafOver('Opening line.\n\nClosing line.');
		leaf.field.setReview([
			{ id: 'r1', ...over(leaf, 'Opening'), after: 'Opening sentence.' },
			{ id: 'r2', ...beside(leaf, 'line'), after: 'Added first.' },
			{ id: 'r3', ...beside(leaf, 'line'), after: 'Added second.' }
		]);
		expect(leaf.reports.at(-1)).toEqual({
			ids: ['r1', 'r2'],
			outdated: [],
			undrawn: [{ id: 'r3', reason: 'taken' }]
		});
	});

	it('draws the words a proposal keeps and formats anew, beside the words it rewrites', () => {
		const leaf = leafOver(
			'Approve the plan in full and direct the maintenance officer to submit monthly reports.'
		);
		leaf.field.setReview([
			{
				id: 'r1',

				...over(leaf, 'plan'),
				after:
					'Approve the plan in full. Direct the maintenance officer to submit **monthly** reports.'
			}
		]);
		expect(texts(leaf.el, 'del.qm-review-del')).toContain('monthly');
		expect(leaf.el.querySelector('ins.qm-review-ins strong')?.textContent).toBe('monthly');
		answerFirst(leaf, 'accept');
		expect(core.exportMarkdown(leaf.doc.main.body)).toBe(
			core.exportMarkdown(
				md(
					'Approve the plan in full. Direct the maintenance officer to submit **monthly** reports.'
				)
			)
		);
	});

	it('takes away the formatting of a word it keeps, beside the words it rewrites', () => {
		const leaf = leafOver('Submit the **signed** report by Friday.');
		leaf.field.setReview([
			{
				id: 'r1',

				...over(leaf, 'report'),
				after: 'Submit the signed report by Monday.'
			}
		]);
		expect(texts(leaf.el, 'del.qm-review-del')).toEqual(['signed', 'Friday']);
		answerFirst(leaf, 'accept');
		expect(core.exportMarkdown(leaf.doc.main.body)).toBe(
			core.exportMarkdown(md('Submit the signed report by Monday.'))
		);
	});

	it('draws nothing for a proposal that would write nothing, and says so', () => {
		const leaf = leafOver('The quick brown fox.');
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'quick'), after: 'The quick brown fox.' }]);
		expect(leaf.el.querySelector('[data-qm-review], .qm-review-held')).toBeNull();
		expect(leaf.reports.at(-1)?.undrawn).toEqual([{ id: 'r1', reason: 'applied' }]);
	});
});

describe('a proposal over a paragraph the reader goes on writing', () => {
	/** `The quick brown fox.` proposed as `The quick red fox.`, then `text` typed over `[from, to)`
	 *  of the first `at` in the body. */
	function typed(text: string, at: string, from = 0, to = from): Leaf {
		const leaf = leafOver('The quick brown fox.');
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'quick'), after: 'The quick red fox.' }]);
		const view = viewOf(leaf.field);
		const pos = 1 + leaf.doc.main.body.text.indexOf(at);
		view.dispatch(view.state.tr.insertText(text, pos + from, pos + to));
		return leaf;
	}
	const marks = (leaf: Leaf) => [
		texts(leaf.el, 'del.qm-review-del'),
		texts(leaf.el, 'ins.qm-review-ins')
	];
	const taken = (leaf: Leaf): string => {
		const drawn = proposedText(leaf.el);
		answerFirst(leaf, 'accept');
		expect(shownText(leaf.el)).toBe(drawn);
		return leaf.doc.main.body.text;
	};

	it.each([
		['elsewhere in it', 'Truly, ', 'The', 'Truly, The quick red fox.'],
		['against the head of a word it rewrites', 'very ', 'brown', 'The quick very red fox.'],
		['against the tail of one', ' and grey', ' fox', 'The quick red and grey fox.']
	])('leaves what was typed %s unstruck, and keeps it when taken', (_where, text, at, written) => {
		const leaf = typed(text, at);
		expect(marks(leaf)).toEqual([['brown'], ['red']]);
		expect(taken(leaf)).toBe(written);
	});

	it('strikes a word it rewrites as the reader has since rewritten it, and says it is outdated', () => {
		const leaf = typed('grey', 'brown', 0, 'brown'.length);
		expect(marks(leaf)).toEqual([['grey'], ['red']]);
		expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
		expect(taken(leaf)).toBe('The quick red fox.');
	});

	it('draws nothing where the reader wrote what it proposes', () => {
		const leaf = typed('red', 'brown', 0, 'brown'.length);
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		expect(leaf.reports.at(-1)?.undrawn).toEqual([{ id: 'r1', reason: 'applied' }]);
	});

	it('gives the whole paragraph to the whole proposal where the reader rewrote past its words', () => {
		const leaf = leafOver('Keep this. Second is proposed.');
		leaf.field.setReview([
			{ id: 'r1', ...over(leaf, 'Keep'), after: 'Keep this. Second, rewritten.' }
		]);
		const view = viewOf(leaf.field);
		const at = 1 + leaf.doc.main.body.text.indexOf('Second');
		view.dispatch(
			view.state.tr.insertText('My own sentence.', at, at + 'Second is proposed.'.length)
		);
		// The anchor's own range parts the struck run where it ends.
		expect(marks(leaf).map((run) => run.join(''))).toEqual([
			'Keep this. My own sentence.',
			'Keep this. Second, rewritten.'
		]);
		expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
		expect(taken(leaf)).toBe('Keep this. Second, rewritten.');
	});

	it('reads the paragraph anew under a proposal that arrives with another text', () => {
		const leaf = typed('Truly, ', 'The');
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'quick'), after: 'The quick red fox.' }]);
		expect(marks(leaf)).toEqual([['brown'], ['red']]);
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'quick'), after: 'The slow brown fox.' }]);
		expect(marks(leaf)).toEqual([['Truly, ', 'quick'], ['slow']]);
	});
});

describe('a proposal by blocks', () => {
	/** The ids of the body's blocks, in order. */
	const ids = (leaf: Leaf): string[] => leaf.doc.blocks({}).map((b) => b.id);
	const marks = (leaf: Leaf) => [
		texts(leaf.el, 'del.qm-review-del'),
		texts(leaf.el, 'ins.qm-review-ins')
	];
	const accept = (leaf: Leaf): string => {
		const drawn = proposedText(leaf.el);
		answerFirst(leaf, 'accept');
		expect(shownText(leaf.el)).toBe(drawn);
		return leaf.doc.main.body.text;
	};
	/** Type `text` over `[from, to)` of the first `at` in the body. */
	const type = (leaf: Leaf, text: string, at: string, from = 0, to = from): void => {
		const view = viewOf(leaf.field);
		const pos = 1 + leaf.doc.main.body.text.indexOf(at);
		view.dispatch(view.state.tr.insertText(text, pos + from, pos + to));
	};

	it('rewrites the block it names, and no other', () => {
		const leaf = leafOver('The quick brown fox.\n\nThe quick brown dog.');
		const [, dog] = ids(leaf);
		leaf.field.setReview([{ id: 'r1', replace: [dog], after: 'The quick red dog.' }]);
		expect(marks(leaf)).toEqual([['brown'], ['red']]);
		expect(accept(leaf)).toBe('The quick brown fox.\nThe quick red dog.');
	});

	it('removes the blocks it names where it proposes nothing', () => {
		const leaf = leafOver('Keep this.\n\nDrop this.\n\nAnd this.');
		const [, drop, and] = ids(leaf);
		leaf.field.setReview([{ id: 'r1', replace: [drop, and], after: '' }]);
		expect(accept(leaf)).toBe('Keep this.');
	});

	it.each([
		['after a block', (b: string[]) => ({ after: b[0] }), 'One.\nAdded.\nTwo.'],
		['before a block', (b: string[]) => ({ before: b[1] }), 'One.\nAdded.\nTwo.'],
		['before the first', (b: string[]) => ({ before: b[0] }), 'Added.\nOne.\nTwo.'],
		['at the end', () => 'end' as const, 'One.\nTwo.\nAdded.']
	])('adds %s', (_where, insert, written) => {
		const leaf = leafOver('One.\n\nTwo.');
		leaf.field.setReview([{ id: 'r1', insert: insert(ids(leaf)), after: 'Added.' }]);
		expect(accept(leaf)).toBe(written);
	});

	it('draws nothing where no block it names stands, and says why', () => {
		const leaf = leafOver('One.');
		leaf.field.setReview([
			{ id: 'r1', replace: ['gone'], after: 'Two.' },
			{ id: 'r2', insert: { after: 'gone' }, after: 'Two.' }
		]);
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		expect(leaf.reports.at(-1)?.undrawn).toEqual([
			{ id: 'r1', reason: 'block' },
			{ id: 'r2', reason: 'block' }
		]);
	});

	it('is outdated where a block it names is gone', () => {
		const leaf = leafOver('One here.\n\nTwo here.');
		const [one] = ids(leaf);
		leaf.field.setReview([{ id: 'r1', replace: [one, 'gone'], after: 'One there.\n\nTwo there.' }]);
		expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
	});

	describe('with what its writer read', () => {
		/** `before` read by the writer, the body standing as `live` by the time it arrives. */
		function arrive(live: string, before: string, after: string): Leaf {
			const leaf = leafOver(live);
			const [first] = ids(leaf);
			leaf.field.setReview([{ id: 'r1', replace: [first], before, after }]);
			return leaf;
		}

		it('leaves what the reader wrote meanwhile unstruck, and keeps it when taken', () => {
			const leaf = arrive(
				'Truly, the quick brown fox.',
				'The quick brown fox.',
				'The quick red fox.'
			);
			expect(marks(leaf)).toEqual([['brown'], ['red']]);
			expect(leaf.reports.at(-1)?.outdated).toEqual([]);
			expect(accept(leaf)).toBe('Truly, the quick red fox.');
		});

		it('is put back by the leaf’s undo to the words that stood before it was taken', () => {
			const leaf = arrive(
				'The quick brown fox, mine.',
				'The quick brown fox.',
				'The quick red fox.'
			);
			accept(leaf);
			expect(leaf.field.undoReview()).toBe(true);
			expect(leaf.doc.main.body.text).toBe('The quick brown fox, mine.');
		});

		it('is outdated where the reader rewrote words it rewrites', () => {
			const leaf = arrive('The quick grey fox.', 'The quick brown fox.', 'The quick red fox.');
			expect(marks(leaf)).toEqual([['grey'], ['red']]);
			expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
		});

		it('is outdated where the reader wrote in a block it removes', () => {
			const leaf = arrive('The quick brown fox, mine.', 'The quick brown fox.', '');
			expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
		});

		it('is outdated where the reader wrote in a block a rewrite into fewer drops', () => {
			const leaf = leafOver('First here.\n\nSecond here, mine.');
			leaf.field.setReview([
				{
					id: 'r1',

					replace: ids(leaf),
					before: 'First here.\n\nSecond here.',
					after: 'First and second here.'
				}
			]);
			expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
		});

		it('is not outdated where a block it takes out stands as it was read', () => {
			const leaf = arrive('The quick brown fox.', 'The quick brown fox.', '');
			expect(leaf.reports.at(-1)?.outdated).toEqual([]);
		});

		it('is outdated where the reader typed inside words it rewrites', () => {
			const leaf = arrive('The quick, very brown fox.', 'The quick brown fox.', 'The fox.');
			expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
		});

		it('is outdated where what it read is not one block for each it names', () => {
			const leaf = arrive('The quick brown fox.', 'The quick\n\nbrown fox.', 'The quick red fox.');
			expect(leaf.reports.at(-1)?.outdated).toEqual(['r1']);
		});

		it('draws nothing where the reader wrote what it proposes', () => {
			const leaf = arrive('The quick red fox.', 'The quick brown fox.', 'The quick red fox.');
			expect(leaf.reports.at(-1)?.undrawn).toEqual([{ id: 'r1', reason: 'applied' }]);
		});

		it('carries what the reader types after it arrives as it carries what came before', () => {
			const leaf = arrive('The quick brown fox.', 'The quick brown fox.', 'The quick red fox.');
			type(leaf, 'Truly, ', 'The');
			expect(marks(leaf)).toEqual([['brown'], ['red']]);
			expect(accept(leaf)).toBe('Truly, The quick red fox.');
		});
	});
});

describe('answering', () => {
	/** `r1` open over the first paragraph, and `r2` taken over the second. */
	function proposal(): Leaf {
		const leaf = leafOver('The quick brown fox.\n\nA second paragraph.');
		leaf.field.setReview([
			{ id: 'r1', ...over(leaf, 'brown'), after: 'The quick red fox.' },
			{ id: 'r2', ...over(leaf, 'second'), after: 'A later paragraph.' }
		]);
		leaf.field.answerReview('r2', 'accept');
		leaf.acts.length = 0;
		return leaf;
	}
	it('draws no answers of its own', () => {
		const leaf = proposal();
		expect(leaf.el.querySelector('button')).toBeNull();
	});

	it('a dismissal answers and writes nothing, and the proposal is drawn no more', () => {
		const leaf = proposal();
		const before = leaf.doc.toMarkdown();
		expect(leaf.field.answerReview('r1', 'dismiss')).toBe(true);
		expect(leaf.acts).toEqual([['r1', 'dismiss']]);
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		expect(leaf.doc.toMarkdown()).toBe(before);
	});

	it('an accept writes the proposal, then answers', () => {
		const leaf = proposal();
		expect(leaf.field.answerReview('r1', 'accept')).toBe(true);
		expect(leaf.acts).toEqual([['r1', 'accept']]);
		expect(leaf.doc.main.body.text).toBe('The quick red fox.\nA later paragraph.');
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
	});

	it('leaves the chords to the leaf, which answers none', () => {
		const leaf = proposal();
		caretIn(leaf, 'quick');
		const before = leaf.doc.toMarkdown();
		for (const chord of [REVIEW_KEYS.accept, REVIEW_KEYS.dismiss])
			press(viewOf(leaf.field), chord.split('-').at(-1)!, { ctrlKey: true });
		expect(leaf.acts).toEqual([]);
		expect(leaf.doc.toMarkdown()).toBe(before);
	});

	it('a dismissed item is drawn again only under a list that holds it anew', () => {
		const leaf = leafOver('The quick brown fox.');
		const items: TextReview[] = [{ id: 'r1', ...over(leaf, 'brown'), after: 'The quick red fox.' }];
		leaf.field.setReview(items);
		leaf.field.answerReview('r1', 'dismiss');
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		leaf.field.setReview([]);
		leaf.field.setReview([...items]);
		expect(leaf.el.querySelector('[data-qm-review]')).not.toBeNull();
	});

	it('an accept moves neither the caret nor the focus', () => {
		const leaf = proposal();
		const view = viewOf(leaf.field);
		expect(leaf.field.answerReview('r1', 'accept')).toBe(true);
		expect(view.hasFocus()).toBe(false);

		const held = proposal();
		caretIn(held, 'later');
		const at = viewOf(held.field);
		const before = at.state.selection.$head.parentOffset;
		held.field.answerReview('r1', 'accept');
		const { $head } = at.state.selection;
		expect($head.parent.textContent).toBe('A later paragraph.');
		expect($head.parentOffset).toBe(before);
	});

	it('names a proposal that only adds from anywhere in the paragraph it adds after', () => {
		const leaf = leafOver('Opening line.\n\nClosing line.');
		leaf.field.setReview([{ id: 'r1', ...beside(leaf, 'line'), after: 'Inserted.' }]);
		caretIn(leaf, 'Opening');
		expect(leaf.points.at(-1)).toEqual(['r1', 'caret']);
	});

	it('names the item the caret was put into, of two that share a paragraph', () => {
		const leaf = leafOver('Opening line.\n\nSecond is proposed.');
		leaf.field.setReview([
			{ id: 'A', ...over(leaf, 'Second'), after: 'Second, rewritten.' },
			{ id: 'B', ...beside(leaf, 'proposed'), after: 'Added after.' }
		]);
		caretIn(leaf, 'Second');
		expect(leaf.points.at(-1)).toEqual(['A', 'caret']);

		const entered = leafOver('Opening line.\n\nSecond is proposed.');
		entered.field.setReview([
			{ id: 'A', ...over(entered, 'Second'), after: 'Second, rewritten.' },
			{ id: 'B', ...beside(entered, 'proposed'), after: 'Added after.' }
		]);
		expect(entered.field.enterReview('B')).toBe(true);
		expect(entered.points.at(-1)).toEqual(['B', 'caret']);
		expect(entered.field.answerReview('B', 'accept')).toBe(true);
		expect(entered.doc.main.body.text).toBe('Opening line.\nSecond is proposed.\nAdded after.');
		expect(texts(entered.el, 'ins.qm-review-ins')).toEqual([', rewritten']);
	});

	it('takes the caret into an item by its id', () => {
		const leaf = proposal();
		const view = viewOf(leaf.field);
		expect(leaf.field.enterReview('r1')).toBe(true);
		expect(view.hasFocus()).toBe(true);
		expect(leaf.points.at(-1)).toEqual(['r1', 'caret']);
		expect(leaf.field.enterReview('r2')).toBe(false);
		expect(leaf.field.enterReview('nowhere')).toBe(false);
	});

	it('reports the item the caret arrives in, and holds off while the reader types in it', () => {
		const leaf = proposal();
		caretIn(leaf, 'quick');
		expect(leaf.points.at(-1)).toEqual(['r1', 'caret']);
		const view = viewOf(leaf.field);
		view.dispatch(view.state.tr.insertText('x'));
		expect(leaf.points.at(-1)).toEqual([undefined, 'caret']);
		const said = leaf.points.length;
		view.dispatch(view.state.tr.insertText('y'));
		expect(leaf.points).toHaveLength(said);
		caretIn(leaf, 'later');
		caretIn(leaf, 'quick');
		expect(leaf.points.at(-1)).toEqual(['r1', 'caret']);
	});

	it('reports the item under the pointer, and its leaving', () => {
		const leaf = proposal();
		const mark = leaf.el.querySelector('del.qm-review-del')!;
		mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		expect(leaf.points.at(-1)).toEqual(['r1', 'pointer']);
		leaf.el.querySelector('.ProseMirror')!.dispatchEvent(new MouseEvent('mouseleave'));
		expect(leaf.points.at(-1)).toEqual([undefined, 'pointer']);
	});
});

describe('taking a proposal', () => {
	/** Propose `after` over the paragraphs from `from` to `to`, or beside the one holding `from`,
	 *  and take it. */
	function take(markdown: string, after: string, from: string, to?: string | true): Leaf {
		const leaf = leafOver(markdown);
		const at = to === true ? beside(leaf, from) : over(leaf, from, to ?? from);
		leaf.field.setReview([{ id: 'r1', ...at, after }]);
		const drawn = proposedText(leaf.el);
		answerFirst(leaf, 'accept');
		expect(leaf.acts).toEqual([['r1', 'accept']]);
		expect(shownText(leaf.el)).toBe(drawn);
		return leaf;
	}

	it.each([
		[
			'a rewrite',
			'The quick brown fox.',
			'The quick red fox leaps.',
			'quick',
			undefined,
			'The quick red fox leaps.'
		],
		[
			'formatting',
			'Submit the report.',
			'Submit the **signed** report.',
			'report',
			undefined,
			'Submit the **signed** report.'
		],
		[
			'two paragraphs',
			'First here.\n\nSecond here.\n\nThird stays.',
			'First rewritten.\n\nSecond rewritten.',
			'First',
			'Second',
			'First rewritten.\n\nSecond rewritten.\n\nThird stays.'
		],
		[
			'an added paragraph',
			'Opening line.\n\nClosing line.',
			'Opening line.\n\nA new middle.',
			'Opening',
			undefined,
			'Opening line.\n\nA new middle.\n\nClosing line.'
		],
		['a removal', 'Keep this.\n\nDrop this.', '', 'Drop', undefined, 'Keep this.'],
		[
			'an added item',
			'- first item\n- second item',
			'- second item\n- third item',
			'second',
			undefined,
			'- first item\n- second item\n- third item'
		],
		[
			'a removed item',
			'- first item\n- second item\n\nAfter.',
			'',
			'second',
			undefined,
			'- first item\n\nAfter.'
		],
		['a removed list', '- only item\n\nAfter.', '', 'only', undefined, 'After.'],
		['another kind of block', 'A plain line.', '# A heading', 'plain', undefined, '# A heading'],
		[
			'a paragraph made a list',
			'Before.\n\nOne, two.\n\nAfter.',
			'- One\n- Two',
			'One',
			undefined,
			'Before.\n\n- One\n- Two\n\nAfter.'
		]
	])('writes %s as it was drawn', (_name, markdown, after, from, to, written) => {
		const leaf = take(markdown, after, from, to);
		expect(core.exportMarkdown(leaf.doc.main.body)).toBe(core.exportMarkdown(md(written)));
	});

	it('writes what a point proposes after its paragraph, and before the first', () => {
		expect(
			take('Opening line.\n\nClosing line.', 'Inserted.', 'line', true).doc.main.body.text
		).toBe('Opening line.\nInserted.\nClosing line.');
		expect(take('Opening line.', 'A preamble.', 'Opening', true).doc.main.body.text).toBe(
			'A preamble.\nOpening line.'
		);
	});

	it('empties the leaf’s last paragraph where it stands', () => {
		const leaf = take('The only line.', '', 'only');
		expect(leaf.doc.main.body.text).toBe('');
	});

	it('is one step of the leaf’s own history', () => {
		const leaf = take(
			'The quick brown fox.\n\nClosing.',
			'The slow fox.\n\nAn added line.',
			'quick'
		);
		const view = viewOf(leaf.field);
		undo(view.state, view.dispatch);
		expect(leaf.doc.main.body.text).toBe('The quick brown fox.\nClosing.');
	});

	it('is drawn again by the undo that takes it back, and no more by the redo', () => {
		const leaf = take('The quick brown fox.', 'The quick red fox.', 'quick');
		const view = viewOf(leaf.field);
		undo(view.state, view.dispatch);
		expect(texts(leaf.el, 'del.qm-review-del')).toEqual(['brown']);
		expect(leaf.drawn.at(-1)).toEqual(['r1']);
		redo(view.state, view.dispatch);
		expect(leaf.doc.main.body.text).toBe('The quick red fox.');
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		expect(leaf.acts).toEqual([
			['r1', 'accept'],
			['r1', 'reopen'],
			['r1', 'accept']
		]);
	});

	it('is drawn again on the paragraph an undo puts back, where it replaced the whole of it', () => {
		const leaf = take('Keep this.\n\nDrop this.', '', 'Drop');
		expect(leaf.doc.main.body.text).toBe('Keep this.');
		leaf.field.undoReview();
		expect(leaf.doc.main.body.text).toBe('Keep this.\nDrop this.');
		expect(leaf.acts.at(-1)).toEqual(['r1', 'reopen']);
		expect(texts(leaf.el, 'del.qm-review-del').join('')).toBe('Drop this.');
	});

	it('is opened again after a dismissal, and says so', () => {
		const leaf = leafOver('The quick brown fox.');
		leaf.field.setReview([{ id: 'r1', ...over(leaf, 'quick'), after: 'The quick red fox.' }]);
		answerFirst(leaf, 'dismiss');
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		leaf.field.reopenReview('r1');
		expect(leaf.acts).toEqual([
			['r1', 'dismiss'],
			['r1', 'reopen']
		]);
		expect(leaf.el.querySelector('[data-qm-review]')).not.toBeNull();
	});

	it('is opened again after a dismissal the host took off its list', () => {
		const leaf = leafOver('The quick brown fox.');
		const item = {
			id: 'r1',

			...over(leaf, 'quick'),
			after: 'The quick red fox.'
		} as const;
		leaf.field.setReview([item]);
		answerFirst(leaf, 'dismiss');
		leaf.field.setReview([]);
		leaf.field.reopenReview('r1');
		expect(leaf.acts).toEqual([
			['r1', 'dismiss'],
			['r1', 'reopen']
		]);
		leaf.field.setReview([item]);
		expect(leaf.el.querySelector('[data-qm-review]')).not.toBeNull();
	});

	it('comes back with the words typed into its step, under one undo', () => {
		const leaf = take('The quick brown fox.', 'The quick red fox.', 'quick');
		const view = viewOf(leaf.field);
		view.dispatch(view.state.tr.insertText('dish', 1 + 'The quick red'.length));
		expect(leaf.doc.main.body.text).toBe('The quick reddish fox.');
		undo(view.state, view.dispatch);
		expect(leaf.doc.main.body.text).toBe('The quick brown fox.');
		expect(texts(leaf.el, 'ins.qm-review-ins')).toEqual(['red']);
	});

	it('keeps the marks the reader’s paragraph holds outside the words it rewrites', () => {
		const leaf = leafOver('The quick brown fox.');
		const change: TextReview = {
			id: 'r2',

			...over(leaf, 'fox'),
			after: 'The quick brown cat.'
		};
		leaf.field.setReview([change]);
		leaf.field.answerReview('r2', 'accept');
		leaf.field.setReview([
			{ id: 'r1', ...over(leaf, 'quick'), after: 'The quick red cat.' },
			change
		]);
		answerFirst(leaf, 'accept');
		expect(leaf.doc.main.body.text).toBe('The quick red cat.');
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
	});
});

describe('a taken proposal the host still lists', () => {
	/** Two paragraphs, each with a proposal over its second word, both taken. */
	function both(): Leaf {
		const leaf = leafOver('The quick brown fox.\n\nA slow grey cat.');
		leaf.field.setReview([
			{ id: 'r1', ...over(leaf, 'quick'), after: 'The quick red fox.' },
			{ id: 'r2', ...over(leaf, 'slow'), after: 'A slow **black** cat.' }
		]);
		leaf.field.answerReview('r1', 'accept');
		leaf.field.answerReview('r2', 'accept');
		return leaf;
	}

	it('is plain text, drawn no more and reported as nothing', () => {
		const leaf = both();
		expect(leaf.doc.main.body.text).toBe('The quick red fox.\nA slow black cat.');
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		expect(leaf.reports.at(-1)).toEqual({ ids: [], outdated: [], undrawn: [] });
		expect(leaf.field.answerReview('r1', 'accept')).toBe(false);
		expect(leaf.field.answerReview('r1', 'dismiss')).toBe(false);
	});

	it('is the proposal again under ⌘Z, and taken again under redo', () => {
		const leaf = both();
		const view = viewOf(leaf.field);
		undo(view.state, view.dispatch);
		expect(texts(leaf.el, 'del.qm-review-del')).toEqual(['grey']);
		expect(leaf.acts.at(-1)).toEqual(['r2', 'reopen']);
		redo(view.state, view.dispatch);
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
		expect(core.exportMarkdown(leaf.doc.main.body)).toContain('**black**');
		expect(leaf.acts.at(-1)).toEqual(['r2', 'accept']);
	});
});
