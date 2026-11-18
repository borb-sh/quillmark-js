/** A control that keeps its own keys: a form control, or anything the reader types in under
 *  any spelling of `contenteditable` but `false`, which the nearest one holding it decides. */
export function textBox(target: Element): boolean {
	if (target.closest('input, textarea, select')) return true;
	const editable = target.closest('[contenteditable]');
	return !!editable && editable.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}

/** Whether a modal the editor stands outside holds `target`: a key there is the dialog's. */
function underModal(target: Element, root: Element | undefined): boolean {
	const modal = target.closest('[aria-modal="true"], dialog[open]');
	if (!modal) return false;
	if (modal instanceof HTMLDialogElement && !modal.matches(':modal')) return false;
	return !root || !modal.contains(root);
}

/**
 * Whether a review key pressed at `target` is the review's: anywhere on the page but under a
 * modal the editor stands outside, inside another editor, or in a text box outside the editor.
 * A text box the host marks `data-qm-review-keys` has no use for the chords and hands them
 * over. With no `root`, every editor on the page counts as the one asking.
 */
export function reviewKeysHeard(target: EventTarget | null, root?: Element): boolean {
	if (!(target instanceof Element) || underModal(target, root)) return false;
	if (root ? root.contains(target) : target.closest('.qm-editor')) return true;
	if (target.closest('.qm-editor')) return false;
	return !textBox(target) || !!target.closest('[data-qm-review-keys]');
}
