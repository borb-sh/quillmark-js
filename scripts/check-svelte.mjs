// The Svelte 5 forms (ARCHITECTURE §"Core vs chrome"): where Svelte 5 names a successor to a
// Svelte 4 idiom, the successor is what the code writes. Forced runes mode holds half of it —
// `export let`, `$:`, `$$props`, `$$restProps` and the `beforeUpdate` pair are compile errors,
// so the compiler is their gate and this one does not restate them. The rest still compile,
// some with a warning svelte-check prints and never fails on, so they are a table here, read
// as text over every package that depends on `svelte`, build output aside. Comments are
// blanked first, so prose naming a form is not the form. Zero deps; run via
// `npm run check:svelte`.
//
//   class:  use:  on:  <slot>        a component's markup, its script and style blanked, so a
//                                    `class: className` destructuring is not a directive
//   createEventDispatcher,           any source
//   svelte/store, svelte/legacy
//   document/window listeners        a component; the framework-free cores (`core/`, the
//                                    preview's paint loop) are `.ts` and keep their own
//   new Map / new Set in $state      a rune-bearing file: the textual half of the collection
//                                    rule. A collection reaching `$state` by any other path,
//                                    and an `$effect` writing state a writable `$derived`
//                                    would hold, are review's
//   import.meta.env                  the library's source, which a consumer's bundler compiles
//                                    and need not define; an app is built by the Vite config
//                                    that defines it, so the apps are outside it
//
// Every finding fails the run, though each shows in a diff: a warning is for a rule whose
// subject is still moving, and this one admits no exception for review to weigh.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ROOT, filesUnder, packages, report } from './workspace.mjs';

const DOC = 'ARCHITECTURE §"Core vs chrome"';

/** Each form, the files it is looked for in, and whether a component's markup alone is read. */
const RULES = [
	{
		what: '`class:` directive',
		form: "the `class` attribute's object or array form",
		files: /\.svelte$/,
		markup: true,
		re: /(?<=\s)class:[\w$]/g
	},
	{
		what: '`use:` action',
		form: '`{@attach}`',
		files: /\.svelte$/,
		markup: true,
		re: /(?<=\s)use:[\w$]/g
	},
	{
		what: '`on:` directive',
		form: 'an event attribute, `onclick={…}`',
		files: /\.svelte$/,
		markup: true,
		re: /(?<=\s)on:[\w$]/g
	},
	{
		what: '`<slot>`',
		form: 'a snippet prop and `{@render}`',
		files: /\.svelte$/,
		markup: true,
		re: /<slot\b/g
	},
	{
		what: '`createEventDispatcher`',
		form: 'a callback prop',
		files: /./,
		re: /\bcreateEventDispatcher\b/g
	},
	{
		what: '`svelte/store`',
		form: 'runes: `$state`, `$derived`, a class with reactive fields',
		files: /./,
		re: /['"]svelte\/store['"]/g
	},
	{
		what: '`svelte/legacy`',
		form: 'the rune or snippet the shim stands in for',
		files: /./,
		re: /['"]svelte\/legacy['"]/g
	},
	{
		what: '`addEventListener` on `document` or `window` in a component',
		form: '`<svelte:document>` / `<svelte:window>`',
		files: /\.svelte$/,
		re: /\b(document|window)\.addEventListener\b/g
	},
	{
		what: '`Map` or `Set` in `$state`',
		form: '`SvelteMap` / `SvelteSet` from `svelte/reactivity`',
		files: /\.svelte(\.[jt]s)?$/,
		re: /\$state(\.raw)?\s*(<[^;]{0,200}?>)?\s*\(\s*new\s+(Map|Set)\b/g
	},
	{
		what: '`import.meta.env` in the library',
		form: '`esm-env`',
		files: /^packages\/svelte\/src\/lib\//,
		re: /\bimport\.meta\.env\b/g
	}
];

/** `text` with every match of `re` replaced by its own newlines, so a line number read off
 *  the result is the source's. */
const blank = (text, re) => text.replace(re, (m) => m.replace(/[^\n]/g, ''));
/** Comments blanked in the three shapes these sources carry them. The line form is guarded
 *  on what precedes it, so a `https://` in a url is not a comment. */
const decomment = (text) =>
	blank(blank(text, /<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g), /(?<=^|[^:\w])\/\/[^\n]*/gm);
const markupOf = (text) => blank(text, /<(script|style)\b[\s\S]*?<\/\1>/g);

const SVELTE = packages().filter(({ json }) =>
	['dependencies', 'devDependencies', 'peerDependencies'].some((f) => json[f]?.svelte)
);

const errors = [];
let components = 0;
let modules = 0;
for (const { at } of SVELTE)
	for (const file of filesUnder(at, /\.(svelte|[cm]?[jt]s)$/, {
		names: ['dist', 'build', 'public', 'static']
	})) {
		const rel = relative(ROOT, file);
		if (rel.endsWith('.svelte')) components++;
		else modules++;
		const code = decomment(readFileSync(file, 'utf8'));
		const markup = rel.endsWith('.svelte') ? markupOf(code) : '';
		for (const { what, form, files, markup: inMarkup, re } of RULES) {
			if (!files.test(rel)) continue;
			const text = inMarkup ? markup : code;
			for (const m of text.matchAll(re)) {
				const line = text.slice(0, m.index).split('\n').length;
				errors.push(`${rel}:${line}: ${what} — ${form} (${DOC})`);
			}
		}
	}

report(
	'Svelte 5 check',
	errors,
	`Svelte 5 OK — ${components} components and ${modules} modules across ${SVELTE.length} packages, none in a Svelte 4 form.`
);
