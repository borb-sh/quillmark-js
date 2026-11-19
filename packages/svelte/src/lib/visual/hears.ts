/** A control that keeps its own keys: a form control, or anything the reader types in under
 *  any spelling of `contenteditable` but `false`, which the nearest one holding it decides. */
export function textBox(target: Element): boolean {
	if (target.closest('input, textarea, select')) return true;
	const editable = target.closest('[contenteditable]');
	return !!editable && editable.getAttribute('contenteditable')?.toLowerCase() !== 'false';
}

const MODALS = '[aria-modal="true"], dialog[open]';

/** Whether `el` is a modal on show. A `<dialog>` is one only as `showModal` opens it, and
 *  counts as one where the engine has no `:modal` to ask. */
function modal(el: Element): boolean {
	if (el.checkVisibility?.() === false) return false;
	if (!(el instanceof HTMLDialogElement)) return true;
	try {
		return el.matches(':modal');
	} catch {
		return true;
	}
}

/** Whether a modal on show stands over the editor: one holding neither `root` nor, with no
 *  `root`, any editor. A key under it is the dialog's wherever the focus is, on the page behind
 *  it included. */
function underModal(root: Element | undefined): boolean {
	for (const el of document.querySelectorAll(MODALS))
		if (modal(el) && !(root ? el.contains(root) : el.querySelector('.qm-editor'))) return true;
	return false;
}

/** A review key by name, as a host lists the ones a text box hands over. */
export type ReviewKeyName = 'accept' | 'dismiss' | 'next' | 'previous' | 'undo';

/** Whether the text box holding `target` hands the review `key`: `data-qm-review-keys` empty
 *  hands every key over, and a list of names hands those alone. */
function handedOver(target: Element, key: ReviewKeyName | undefined): boolean {
	const box = target.closest('[data-qm-review-keys]');
	if (!box) return false;
	const names = box.getAttribute('data-qm-review-keys')!.split(/\s+/).filter(Boolean);
	return !names.length || (key !== undefined && names.includes(key));
}

/**
 * Whether review key `key` pressed at `target` is the review's: anywhere on the page but under
 * a modal the editor stands outside, inside another editor, or in a text box outside the editor.
 * A text box the host marks `data-qm-review-keys` hands over the keys it has no use for: all of
 * them with the attribute empty, the ones it names otherwise, so a prompt holding a draft can
 * hand over accept and keep dismiss for its own delete. With no `root`, every editor on the
 * page counts as the one asking.
 */
export function reviewKeysHeard(
	target: EventTarget | null,
	root?: Element,
	key?: ReviewKeyName
): boolean {
	if (!(target instanceof Element) || underModal(root)) return false;
	if (root ? root.contains(target) : target.closest('.qm-editor')) return true;
	if (target.closest('.qm-editor')) return false;
	return !textBox(target) || handedOver(target, key);
}
