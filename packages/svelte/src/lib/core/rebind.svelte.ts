// The remount contract, enforced. `Preview` binds its props once, when its container
// mounts, and observes nothing after: the vanilla core below it owns scroll position,
// mounted slots and observer sets that a remount would discard on every apply. So a
// prop swapped in place is reported, not dropped in silence, and thrown in a dev build.
//
// A guard over one prop of a set is worse than none: a consumer who learns the
// surface complains when it ignores a prop reads silence on the rest as reactivity.
// The snapshot is every once-bound prop, and one report names whichever went stale.
import { reportError, type EditorErrorHandler } from './errors.js';

// True in a dev build whose bundler injects `import.meta.env`. Cast, since the package
// declares no bundler's ambient types; false where nothing injects it, so a toolchain
// that does not answer gets the report alone.
const DEV = (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

/** The once-bound props by name, `onError` among them. */
export type Bound = Record<string, unknown> & { onError?: EditorErrorHandler };

/**
 * Report the violation, then throw it in a dev build. Both surfaces raise it here; the
 * guards themselves stay separate, since the preview snapshots its props once and the
 * editor re-reads its pair on every re-key.
 *
 * The report alone reaches whoever bound `onError` at mount, and a consumer swapping
 * that handler beside the handle it belongs to is the case this exists for: they are
 * told through the sink they just abandoned. A throw needs no handler to arrive.
 *
 * It costs the surface nothing: an effect that throws neither unmounts its tree nor
 * stops the ones beside it, so the surface goes on serving what it bound, which is the
 * very state being reported.
 */
export function reportRebindIgnored(
	onError: EditorErrorHandler | undefined,
	message: string
): void {
	reportError(onError, { code: 'rebind-ignored', severity: 'dev', message });
	if (DEV) throw new Error(`[quillmark/ui] rebind-ignored: ${message}`);
}

/**
 * Report `rebind-ignored` once, at `dev`, when any prop `snapshot` names is swapped
 * in place, and in a dev build throw it after. `remount` closes the message with the
 * surface's own remount spelling (`Remount the preview ({#key session}) to rebind.`).
 *
 * Mounted identities are recorded on the effect's first run, the flush the surface
 * binds in; every later comparison reads them through the same `snapshot`.
 *
 * The report goes to the snapshot's `onError`: every other error these surfaces
 * report reaches the handler they bound, and a swapped `onError` is itself one of
 * the reports.
 */
export function guardRebind(snapshot: () => Bound, remount: string): void {
	let mounted: Bound | undefined;
	let reported = false;
	$effect(() => {
		const live = snapshot();
		if (mounted === undefined) {
			mounted = live;
			return;
		}
		if (reported) return;
		const bound = mounted;
		const stale = Object.keys(bound).filter((k) => live[k] !== bound[k]);
		if (stale.length === 0) return;
		reported = true;
		reportRebindIgnored(
			bound.onError,
			`${stale.join(', ')} swapped in place; the mounted surface still holds what it bound at mount. ${remount}`
		);
	});
}
