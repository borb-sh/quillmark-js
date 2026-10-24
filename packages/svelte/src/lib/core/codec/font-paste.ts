// A pasted run keeps a family the registry holds. A word processor and a web page spell
// a run's face as a `<span>`'s inline `font-family`, which names whatever the source had
// installed; the schema's rule is static and reads only the `data-qm-font-family` this
// package writes (`schema.ts`), so this pass rewrites a span stating a registry family
// into that spelling before the parse, and leaves every other one to parse to nothing.
// An absolute `font-size` maps to no step and drops the same way.
import { Plugin } from 'prosemirror-state';
import { registryFamily } from './fonts.js';

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

/** The pass over every paste into a leaf, `families` read at the paste. */
export function fontPastePlugin(families: () => readonly string[]): Plugin {
	return new Plugin({ props: { transformPastedHTML: (html) => fontSpans(html, families()) } });
}
