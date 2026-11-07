// What the docs claim, against what the tree holds: a sentence that stops being true without
// anything failing. Zero deps; run via `npm run check:docs`.
//
// A `<DOC> §<Section>` reference resolves, from anywhere in the tree — which is the half of
// a cross-reference that rots: a heading is renamed in the commit that earns it, and the
// pointers to it sit in four other packages and in the gates' own failure messages, where
// nothing looks. Every `.md` the walk finds is a target, keyed by filename, so a pointer at
// a name the workspace does not carry is a finding rather than a skip, and a new doc is
// addressable the moment it lands. A section is a heading or a rule's bold lead, so a
// pointer can name one rule on an invariants page. A bare name resolves to the citing
// package's own file first, then to the one file in the workspace that carries it; a name
// several packages carry, as every `INVARIANTS` does, is qualified with the package's
// directory (`quiver/INVARIANTS §…`) from anywhere else. The sibling quillmark repo is
// qualified as `quillmark/` and passes through untouched, since its tree is not here.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { ROOT, packages, report } from './workspace.mjs';

/** The sibling repo's qualifier: a pointer under it names a doc this tree does not hold. */
const SIBLING = 'quillmark';
const PACKAGES = packages().map((p) => p.dir);

/** `<DOC> §<Section>`, quoted or bare, with an optional `.md` on the name and an optional
 *  `<package>/` before it. Stops at the first character no heading can carry, so a
 *  reference running on into prose is caught by the word-prefix test rather than here. */
const POINTER = new RegExp(
	`(?:\\b(${[...PACKAGES, SIBLING].join('|')})/)?\\b([A-Z][A-Z_]{2,})(?:\\.md)?\\s*§\\s*(?:"([^"]+)"|([A-Za-z][\\w ;-]*))`,
	'g'
);

const SCANNED = /\.(ts|svelte|css|mjs|md)$/;
const SKIP = new Set(['node_modules', 'dist', 'build', 'site', '.git', '.svelte-kit', 'static']);

function* tree(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
		a.name < b.name ? -1 : 1
	)) {
		if (SKIP.has(entry.name)) continue;
		const at = join(dir, entry.name);
		if (entry.isDirectory()) yield* tree(at);
		else if (SCANNED.test(entry.name)) yield at;
	}
}

/** A heading or a reference as comparable words: unstyled, unpunctuated, lowercase. */
const words = (text) =>
	text
		.toLowerCase()
		.replace(/[`*"]/g, '')
		.split(/[\s—–-]+/)
		.map((w) => w.replace(/[^\w']+$/, ''))
		.filter(Boolean);

/** True when one word list is a prefix of the other: a reference may name a heading's
 *  opening words, or run on into the sentence around it. */
function aligns(a, b) {
	const [short, long] = a.length <= b.length ? [a, b] : [b, a];
	return short.every((w, i) => w === long[i]);
}

/** The package a repo-relative path sits in, or `null` outside `packages/`. */
const packageOf = (rel) => rel.match(/^packages\/([^/]+)\//)?.[1] ?? null;

const errors = [];
const files = [...tree(ROOT)];

/** Each doc's sections, as word lists: its headings, and the bold lead a rule opens on. */
const docs = files
	.filter((f) => f.endsWith('.md'))
	.map((abs) => {
		const rel = relative(ROOT, abs);
		const text = readFileSync(abs, 'utf8');
		const sections = [
			...text.matchAll(/^#+\s+(.+)$/gm),
			...text.matchAll(/^(?:- )?\*\*(.+?)\*\*/gm)
		].map((m) => words(m[1]));
		return { name: basename(abs, '.md'), rel, pkg: packageOf(rel), sections };
	});

/** The one doc a pointer names, or the reason it names none. */
function resolve(doc, qualifier, from) {
	const named = docs.filter((d) => d.name === doc);
	if (!named.length) return `\`${doc} §…\` — no such doc in this workspace`;
	const scope = qualifier ?? from;
	const scoped = scope ? named.filter((d) => d.pkg === scope) : [];
	if (qualifier && !scoped.length)
		return `\`${qualifier}/${doc} §…\` — ${qualifier} carries no ${doc}.md`;
	const candidates = scoped.length ? scoped : named;
	if (candidates.length > 1)
		return (
			`\`${doc} §…\` names ${candidates.length} files (${candidates.map((d) => d.rel).join(', ')}); ` +
			`qualify it with the package, as \`<package>/${doc} §…\``
		);
	return candidates[0];
}

let pointers = 0;
for (const abs of files) {
	const rel = relative(ROOT, abs);
	readFileSync(abs, 'utf8')
		.split('\n')
		.forEach((line, i) => {
			for (const [, qualifier, doc, quoted, bare] of line.matchAll(POINTER)) {
				if (qualifier === SIBLING) continue;
				const target = resolve(doc, qualifier, packageOf(rel));
				if (typeof target === 'string') {
					errors.push(`${rel}:${i + 1}: ${target}`);
					continue;
				}
				pointers++;
				const ref = words(quoted ?? bare);
				if (!target.sections.some((h) => aligns(ref, h)))
					errors.push(
						`${rel}:${i + 1}: ${target.rel} has no section \`${(quoted ?? bare).trim()}\``
					);
			}
		});
}

report(
	'Docs check',
	errors,
	`Docs OK — ${pointers} section pointers resolved across ${docs.length} docs.`
);
