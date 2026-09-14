// The quill on screen, said in the address bar. A reader who followed a link to a quiver
// is one link from being sent to a quill in it, which is the whole of what this is for:
// `?quill=showcase@1.0.0`, the grammar `getQuill` already takes.
//
// A query rather than a path segment: a deploy is static files behind whatever host the
// author has, and a query participates in no file resolution, where a path would be a
// rewrite rule to arrange per host. Relative resolution drops it too, so the base the
// client reads its quiver off (`quiver.ts`) is untouched by what stands here.

/** Studio's one key. */
const PARAM = 'quill';

/** What the URL asks for, or undefined where it asks for nothing. A selector is a ref
 *  (`showcase`, `showcase@1`), so what comes back is resolved through the quiver rather
 *  than parsed here. */
export function askedRef(): string | undefined {
	const asked = new URLSearchParams(window.location.search).get(PARAM)?.trim();
	return asked === undefined || asked === '' ? undefined : asked;
}

/**
 * Point the address bar at `ref`, canonical.
 *
 * `replaceState` rather than a push: studio is one screen, and back means leave rather
 * than unpick.
 *
 * Written as it is spelled everywhere else. A canonical ref is `[A-Za-z0-9_-]+@x.y.z`,
 * every character of which a query admits, and `URLSearchParams` would serialize the `@`
 * into a link carrying `%40` in the middle of the ref. Whatever else the query holds is
 * carried verbatim for the converse reason: studio did not write it, so it does not get
 * re-encoded on the way through.
 */
export function sayRef(ref: string): void {
	const at = new URL(window.location.href);
	if (at.searchParams.get(PARAM) === ref) return;
	const rest = at.search
		.slice(1)
		.split('&')
		.filter((pair) => pair !== '' && pair.split('=')[0] !== PARAM);
	const search = [...rest, `${PARAM}=${ref}`].join('&');
	window.history.replaceState(window.history.state, '', `${at.pathname}?${search}${at.hash}`);
}
