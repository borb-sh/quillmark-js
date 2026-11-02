// The editor's comment controller, published to the mounted tree so a prose leaf hands the
// anchors its commits drop to the reconcile flow without a prop at every rung between.
import { getContext, setContext } from 'svelte';
import type { Comments } from '../core/comments/index.js';

const COMMENTS = Symbol('qm-comments');

/** Publish the live controller: a getter, so a host swapping the prop reaches mounted leaves. */
export function setComments(current: () => Comments | undefined): void {
	setContext(COMMENTS, current);
}

/** The live controller's getter, read at commit time; it answers `undefined` with none, or off-tree. */
export function commentsChannel(): () => Comments | undefined {
	return getContext<(() => Comments | undefined) | undefined>(COMMENTS) ?? (() => undefined);
}
