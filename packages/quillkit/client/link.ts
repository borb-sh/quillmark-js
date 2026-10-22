// The quill on screen, said in the address bar. A reader who followed a link to a quiver
// is one link from being sent to a quill in it, which is the whole of what this is for:
// `?quill=showcase@1.0.0`, the grammar `getQuill` already takes. A template is the other
// thing a link sends a reader to: `?template=army_memo` opens that starter document, and
// the quill it names stands beside it.
//
// A query rather than a path segment: a deploy is static files behind whatever host the
// author has, and a query participates in no file resolution, where a path would be a
// rewrite rule to arrange per host. Relative resolution drops it too, so the base the
// client reads its quiver off (`quiver.ts`) is untouched by what stands here.

/** The quill on screen. */
const QUILL = 'quill';
/** The template the document on screen opened from. */
const TEMPLATE = 'template';

function asked(key: string): string | undefined {
	const at = new URLSearchParams(window.location.search).get(key)?.trim();
	return at === undefined || at === '' ? undefined : at;
}

/**
 * Point the address bar's `key` at `value`, or take it out where `value` is undefined.
 *
 * `replaceState` rather than a push: studio is one screen, and back means leave rather
 * than unpick.
 *
 * Encoded save for the `@`. A canonical ref is `[a-z][a-z0-9_]*@x.y.z`, and
 * `URLSearchParams` would serialize the `@` into a link carrying `%40` in the middle of
 * the ref, where a query admits it as it stands. Whatever else the query holds is carried
 * verbatim for the converse reason: studio did not write it, so it does not get
 * re-encoded on the way through.
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

/** The quill the URL asks for, or undefined where it asks for none. A selector is a ref
 *  (`showcase`, `showcase@1.0`), so what comes back is resolved through the quiver rather
 *  than parsed here. */
export function askedRef(): string | undefined {
	return asked(QUILL);
}

/** Point the address bar at `ref`, canonical. */
export function sayRef(ref: string): void {
	say(QUILL, ref);
}

/** The template the URL asks for, by its link name (`templates.ts`), or undefined. */
export function askedTemplate(): string | undefined {
	return asked(TEMPLATE);
}

/** Point the address bar at the template `name`, or take the template out of it. */
export function sayTemplate(name: string | undefined): void {
	say(TEMPLATE, name);
}
