// The error channel: what a surface reports when it recovered from a failure. Every site behind
// these codes declines to crash: a refused commit falls back, a failed paint shows a message, a
// failed resolve drops the ghosts. Nothing gates on the handler, and an absent handler logs.
//
// Two axes route it, and neither is the code. `severity` splits a contract violation aimed at
// whoever wired the surface (`dev`) from a runtime failure an app counts (`error`). Every runtime
// code leaves the document as it found it except `commit-lost`, which leaves one field's store
// stale behind an optimistic view and is the only one with anything to say to the person typing.
//
// It is not the diagnostics channel: a `Diagnostic` is about the document and drawn on its field;
// an `EditorError` is about the surface and drawn nowhere. A refused scalar commit produces both,
// deliberately.
import type { DocPath } from './address.js';

/**
 * What failed. Stable strings rather than an enum: a consumer switches on them, and a new surface
 * adds a code without moving the ones an app handles.
 */
export type EditorErrorCode =
	/** A scalar/array/object write the boundary refused. Also pinned as a
	 *  diagnostic on its own field; editing continues, the value is unwritten. */
	| 'commit-refused'
	/** A prose commit whose op path the boundary refused: the leaf overwrote
	 *  the whole projection instead, so the store is correct and this field's
	 *  identity anchors were paid. */
	| 'commit-fallback'
	/** The overwrite fallback also failed, or the typed writer refused a `text` leaf's
	 *  text: the optimistic PM state stands and the store is stale for this
	 *  field. The one code here that leaves damage. */
	| 'commit-lost'
	/** A card operation (add, move, remove, retype) that threw. The document is
	 *  unchanged; the boundary's mutators are transactional. */
	| 'card-op-failed'
	/** `quill.validate` threw: this derive contributes no validation diagnostics. */
	| 'validate-failed'
	/** `quill.resolve` threw: ghosted `default:`s fall back to none for this derive. */
	| 'resolve-failed'
	/** A page paint the backend refused. The preview shows its error message state. */
	| 'paint-failed'
	/** A tip's markdown did not render: the tip shows as literal text. */
	| 'tip-render-failed'
	/**
	 * A prop a surface binds once was swapped in place, and the surface neither re-keyed on it nor
	 * observed it. `dev`: the fix is a remount at the call site. Also thrown, in a dev build, once
	 * reported; a swapped `onError` is itself a rebind, so the handler this arrives at may be the
	 * one just replaced (`rebind.svelte.ts`).
	 */
	| 'rebind-ignored'
	/**
	 * A landing named a card or a field the surface does not hold: a stale `cardId`, or a `DocPath`
	 * naming no declared field (an array element path included where the array is undeclared or
	 * unmounted). The call is a no-op. `dev`: the fix is at the call site, a host driving the
	 * instance verbs or a preview pick the editor has no field to route to. The preview never
	 * reports it: a field it places nothing for is `scrollToField` returning `false`.
	 */
	| 'target-unknown';

/** A failure a surface recovered from. */
export interface EditorError {
	code: EditorErrorCode;
	/**
	 * `error` is a runtime failure an app routes to telemetry; `dev` a contract violation aimed at
	 * whoever builds against the package.
	 */
	severity: 'error' | 'dev';
	/** English, for a log. Not for display: nothing here has a place on screen. */
	message: string;
	/** Whatever was thrown, unwrapped: a `QuillmarkError` arrives intact. */
	cause?: unknown;
	/** The field the failure belongs to, where it has one. */
	path?: DocPath;
	/** The page a paint failed on. */
	page?: number;
}

/** The `onError` hook every surface takes. */
export type EditorErrorHandler = (err: EditorError) => void;

/**
 * Report `err`, or log it when nothing is listening. A throwing handler is caught: every call site
 * sits on a recovery path where a second throw would undo the recovery.
 */
export function reportError(handler: EditorErrorHandler | undefined, err: EditorError): void {
	if (!handler) {
		console.error(`[quillmark/ui] ${err.code}: ${err.message}`, err.cause);
		return;
	}
	try {
		handler(err);
	} catch (e) {
		console.error(`[quillmark/ui] onError handler threw while reporting ${err.code}`, e);
	}
}

/** A thrown value's message, for the `message` field. */
export function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}
