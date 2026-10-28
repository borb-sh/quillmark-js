// The diagnostics, merged: the schema's verdict, the compile, the `conform::*` set a repack
// stranded and what the last emit refused overlap, so the set is deduplicated before the
// editor routes it by `path`. A `location` names the quill's source and is read off the
// compile-failure strip; a diagnostic carrying neither reaches nothing.
import { isQuillmarkError, type Diagnostic, type Location } from '@quillmark/wasm';

/** A source address, as an author's editor spells one. */
export const placeOf = (at: Location): string => `${at.file}:${at.line}:${at.column}`;

/** What makes two diagnostics the same one: one message at two lines of a plate is two. */
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
 * A throw as diagnostics: a `QuillmarkError`'s whole set, else one carrying the message.
 */
export function diagnosticsOf(err: unknown): Diagnostic[] {
	if (isQuillmarkError(err) && err.diagnostics.length > 0) return err.diagnostics;
	return [{ severity: 'error', message: messageOf(err) }];
}
