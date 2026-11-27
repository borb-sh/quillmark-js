// The quill on screen, said in the address bar as `?quill=showcase@1.0.0`, the grammar
// `getQuill` takes. A query rather than a path segment: it needs no host rewrite rule, and
// relative resolution drops it, leaving the base the quiver is read off untouched.

const QUILL = 'quill';

/** The quill the URL asks for, or undefined. A selector (`showcase`, `showcase@1.0`) is
 *  resolved through the quiver, not parsed here. */
export function askedRef(): string | undefined {
	const at = new URLSearchParams(window.location.search).get(QUILL)?.trim();
	return at === undefined || at === '' ? undefined : at;
}

/**
 * Point the address bar at `ref`, canonical.
 *
 * `replaceState` rather than a push: back means leave rather than unpick. Encoded save for
 * the `@`, which `URLSearchParams` would write as `%40`; the rest of the query is carried
 * verbatim.
 */
export function sayRef(ref: string): void {
	const at = new URL(window.location.href);
	if (at.searchParams.get(QUILL) === ref) return;
	const rest = at.search
		.slice(1)
		.split('&')
		.filter((pair) => pair !== '' && pair.split('=')[0] !== QUILL);
	rest.push(`${QUILL}=${encodeURIComponent(ref).replaceAll('%40', '@')}`);
	window.history.replaceState(
		window.history.state,
		'',
		`${at.pathname}?${rest.join('&')}${at.hash}`
	);
}
