// The comment seat: what the editor and a comment panel share (VISUAL_EDITOR §Comments). The
// door mints one so it outlives a document swap; the mounted editor binds the verbs onto it and
// mirrors the index into it; a panel reads the mirror and calls the verbs. The editor imports
// no code from `@quillmark/comments`, which is an optional peer: it speaks the controller's
// shape, and a host without comments mounts the editor with the seat empty.
import { getContext, setContext } from 'svelte';
import type { CommentThread, Comments } from '@quillmark/comments';

/** A thread being written: its anchor is placed over `quote`, its first message is not yet. */
export interface CommentDraft {
	id: string;
	quote: string;
}

/** The verbs the mounted editor binds; each is a no-op until it has. */
export interface CommentVerbs {
	/** Place an anchor over the active leaf's selection and open a draft on it: what the
	 *  popover's comment button does. False where no leaf could take the anchor. */
	startComment(): boolean;
	/** Select the thread's anchor and reveal the leaf holding it; an unanchored thread is
	 *  made active alone. */
	focusThread(id: string): Promise<void>;
	/** Place the thread's anchor over the active leaf's selection, dropping the one it had, and
	 *  store the selector it was placed at. False where no leaf could take it. */
	reanchorThread(id: string): Promise<boolean>;
	/** Drop the thread's anchor and the thread. */
	removeThread(id: string): Promise<void>;
	/** Mint the draft's thread with `body` as its first message; the anchor is removed and the
	 *  rejection rethrown where the store refuses. */
	submitDraft(body: string): Promise<void>;
	/** Drop the draft and the anchor it placed. */
	discardDraft(): void;
}

export class CommentSeat {
	/** The controller the editor is bound to, for a panel's own reply and status writes. */
	comments = $state.raw<Comments | undefined>(undefined);
	/** The index, as the controller last published it. */
	threads = $state.raw<readonly CommentThread[]>([]);
	/** Ids whose live quote has moved from the stored one. */
	drifted = $state.raw<readonly string[]>([]);
	/** The thread under the caret, or the one last focused from a panel. */
	active = $state<string | undefined>(undefined);
	draft = $state.raw<CommentDraft | undefined>(undefined);
	verbs = $state.raw<CommentVerbs | undefined>(undefined);
}

/** How a prose leaf draws its anchors, published by the editor to every leaf under it. */
export interface AnchorDraw {
	anchorClass(id: string): string | undefined;
}

const DRAW = Symbol('qm-anchor-draw');

export function setAnchorDraw(draw: AnchorDraw): void {
	setContext(DRAW, draw);
}

/** The draw under a mounted editor; `undefined` for a leaf mounted on its own. */
export function anchorDraw(): AnchorDraw | undefined {
	return getContext<AnchorDraw | undefined>(DRAW);
}

/** What the panel says. Every key is a word a product in another language replaces. */
export interface CommentPanelStrings {
	panelLabel: string;
	/** Under no thread and no draft. */
	empty: string;
	/** What stands for a point anchor's quote, which is empty. */
	pointQuote: string;
	draftPlaceholder: string;
	submit: string;
	cancel: string;
	replyPlaceholder: string;
	reply: string;
	resolve: string;
	reopen: string;
	/** Place the anchor over the editor's selection again. */
	reanchor: string;
	remove: string;
	/** The quote's hover title: it selects the anchor. */
	goTo: string;
	resolved: string;
	/** The chip on a thread whose anchor the document no longer holds. */
	unanchored: string;
	/** The chip on a thread whose live quote has moved from the stored one. */
	drifted: string;
	/** A message's time, from its ISO stamp. */
	when: (iso: string) => string;
}

export const DEFAULT_COMMENT_STRINGS: CommentPanelStrings = {
	panelLabel: 'Comments',
	empty: 'No comments yet. Select some text and choose Comment.',
	pointQuote: '(at a point)',
	draftPlaceholder: 'Write a comment',
	submit: 'Comment',
	cancel: 'Cancel',
	replyPlaceholder: 'Reply',
	reply: 'Reply',
	resolve: 'Resolve',
	reopen: 'Reopen',
	reanchor: 'Re-anchor to selection',
	remove: 'Delete',
	goTo: 'Go to the text',
	resolved: 'Resolved',
	unanchored: 'Unanchored',
	drifted: 'Text changed',
	when: (iso) => new Date(iso).toLocaleString()
};
