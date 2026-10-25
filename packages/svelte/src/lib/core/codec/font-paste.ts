// A pasted run keeps a family the registry holds. A word processor and a web page spell
// a run's face as a `<span>`'s inline `font-family`, which names whatever the source had
// installed; the schema's rule is static and reads only the `data-qm-font-family` this
// package writes (`schema.ts`), so this pass rewrites a span stating a registry family
// into that spelling before the parse, and leaves every other one to parse to nothing.
import { Plugin } from 'prosemirror-state';
import type { FontRegistry } from './fonts.js';

/** The families of a CSS `font-family` value, unquoted, in order. */
export function cssFamilies(value: string): string[] {
	const out: string[] = [];
	for (const match of value.matchAll(
		/\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^,]+))\s*(?:,|$)/g
	)) {
		const name = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\\(.)/g, '$1').trim();
		if (name) out.push(name);
	}
	return out;
}

/** The registry's spelling of the first family in a CSS `font-family` value the
 *  registry holds, compared lowercased; `undefined` where it holds none. */
export function registryFamily(value: string, families: readonly string[]): string | undefined {
	for (const name of cssFamilies(value)) {
		const held = families.find((family) => family.toLowerCase() === name.toLowerCase());
		if (held) return held;
	}
	return undefined;
}

/** `html` with each `<span>` whose `font-family` the registry holds stating it as the
 *  schema reads it; `html` itself where none does. A span read off a cell or a heading
 *  would be that block's face, so only a span counts, as for the styled marks. */
export function fontSpans(html: string, families: readonly string[]): string {
	if (!families.length || !/font-family/i.test(html)) return html;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	let changed = false;
	for (const span of doc.body.querySelectorAll<HTMLElement>('span')) {
		if (span.hasAttribute('data-qm-font-family') || !span.style.fontFamily) continue;
		const family = registryFamily(span.style.fontFamily, families);
		if (!family) continue;
		span.setAttribute('data-qm-font-family', family);
		changed = true;
	}
	return changed ? doc.body.innerHTML : html;
}

/** The pass over every paste into a leaf, the registry read at the paste. */
export function fontPastePlugin(fonts: FontRegistry): Plugin {
	return new Plugin({
		props: { transformPastedHTML: (html) => fontSpans(html, fonts.families() ?? []) }
	});
}
