// The quill on screen, said in the address bar as `?quill=showcase@1.0.0`, the grammar
// `getQuill` takes. A query rather than a path segment: it needs no host rewrite rule, and
// relative resolution drops it, leaving the base the quiver is read off untouched.

/** The quill on screen. */
const QUILL = 'quill';

function asked(key: string): string | undefined {
	const at = new URLSearchParams(window.location.search).get(key)?.trim();
	return at === undefined || at === '' ? undefined : at;
}

/**
 * Point the address bar's `key` at `value`, or take it out where `value` is undefined.
 *
 * `replaceState` rather than a push: back means leave rather than unpick. Encoded save for
 * the `@`, which `URLSearchParams` would write as `%40`; the rest of the query is carried
 * verbatim.
 */
function say(key: string, value: string | undefined): void {
	const at = new URL(window.location.href);
	if ((at.searchParams.get(key) ?? undefined) === value) return;
	const rest = at.search
		.slice(1)
		.split('&')
		.filter((pair) => pair !== '' && pair.split('=')[0] !== key);
	if (value !== undefined) rest.push(`${key}=${encodeURIComponent(value).replaceAll('%40', '@')}`);
	const search = rest.length ? `?${rest.join('&')}` : '';
	window.history.replaceState(window.history.state, '', `${at.pathname}${search}${at.hash}`);
}

/** The quill the URL asks for, or undefined. A selector (`showcase`, `showcase@1.0`) is
 *  resolved through the quiver, not parsed here. */
export function askedRef(): string | undefined {
	return asked(QUILL);
}

/** Point the address bar at `ref`, canonical. */
export function sayRef(ref: string): void {
	say(QUILL, ref);
}
