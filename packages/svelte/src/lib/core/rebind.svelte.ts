// The remount contract, enforced. `Preview` binds its props once, at mount, and observes nothing
// after: the vanilla core below it owns scroll position, mounted slots and observer sets that a
// remount would discard. So a prop swapped in place is reported, and thrown in a dev build.
//
// A guard over part of a set teaches a consumer to read silence on the rest as reactivity, so the
// snapshot is every once-bound prop and one report names whichever went stale.
import { DEV } from 'esm-env';
import { reportError, type EditorErrorHandler } from './errors.js';

/** The once-bound props by name, `onError` among them. */
export type Bound = Record<string, unknown> & { onError?: EditorErrorHandler };

/**
 * Report the violation, then throw it in a dev build. Both surfaces raise it here; their guards
 * stay separate, since the preview snapshots its props once and the editor re-reads its pair on
 * every re-key.
 *
 * The report alone reaches whoever bound `onError` at mount, so a consumer swapping that handler
 * beside its handle is told through the sink they just abandoned; a throw needs no handler. The
 * throw costs nothing: an effect that throws neither unmounts its tree nor stops its neighbours.
 */
export function reportRebindIgnored(
	onError: EditorErrorHandler | undefined,
	message: string
): void {
	reportError(onError, { code: 'rebind-ignored', severity: 'dev', message });
	if (DEV) throw new Error(`[quillmark/ui] rebind-ignored: ${message}`);
}

/**
 * Report `rebind-ignored` once, at `dev`, when any prop `snapshot` names is swapped in place, and
 * in a dev build throw it after. `remount` closes the message with the surface's own remount
 * spelling. Mounted identities are recorded on the effect's first run. The report goes to the
 * snapshot's `onError`, which a swap is itself one of the reports for.
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
