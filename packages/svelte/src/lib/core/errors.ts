// The error channel: what a surface reports when it recovered from a failure.
//
// Every site behind these codes declines to crash: a refused commit falls back, a
// failed paint shows a message, a failed resolve drops the ghosts. The hook exists
// because a `console.error` is not something an app can route, filter or count.
// Nothing gates on the handler, and an absent handler logs.
//
// **Two axes route it, and neither is the code.** `severity` splits a contract
// violation aimed at whoever wired the surface (`dev`) from a runtime failure an app
// counts (`error`). Damage splits the runtime ones: every code below leaves the
// document as it found it except `commit-lost`, which leaves one field's store stale
// behind an optimistic view. So `commit-lost` is the only one with anything to say to
// the person typing, and the rest are telemetry.
//
// It is not the diagnostics channel. A `Diagnostic` is about the document and is
// drawn on the field it belongs to; an `EditorError` is about the surface and is
// drawn nowhere. A refused scalar commit produces both, deliberately: the
// diagnostic pins to the field, the error reaches the app's sink.
import type { DocPath } from './address.js';

/**
 * What failed. Stable strings rather than an enum: a consumer switches on them,
 * and a new surface adds a code without moving the ones an app already handles.
 */
export type EditorErrorCode =
	/** A scalar/array/object write the boundary refused. Also pinned as a
	 *  diagnostic on its own field; editing continues, the value is unwritten. */
	| 'commit-refused'
	/** A prose commit whose op path the boundary refused: the leaf overwrote
	 *  the whole projection instead, so the store is correct and this field's
	 *  identity anchors were paid. */
	| 'commit-fallback'
	/** The overwrite fallback also failed, or the typed writer refused a `plaintext`
	 *  leaf's text: the optimistic PM state stands and the store is stale for this
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
	 * A prop a surface binds once was swapped in place, and the surface neither
	 * re-keyed on it nor observed it. The mounted surface still names the previous
	 * handle. `dev` throughout: the fix is a remount at the call site, so this is
	 * aimed at whoever wired it and never at a running app's telemetry.
	 *
	 * The one code that is also thrown, in a dev build, once reported: a swapped
	 * `onError` is itself a rebind, so the handler this arrives at may be the one the
	 * consumer just replaced (`rebind.svelte.ts`).
	 */
	| 'rebind-ignored'
	/**
	 * A landing named a card or a field the surface does not hold: a `cardId` from a
	 * previous session or an already-removed card, or a `DocPath` naming no declared
	 * field — an array element path included, where the array itself is undeclared or
	 * unmounted. The call is a no-op and the document is untouched.
	 *
	 * `dev`, because the fix is at the call site: a host driving the instance verbs
	 * from outside, or a preview pick the editor has no field to route to. Every
	 * mounted field is a target, prose leaf and form control alike, and an array's
	 * elements are targets through it, so this is not how a scalar or an element
	 * reports. The preview never reports it at all: a field it places nothing for is
	 * `scrollToField` returning `false`.
	 */
	| 'target-unknown';

/** A failure a surface recovered from. */
export interface EditorError {
	code: EditorErrorCode;
	/**
	 * `error` is a runtime failure an app routes to telemetry; `dev` is a contract
	 * violation aimed at whoever is building against the package. Without the
	 * split every consumer's sink filters the dev codes by hand.
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
 * Report `err`, or log it when nothing is listening: a failure the package
 * recovered from is worth seeing in a console.
 *
 * A throwing handler is the consumer's bug and must not become the package's: it
 * is caught, because every call site sits on a recovery path where a second throw
 * would undo the recovery.
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
