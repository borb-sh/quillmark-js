// Diagnostics routing (VISUAL_EDITOR §Diagnostics). Pure merge + route
// of the three producers into a `Map<fieldKey, Diagnostic[]>` the card tree
// reads. No runes, no Document: VisualEditor.svelte's `$derived.by` re-runs
// this from its revision counter + the three raw sources, mirroring
// structure.ts's split of pure projection math from reactive orchestration.
//
// Three producers (VISUAL_EDITOR §Diagnostics):
// 1. `quill.validate(doc)`: `Diagnostic[]`, `.path` a canonical `DocPath`.
//      Routed here by `routeAndResolve`, errors only.
// 2. Local commit errors: a `writer.set`/`writer.card(i).set` throw at
//      commit time (VisualEditor's `commitScalar`). The editor knows the exact
//      field/card being committed, so these are keyed directly at the call site
//      with a `FieldKey`; never parsed from a message. The thrown
//      `QuillmarkError`'s `diagnostics[0]` carries `code` and a canonical `path`
//      (`edit::field_coercion_failed` / `edit::unknown_field`), so the editor surfaces that
//      diagnostic verbatim under its own id-keyed address.
// 3. External diagnostics: the consumer-supplied `diagnostics?: Diagnostic[]`
//      prop (`LiveSession.warnings` + render errors via `FieldRegion.field`),
//      routed by `.path` like #1, errors only.
//
// Field-key space. Two addressing schemes meet here: producers #1/#3 speak the
// canonical `DocPath` string (`main.<field>` / `main.body` /
// `cards.<kind>[<i>].<field>`, `<i>` the absolute document-array index:
// `Diagnostic.path`, `ContentHit.field`, and `FieldRegion.field` all share this
// one grammar). Routing runs on the boundary's own `parseDocPath`, not a
// hand-rolled parser. The editor's own addressing (VisualEditor's
// `commitScalar`, the `leaves` registry) is stable-id keyed so a diagnostic stays
// pinned to the right card across a reorder (VISUAL_EDITOR §"The address is the
// spine"); `resolveCardKey` bridges the absolute index → stable id, and
// `fieldKeyToString` is the one shared string form both sides collapse to for the
// `Map`.
import type { Diagnostic, PathStep } from '@quillmark/wasm';
import { nearestAddrForFieldPath, nestedAddrForFieldPath } from '../core/address.js';

/** A field's routing address, and `/core`'s `Addr` structurally: an `Addr` is a
 * positional `FieldKey`, so `nearestAddrForFieldPath` is the path→key walk and
 * routing carries no second copy of the grammar. `card` is `undefined` for the main
 * card; a composable card slot is a stable session id (the editor's own bookkeeping)
 * once resolved, or an absolute document-array index straight off a parsed `DocPath`
 * (resolve via {@link resolveCardKey} before merging with id-keyed sources). `field`
 * `undefined` addresses the body (the field-less leaf). */
export interface FieldKey {
	card?: string | number;
	field?: string;
}

/** Canonical string key for a `FieldKey`: the routing `Map`'s key space. */
export function fieldKeyToString(k: FieldKey): string {
	return `${k.card ?? 'main'}:${k.field ?? '$body'}`;
}

/**
 * Resolve a positional `FieldKey` (an absolute document-array index, straight off
 * `addrForFieldPath`) to the editor's stable-id keying using the live `cardIds`
 * array: re-resolved fresh on every call (never cached), the same "resolve only
 * at the point of use" discipline `cardIndexOf` applies to writes (VISUAL_EDITOR
 * §"The address is the spine"). A key already id-keyed (`card` a string) or main
 * (`card` undefined) passes through unchanged. `undefined` when the index is out
 * of the current card array: the diagnostic is dropped rather than mis-routed.
 */
export function resolveCardKey(key: FieldKey, cardIds: readonly string[]): FieldKey | undefined {
	if (typeof key.card !== 'number') return key;
	const id = key.card >= 0 && key.card < cardIds.length ? cardIds[key.card] : undefined;
	return id != null ? { card: id, field: key.field } : undefined;
}

/** One diagnostic paired with the `FieldKey` it targets. */
export interface RoutedDiagnostic {
	key: FieldKey;
	diagnostic: Diagnostic;
}

/**
 * Route a path-keyed producer's raw `Diagnostic[]` (validate / external) to the
 * editor's stable-id keying: the one door producers #1/#3 take,
 * `nearestAddrForFieldPath` and `resolveCardKey` in a single pass. Warnings do not
 * draw (VISUAL_EDITOR §Diagnostics): obligation, completeness, a render note — none
 * of them is a value the field cannot hold. An anchor deeper than a commit address
 * (`main.contact.email`, `main.keywords[0]`) draws at the nearest field holding it,
 * whose subform or repeater draws that leaf. An entry drops rather than mis-routes
 * when it carries no `path`, when no prefix of the path is addressable, or when its
 * absolute card index is out of the live `cardIds`.
 * Completeness stays a read the host makes on `quill.validate(doc)`.
 */
export function routeAndResolve(
	diagnostics: Diagnostic[] | undefined,
	cardIds: readonly string[]
): RoutedDiagnostic[] {
	const out: RoutedDiagnostic[] = [];
	for (const d of diagnostics ?? []) {
		if (d.severity !== 'error' || !d.path) continue;
		const key = nearestAddrForFieldPath(d.path);
		const resolved = key && resolveCardKey(key, cardIds);
		if (resolved) out.push({ key: resolved, diagnostic: d });
	}
	return out;
}

// ── Inside a field ──────────────────────────────────────────────────────────
// Routing lands a diagnostic on the field that holds it (`nearestAddrForFieldPath`:
// an `Addr` reaches a root and one field and no deeper). What the field then does
// with it is a second walk, down the steps the path carries past the field: a
// container hands each diagnostic to the cell its next step names, and draws at its
// own foot the ones naming a step it does not hold. So `main.contact.email` draws under
// the email cell, `main.revisions[0].pages` under the pages cell of an open row and
// under the row's head while it is collapsed, and nothing is lost on the way down
// (VISUAL_EDITOR §Diagnostics).

/** A diagnostic with the steps still to walk from the control holding it. */
export interface DeepDiagnostic {
	steps: readonly PathStep[];
	diagnostic: Diagnostic;
}

/** A field's routed diagnostics, each with its steps past the field: none for a
 *  diagnostic anchored at the field itself, or one whose path is not a nested one
 *  (a local commit error carries the field's own path). */
export function deepen(diagnostics: Diagnostic[] | undefined): DeepDiagnostic[] {
	return (diagnostics ?? []).map((d) => ({
		steps: (d.path && nestedAddrForFieldPath(d.path)?.steps) || [],
		diagnostic: d
	}));
}

/** One rung of the walk: the diagnostics anchored here, and the rest bucketed by the
 *  step they take next, each with that step consumed. */
export interface DeepSplit {
	here: Diagnostic[];
	below: Map<PathStep, DeepDiagnostic[]>;
}

export function splitDeep(list: readonly DeepDiagnostic[] | undefined): DeepSplit {
	const here: Diagnostic[] = [];
	const below = new Map<PathStep, DeepDiagnostic[]>();
	for (const d of list ?? []) {
		if (d.steps.length === 0) {
			here.push(d.diagnostic);
			continue;
		}
		const [step, ...rest] = d.steps;
		const bucket = below.get(step);
		const next = { steps: rest, diagnostic: d.diagnostic };
		if (bucket) bucket.push(next);
		else below.set(step, [next]);
	}
	return { here, below };
}

/** The diagnostics a rung cannot hand down: the ones anchored here, plus every one
 *  whose next step names nothing in `held`. Drawn at the rung's own foot, so a leaf the
 *  tree does not draw still has its message read somewhere the user can see. */
export function unrouted(split: DeepSplit, held: (step: PathStep) => boolean): Diagnostic[] {
	const out = [...split.here];
	for (const [step, list] of split.below)
		if (!held(step)) for (const d of list) out.push(d.diagnostic);
	return out;
}

/**
 * Merge N routed groups into `Map<fieldKeyToString(key), Diagnostic[]>`.
 * Dedupes an identical `(path, severity, message)` quad landing on the same key from
 * more than one group (e.g. the same error present in both `validate()` and
 * an external feed). Producer order within a key.
 *
 * The key is the field, but the walk past it is the `path`'s ({@link deepen}), so two
 * cells of one container share a key and differ only there: without `path` in the
 * quad, one message failing two rows draws on the first row alone.
 */
export function mergeDiagnostics(...groups: RoutedDiagnostic[][]): Map<string, Diagnostic[]> {
	const byKey = new Map<string, Diagnostic[]>();
	const seen = new Set<string>();
	for (const group of groups) {
		for (const { key, diagnostic } of group) {
			const k = fieldKeyToString(key);
			// Collision-proof key: JSON-encode the quad so arbitrary `message` text
			// can never merge two distinct quads into one (a real diagnostic dropped).
			const dedupeKey = JSON.stringify([
				k,
				diagnostic.path ?? null,
				diagnostic.severity,
				diagnostic.message
			]);
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
			const arr = byKey.get(k);
			if (arr) arr.push(diagnostic);
			else byKey.set(k, [diagnostic]);
		}
	}
	return byKey;
}
