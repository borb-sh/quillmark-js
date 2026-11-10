// @vitest-environment jsdom
// The review layer of a prose leaf: an item draws by the anchor it names, in the leaf's own
// flow, and writes nothing while it stands; a proposal reads as an edit of its paragraph, and
// taking it writes what was drawn; the two chords and the two buttons answer through one channel.
import { describe, it, expect, afterEach } from 'vitest';
import { undo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { createField, REVIEW_KEYS, DEFAULT_REVIEW_STRINGS } from '$lib/core/codec';
import type { FieldController, ReviewAction, ReviewVia, TextReview } from '$lib/core/codec';
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
	/** Lay an anchor over the first `text` in the body, or a point at its start. */
	anchor(id: string, text: string, point?: boolean): void;
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
	const field = createField({
		doc,
		quill: quill(),
		addr: {},
		container: el,
		onReview: (id, action) => acts.push([id, action]),
		onReviewPoint: (id, via) => points.push([id, via]),
		onReviewDrawn: (ids) => drawn.push([...ids])
	});
	open.push(field);
	return {
		doc,
		field,
		el,
		acts,
		points,
		drawn,
		anchor(id, text, point = false) {
			const at = doc.main.body.text.indexOf(text);
			if (at < 0) throw new Error(`no ${text} in the body`);
			field.insertAnchor(id, at, point ? at : at + text.length);
		}
	};
}

/** What the reader would read were every proposal taken: the leaf's text less what is struck. */
function proposedText(el: HTMLElement): string {
	const copy = el.querySelector('.ProseMirror')!.cloneNode(true) as HTMLElement;
	for (const gone of copy.querySelectorAll('.qm-review-out, del, .qm-review-chip')) gone.remove();
	for (let emptied; (emptied = copy.querySelector('li:empty, ul:empty, ol:empty'));)
		emptied.remove();
	return [...copy.children].map((block) => block.textContent).join('\n');
}

/** The leaf's blocks as the reader reads them. */
const shownText = (el: HTMLElement): string =>
	[...el.querySelector('.ProseMirror')!.children].map((block) => block.textContent).join('\n');

const texts = (el: HTMLElement, selector: string): string[] =>
	[...el.querySelectorAll(selector)].map((node) => node.textContent ?? '');

describe('a change', () => {
	it('marks the text its anchor covers, and nothing in the document', () => {
		const leaf = leafOver('The plan was approved on Monday.');
		leaf.anchor('~c1', 'approved');
		const before = leaf.doc.toMarkdown();
		leaf.field.setReview([{ id: 'r1', state: 'changed', anchor: '~c1' }]);
		expect(texts(leaf.el, '.qm-review-changed')).toEqual(['approved']);
		expect(leaf.field.reviewElements('r1').map((el) => el.textContent)).toEqual(['approved']);
		expect(leaf.doc.toMarkdown()).toBe(before);
	});

	it('stands a wedge where its point anchor says text was removed', () => {
		const leaf = leafOver('The plan was approved.');
		leaf.anchor('~c1', 'approved', true);
		leaf.field.setReview([{ id: 'r1', state: 'changed', anchor: '~c1' }]);
		const wedge = leaf.el.querySelector('.qm-review-gone')!;
		expect(wedge.getAttribute('aria-label')).toBe(DEFAULT_REVIEW_STRINGS.reviewGone);
		expect(wedge.nextSibling?.textContent).toBe('approved.');
		expect(leaf.el.querySelector('.ProseMirror')!.textContent).toBe(leaf.doc.main.body.text);
	});

	it('rides the edits made around it', () => {
		const leaf = leafOver('The plan was approved.');
		leaf.anchor('~c1', 'approved');
		leaf.field.setReview([{ id: 'r1', state: 'changed', anchor: '~c1' }]);
		const view = viewOf(leaf.field);
		view.dispatch(view.state.tr.insertText('Yesterday ', 1));
		expect(texts(leaf.el, '.qm-review-changed')).toEqual(['approved']);
	});

	it('draws nothing for an anchor the leaf does not hold, and says which it drew', () => {
		const leaf = leafOver('The plan was approved.');
		leaf.anchor('~c1', 'plan');
		leaf.field.setReview([
			{ id: 'r1', state: 'changed', anchor: '~c1' },
			{ id: 'r2', state: 'changed', anchor: '~elsewhere' }
		]);
		expect(leaf.drawn.at(-1)).toEqual(['r1']);
		expect(leaf.field.reviewElements('r2')).toEqual([]);
		leaf.field.setReview([]);
		expect(leaf.drawn.at(-1)).toEqual([]);
		expect(leaf.el.querySelector('[data-qm-review]')).toBeNull();
	});

	it('is drawn a step stronger while it is the lit one', () => {
		const leaf = leafOver('The plan was approved.');
		leaf.anchor('~c1', 'plan');
		const items: TextReview[] = [{ id: 'r1', state: 'changed', anchor: '~c1' }];
		leaf.field.setReview(items, 'r1');
		expect(leaf.el.querySelector('.qm-review-changed.qm-review-lit')).not.toBeNull();
		leaf.field.setReview(items);
		expect(leaf.el.querySelector('.qm-review-lit')).toBeNull();
	});
});

describe('a proposal', () => {
	it('reads its paragraph as rewritten: the words that go struck, the words that come added', () => {
		const leaf = leafOver('The quick brown fox jumps over the lazy dog.');
		leaf.anchor('~p1', 'brown');
		const after = 'The quick red fox leaps over the lazy dog.';
		const before = leaf.doc.toMarkdown();
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after }]);
		expect(texts(leaf.el, 'del.qm-review-del')).toEqual(['brown', 'jumps']);
		expect(texts(leaf.el, 'ins.qm-review-ins')).toEqual(['red', 'leaps']);
		expect(proposedText(leaf.el)).toBe(after);
		expect(leaf.doc.toMarkdown()).toBe(before);
	});

	it('covers the whole of every paragraph its anchor touches', () => {
		const leaf = leafOver('First paragraph here.\n\nSecond paragraph here.\n\nThird stays.');
		const { text } = leaf.doc.main.body;
		leaf.field.insertAnchor('~p1', text.indexOf('here'), text.indexOf('Second') + 3);
		leaf.field.setReview([
			{
				id: 'r1',
				state: 'proposed',
				anchor: '~p1',
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
		leaf.anchor('~p1', 'report');
		leaf.field.setReview([
			{
				id: 'r1',
				state: 'proposed',
				anchor: '~p1',
				after: 'Submit the **signed** report by Friday.'
			}
		]);
		expect(leaf.el.querySelector('ins.qm-review-ins strong')?.textContent).toBe('signed');
	});

	it('strikes the stretch whose formatting alone would change', () => {
		const leaf = leafOver('Submit the report by Friday.');
		leaf.anchor('~p1', 'report');
		leaf.field.setReview([
			{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'Submit the **report** by Friday.' }
		]);
		expect(texts(leaf.el, 'del.qm-review-del')).toEqual(['report']);
		expect(leaf.el.querySelector('ins.qm-review-ins strong')?.textContent).toBe('report');
	});

	it('sets the paragraphs it adds in flow under the one it rewrites', () => {
		const leaf = leafOver('Opening line.\n\nClosing line.');
		leaf.anchor('~p1', 'Opening');
		leaf.field.setReview([
			{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'Opening line.\n\nA new middle.' }
		]);
		const blocks = [...leaf.el.querySelector('.ProseMirror')!.children];
		expect(blocks.map((b) => b.classList.contains('qm-review-add'))).toEqual([false, true, false]);
		expect(proposedText(leaf.el)).toBe('Opening line.\nA new middle.\nClosing line.');
	});

	it('strikes a paragraph it would remove', () => {
		const leaf = leafOver('Keep this.\n\nDrop this.');
		leaf.anchor('~p1', 'Drop');
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after: '' }]);
		expect(texts(leaf.el, 'del.qm-review-del').join('')).toBe('Drop this.');
		expect(leaf.el.querySelector('.qm-review-out')?.textContent).toContain('Drop this.');
	});

	it('proposes new paragraphs after the one holding its point anchor', () => {
		const leaf = leafOver('Opening line.\n\nClosing line.');
		leaf.anchor('~p1', 'line', true);
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'Inserted.' }]);
		expect(proposedText(leaf.el)).toBe('Opening line.\nInserted.\nClosing line.');
		expect(leaf.el.querySelector('del')).toBeNull();
	});

	it('proposes before the first paragraph where its point opens the leaf', () => {
		const leaf = leafOver('Opening line.');
		leaf.anchor('~p1', 'Opening', true);
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'A preamble.' }]);
		expect(proposedText(leaf.el)).toBe('A preamble.\nOpening line.');
	});

	it('writes into the empty paragraph its point stands in', () => {
		const leaf = leafOver('');
		leaf.field.insertAnchor('~p1', 0);
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'A first line.' }]);
		expect(leaf.el.querySelector('.ProseMirror')!.children).toHaveLength(1);
		expect(texts(leaf.el, 'ins.qm-review-ins')).toEqual(['A first line.']);
	});

	it('adds an item to the list its paragraph is in, as an item of that list', () => {
		const leaf = leafOver('- first item\n- second item');
		leaf.anchor('~p1', 'second');
		leaf.field.setReview([
			{ id: 'r1', state: 'proposed', anchor: '~p1', after: '- second item\n- third item' }
		]);
		const list = leaf.el.querySelector('ul')!;
		expect(leaf.el.querySelectorAll('ul')).toHaveLength(1);
		expect([...list.children].map((li) => li.tagName)).toEqual(['LI', 'LI', 'LI']);
		expect(list.lastElementChild!.classList.contains('qm-review-add')).toBe(true);
		expect(list.lastElementChild!.textContent).toContain('third item');
	});

	it('replaces a paragraph it would turn into another kind of block, whole', () => {
		const leaf = leafOver('A plain line.');
		leaf.anchor('~p1', 'plain');
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after: '# A heading' }]);
		expect(texts(leaf.el, 'del.qm-review-del').join('')).toBe('A plain line.');
		expect(leaf.el.querySelector('h1.qm-review-add')?.textContent).toContain('A heading');
	});

	it('gives a paragraph to the first proposal that names it', () => {
		const leaf = leafOver('One paragraph only.');
		leaf.anchor('~p1', 'One');
		leaf.anchor('~p2', 'only');
		leaf.field.setReview([
			{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'One paragraph, first.' },
			{ id: 'r2', state: 'proposed', anchor: '~p2', after: 'One paragraph, second.' }
		]);
		expect(leaf.drawn.at(-1)).toEqual(['r1']);
	});

	it('follows the reader’s own edits to the paragraph', () => {
		const leaf = leafOver('The quick brown fox.');
		leaf.anchor('~p1', 'quick');
		const after = 'The quick red fox.';
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after }]);
		const view = viewOf(leaf.field);
		const at = 1 + leaf.doc.main.body.text.indexOf('brown');
		view.dispatch(view.state.tr.insertText('red', at, at + 'brown'.length));
		expect(leaf.el.querySelector('del, ins')).toBeNull();
		expect(proposedText(leaf.el)).toBe(after);
	});
});

describe('answering', () => {
	function proposal(): Leaf {
		const leaf = leafOver('The quick brown fox.\n\nA second paragraph.');
		leaf.anchor('~p1', 'brown');
		leaf.anchor('~c1', 'second');
		leaf.field.setReview([
			{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'The quick red fox.' },
			{ id: 'r2', state: 'changed', anchor: '~c1' }
		]);
		return leaf;
	}
	function caretIn(leaf: Leaf, text: string): void {
		const view = viewOf(leaf.field);
		const at = 2 + leaf.doc.main.body.text.indexOf(text);
		view.focus();
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
	}
	const mod = { ctrlKey: true };
	const keyOf = (chord: string): string => chord.slice(chord.lastIndexOf('-') + 1);

	it('a proposal carries its two buttons, named by the strings', () => {
		const leaf = proposal();
		const chip = leaf.el.querySelector('.qm-review-chip')!;
		expect(chip.getAttribute('aria-label')).toBe(DEFAULT_REVIEW_STRINGS.reviewProposal);
		expect(texts(leaf.el, '.qm-review-act')).toEqual([
			DEFAULT_REVIEW_STRINGS.reviewAccept,
			DEFAULT_REVIEW_STRINGS.reviewDismiss
		]);
	});

	it('Dismiss answers and writes nothing, and the proposal is drawn no more', () => {
		const leaf = proposal();
		const before = leaf.doc.toMarkdown();
		leaf.el.querySelector<HTMLElement>('.qm-review-dismiss')!.click();
		expect(leaf.acts).toEqual([['r1', 'dismiss']]);
		expect(leaf.el.querySelector('del, ins, .qm-review-chip')).toBeNull();
		expect(leaf.doc.toMarkdown()).toBe(before);
	});

	it('Accept writes the proposal, then answers', () => {
		const leaf = proposal();
		leaf.el.querySelector<HTMLElement>('.qm-review-accept')!.click();
		expect(leaf.acts).toEqual([['r1', 'accept']]);
		expect(leaf.doc.main.body.text).toBe('The quick red fox.\nA second paragraph.');
		expect(leaf.el.querySelector('del, ins, .qm-review-chip')).toBeNull();
	});

	it('the chords answer the proposal the caret is in', () => {
		const taken = proposal();
		caretIn(taken, 'quick');
		press(viewOf(taken.field), keyOf(REVIEW_KEYS.accept), mod);
		expect(taken.acts).toEqual([['r1', 'accept']]);
		expect(taken.doc.main.body.text).toContain('red fox');

		const turned = proposal();
		caretIn(turned, 'quick');
		press(viewOf(turned.field), keyOf(REVIEW_KEYS.reject), mod);
		expect(turned.acts).toEqual([['r1', 'dismiss']]);
		expect(turned.doc.main.body.text).toContain('brown fox');
	});

	it('an answered item is drawn again only under a list that holds it anew', () => {
		const leaf = proposal();
		const items: TextReview[] = [{ id: 'r2', state: 'changed', anchor: '~c1' }];
		leaf.field.setReview(items);
		caretIn(leaf, 'second');
		press(viewOf(leaf.field), keyOf(REVIEW_KEYS.reject), mod);
		expect(leaf.el.querySelector('.qm-review-changed')).toBeNull();
		leaf.field.setReview([]);
		leaf.field.setReview([...items]);
		expect(leaf.el.querySelector('.qm-review-changed')).not.toBeNull();
	});

	it('the reject chord takes back the change the caret is in, and the accept chord passes', () => {
		const leaf = proposal();
		caretIn(leaf, 'second');
		press(viewOf(leaf.field), keyOf(REVIEW_KEYS.accept), mod);
		expect(leaf.acts).toEqual([]);
		press(viewOf(leaf.field), keyOf(REVIEW_KEYS.reject), mod);
		expect(leaf.acts).toEqual([['r2', 'undo']]);
	});

	it('the chords pass where the caret is in no item', () => {
		const leaf = proposal();
		caretIn(leaf, 'paragraph');
		press(viewOf(leaf.field), keyOf(REVIEW_KEYS.reject), mod);
		expect(leaf.acts).toEqual([]);
	});

	it('reports the item the caret arrives in, and holds off while the reader types in it', () => {
		const leaf = proposal();
		caretIn(leaf, 'second');
		expect(leaf.points.at(-1)).toEqual(['r2', 'caret']);
		const view = viewOf(leaf.field);
		view.dispatch(view.state.tr.insertText('x'));
		expect(leaf.points.at(-1)).toEqual([undefined, 'caret']);
		const said = leaf.points.length;
		view.dispatch(view.state.tr.insertText('y'));
		expect(leaf.points).toHaveLength(said);
		caretIn(leaf, 'paragraph');
		caretIn(leaf, 'second');
		expect(leaf.points.at(-1)).toEqual(['r2', 'caret']);
	});

	it('reports the item under the pointer, and its leaving', () => {
		const leaf = proposal();
		const mark = leaf.el.querySelector('.qm-review-changed')!;
		mark.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		expect(leaf.points.at(-1)).toEqual(['r2', 'pointer']);
		leaf.el.querySelector('.ProseMirror')!.dispatchEvent(new MouseEvent('mouseleave'));
		expect(leaf.points.at(-1)).toEqual([undefined, 'pointer']);
	});
});

describe('taking a proposal', () => {
	/** Lay `after` over the paragraphs from `from` to `to`, or at a point before `from`, and take it. */
	function take(markdown: string, after: string, from: string, to?: string | true): Leaf {
		const leaf = leafOver(markdown);
		const { text } = leaf.doc.main.body;
		if (to === true) leaf.anchor('~p1', from, true);
		else leaf.field.insertAnchor('~p1', text.indexOf(from), text.indexOf(to ?? from) + 1);
		leaf.field.setReview([{ id: 'r1', state: 'proposed', anchor: '~p1', after }]);
		const drawn = proposedText(leaf.el);
		leaf.el.querySelector<HTMLElement>('.qm-review-accept')!.click();
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

	it('keeps the marks the reader’s paragraph holds outside the words it rewrites', () => {
		const leaf = leafOver('The quick brown fox.');
		leaf.anchor('~p1', 'brown');
		leaf.anchor('~c1', 'fox');
		leaf.field.setReview([
			{ id: 'r1', state: 'proposed', anchor: '~p1', after: 'The quick red fox.' },
			{ id: 'r2', state: 'changed', anchor: '~c1' }
		]);
		leaf.el.querySelector<HTMLElement>('.qm-review-accept')!.click();
		expect(texts(leaf.el, '.qm-review-changed')).toEqual(['fox']);
	});
});

describe('a text leaf', () => {
	it('holds no anchors, so draws no review', () => {
		const doc = example();
		const el = mount();
		const field = createField({
			doc,
			quill: quill(),
			addr: { field: 'title' },
			container: el,
			plaintext: true,
			inline: true
		});
		open.push(field);
		field.setReview([{ id: 'r1', state: 'changed', anchor: '~c1' }]);
		expect(field.reviewElements('r1')).toEqual([]);
	});
});
