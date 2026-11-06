// What the docs claim, against what the tree holds: a sentence that stops being true without
// anything failing. Zero deps; run via `npm run check:docs`.
//
// A `<DOC> §<Section>` reference resolves, from anywhere in the tree — which is the half of
// a cross-reference that rots: a heading is renamed in the commit that earns it, and the
// pointers to it sit in four other packages and in the gates' own failure messages, where
// nothing looks. Every `.md` the walk finds is a target, keyed by filename, so a pointer at
// a name the workspace does not carry is a finding rather than a skip, and a new doc is
// addressable the moment it lands. A name two files answer to addresses neither, its
// headings being the union of both, so citing one is a finding and a collision nothing cites
// stands. The sibling quillmark repo's canon is cited by filename and never with a section,
// so it passes through untouched.

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { ROOT, report } from './workspace.mjs';

/** `<DOC> §<Section>`, quoted or bare, with an optional `.md` on the name. Stops at the
 *  first character no heading can carry, so a reference running on into prose is caught by
 *  the word-prefix test rather than here. */
const POINTER = /\b([A-Z][A-Z_]{2,})(?:\.md)?\s*§\s*(?:"([^"]+)"|([A-Za-z][\w ;-]*))/g;

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

const errors = [];
const files = [...tree(ROOT)];

/** Each doc's headings, as word lists, keyed by filename without the extension, and the
 *  files each name is claimed by. */
const docs = files.filter((f) => f.endsWith('.md'));
const headings = new Map();
const claimants = new Map();
for (const abs of docs) {
	const name = basename(abs, '.md');
	const hs = [...readFileSync(abs, 'utf8').matchAll(/^#+\s+(.+)$/gm)].map((m) => words(m[1]));
	headings.set(name, [...(headings.get(name) ?? []), ...hs]);
	claimants.set(name, [...(claimants.get(name) ?? []), relative(ROOT, abs)]);
}

let pointers = 0;
for (const abs of files) {
	const rel = relative(ROOT, abs);
	readFileSync(abs, 'utf8')
		.split('\n')
		.forEach((line, i) => {
			for (const [, doc, quoted, bare] of line.matchAll(POINTER)) {
				const hs = headings.get(doc);
				if (!hs) {
					errors.push(`${rel}:${i + 1}: \`${doc} §…\` — no such doc in this workspace`);
					continue;
				}
				const claimed = claimants.get(doc);
				if (claimed.length > 1) {
					errors.push(
						`${rel}:${i + 1}: \`${doc} §…\` names ${claimed.length} files (${claimed.join(', ')}); ` +
							`the section would resolve against all of them`
					);
					continue;
				}
				pointers++;
				const ref = words(quoted ?? bare);
				if (!hs.some((h) => aligns(ref, h)))
					errors.push(`${rel}:${i + 1}: ${doc} has no section \`${(quoted ?? bare).trim()}\``);
			}
		});
}

report(
	'Docs check',
	errors,
	`Docs OK — ${pointers} section pointers resolved across ${docs.length} docs.`
);
