// @vitest-environment jsdom
// The editor over a comment controller (VISUAL_EDITOR §Comments): a comment starts as an
// anchor over the selection and a draft in the seat, the thread exists once the draft is
// submitted, the caret names the thread under it, and the verbs reach the anchor through
// the leaf holding it. The threads themselves are `@quillmark/comments`'s; the editor
// holds none.
import { describe, it, expect, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { TextSelection } from 'prosemirror-state';
import { createComments, MemoryCommentStore, type Comments } from '@quillmark/comments';
import type { ContentHit, Document } from '@quillmark/wasm';
import { CommentSeat } from '$lib/visual/comments.svelte.js';
import { quill, example } from '../helpers/fixtures.js';
import { activeView, mountInner, unmountAll, type InnerRef } from '../helpers/surface.svelte.js';

afterEach(unmountAll);

const at = (field: string, pos: number) => ({ field, pos }) as ContentHit;

async function open(doc: Document = example()) {
	const seat = new CommentSeat();
	const comments = createComments({
		store: new MemoryCommentStore(),
		author: { id: 'u1', name: 'Nibs' }
	});
	await comments.ready;
	const mounted = mountInner(quill(), doc, {
		comments,
		commentSeat: seat
	} as Parameters<typeof mountInner>[2]);
	return { ...mounted, seat, comments, doc };
}

/** Select USV `[from, to]` of the body's first paragraph, where PM 1 is USV 0. */
async function select(editor: InnerRef, from: number, to: number) {
	await editor.setCaret(at('main.body', from));
	const view = activeView(editor);
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from + 1, to + 1)));
	return view;
}

async function commented(comments: Comments, seat: CommentSeat, editor: InnerRef) {
	await select(editor, 3, 8);
	expect(editor.startComment()).toBe(true);
	await seat.verbs!.submitDraft('Why this?');
	const id = seat.threads[0]!.id;
	return { id, thread: comments.thread(id)! };
}

describe('a comment over the selection', () => {
	it('starts as an anchor and a draft, drawn active, and becomes a thread on submit', async () => {
		const { editor, seat, comments, doc } = await open();
		const view = await select(editor, 3, 8);
		const quote = doc.main.body.text.slice(3, 8);

		expect(editor.startComment()).toBe(true);
		expect(seat.draft?.quote).toBe(quote);
		expect(seat.active).toBe(seat.draft?.id);
		expect(doc.anchorContext(seat.draft!.id)?.quote).toBe(quote);
		flushSync();
		expect(view.dom.querySelector('.qm-comment-active')?.textContent).toBe(quote);
		expect(comments.threads).toEqual([]);

		await seat.verbs!.submitDraft('Why this?');
		expect(seat.draft).toBeUndefined();
		expect(seat.threads).toHaveLength(1);
		expect(seat.threads[0]).toMatchObject({
			anchored: true,
			status: 'open',
			selector: { path: 'main.body', quote }
		});
		expect(seat.threads[0]!.messages[0]!.body).toBe('Why this?');
	});

	it('a discarded draft takes its anchor with it', async () => {
		const { editor, seat, doc } = await open();
		await select(editor, 3, 8);
		editor.startComment();
		const id = seat.draft!.id;
		seat.verbs!.discardDraft();
		expect(seat.draft).toBeUndefined();
		expect(seat.active).toBeUndefined();
		expect(doc.anchorContext(id)).toBeUndefined();
	});

	it('refuses where the selection is in no prose leaf', async () => {
		const { editor, seat } = await open();
		expect(editor.startComment()).toBe(false);
		expect(seat.draft).toBeUndefined();
	});
});

describe('the caret and the thread under it', () => {
	it('names the thread under the caret, and none elsewhere', async () => {
		const { editor, seat, comments } = await open();
		const { id } = await commented(comments, seat, editor);
		const view = activeView(editor);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		expect(seat.active).toBeUndefined();
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
		expect(seat.active).toBe(id);
	});

	it('focusThread selects the anchor; a resolved thread is drawn only while active', async () => {
		const { editor, seat, comments } = await open();
		const { id } = await commented(comments, seat, editor);
		const view = activeView(editor);
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
		await comments.setStatus(id, 'resolved');
		flushSync();
		expect(view.dom.querySelector('.qm-comment')).toBeNull();

		await editor.focusThread(id);
		expect(seat.active).toBe(id);
		expect(view.state.selection).toMatchObject({ from: 4, to: 9 });
		flushSync();
		expect(view.dom.querySelector('.qm-comment-active')).not.toBeNull();
	});

	it('reports the active thread to the host once per change', async () => {
		const seen: (string | undefined)[] = [];
		const seat = new CommentSeat();
		const comments = createComments({
			store: new MemoryCommentStore(),
			author: { id: 'u1', name: 'Nibs' }
		});
		await comments.ready;
		const { editor } = mountInner(quill(), example(), {
			comments,
			commentSeat: seat,
			onActiveThreadChange: (id: string | undefined) => seen.push(id)
		} as Parameters<typeof mountInner>[2]);
		const { id } = await commented(comments, seat, editor);
		flushSync();
		expect(seen.at(-1)).toBe(id);
	});
});

describe('the verbs over a thread', () => {
	it('removeThread drops the anchor and the thread', async () => {
		const { editor, seat, comments, doc } = await open();
		const { id } = await commented(comments, seat, editor);
		await editor.removeThread(id);
		expect(seat.threads).toEqual([]);
		expect(doc.anchorContext(id)).toBeUndefined();
		expect(seat.active).toBeUndefined();
	});

	it('an anchor the document lost shows unanchored; reanchorThread places it again', async () => {
		const { editor, seat, comments, doc } = await open();
		const { id } = await commented(comments, seat, editor);
		doc.applyChange({}, { markOps: [{ op: 'removeAnchor', id }] });
		editor.applyExternal('main.body');
		comments.sync(doc);
		expect(seat.threads[0]).toMatchObject({ anchored: false });

		await select(editor, 10, 14);
		expect(await editor.reanchorThread(id)).toBe(true);
		const quote = doc.main.body.text.slice(10, 14);
		expect(doc.anchorContext(id)?.quote).toBe(quote);
		expect(seat.threads[0]).toMatchObject({ anchored: true, selector: { quote } });
	});

	it('typing inside a thread keeps it anchored and shows the drift until refreshed', async () => {
		const { editor, seat, comments, doc } = await open();
		const { id } = await commented(comments, seat, editor);
		const view = activeView(editor);
		view.dispatch(view.state.tr.insertText('XY', 6));
		expect(seat.threads[0]).toMatchObject({ anchored: true });
		expect(seat.drifted).toEqual([id]);
		await comments.refresh(doc);
		expect(seat.drifted).toEqual([]);
		expect(seat.threads[0]!.selector.quote).toBe(doc.anchorContext(id)?.quote);
	});
});
