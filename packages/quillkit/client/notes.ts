// The diagnostics, merged. Four producers say something about the document in hand — the
// schema's verdict, the compile, the `conform::*` set a repack stranded, and what the last
// emit refused — and one field's one problem should read as one thing, so the merged set
// is deduplicated before it reaches the editor that routes it.
//
// Routing is by `path`, the document's own address space: a diagnostic carrying one
// reaches the control it is about. A diagnostic carrying `location` instead names a file,
// a line and a column in the quill's source, which routes to no control and is read off
// the compile-failure strip. One carrying neither reaches nothing.
import { isQuillmarkError, type Diagnostic, type Location } from '@quillmark/wasm';

/** A source address, as an author's editor spells one. */
export const placeOf = (at: Location): string => `${at.file}:${at.line}:${at.column}`;

/** What makes two diagnostics the same one. The producers overlap by design. Both
 *  address spaces are in the key: one message raised at two lines of a plate is two
 *  problems. */
const key = (d: Diagnostic): string =>
	`${d.severity} ${d.code ?? ''} ${d.path ?? ''} ${d.location ? placeOf(d.location) : ''} ${d.message}`;

/** Every producer's diagnostics as one set: deduplicated, producer order. */
export function collect(sources: readonly (readonly Diagnostic[])[]): Diagnostic[] {
	const seen = new Map<string, Diagnostic>();
	for (const diags of sources)
		for (const diag of diags) {
			const k = key(diag);
			if (!seen.has(k)) seen.set(k, diag);
		}
	return [...seen.values()];
}

export function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * A throw as diagnostics. A `QuillmarkError` carries every diagnostic and a broken plate
 * is the case that matters, so the whole set is unwrapped rather than reported as one
 * line; anything else becomes a single diagnostic carrying its message.
 */
export function diagnosticsOf(err: unknown): Diagnostic[] {
	if (isQuillmarkError(err) && err.diagnostics.length > 0) return err.diagnostics;
	return [{ severity: 'error', message: messageOf(err) }];
}
