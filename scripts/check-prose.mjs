// Where design prose may live: one invariants page per published package, and nowhere a
// second design doc can grow beside it. Zero deps; run via `npm run check:prose`.
//
// A package's `prose/` holds `INVARIANTS.md` and nothing else, and every published package
// has one, since the packages ship separately and a rule belongs to the package it binds.
// A package's top level holds `README.md`, `CHANGELOG.md` and the docs its `files` ships,
// so a design doc cannot move up a level instead. The workspace root holds no `prose/`.
// Each page opens on a `# ` title, and its relative links resolve, since a rule links a
// neighbour's fact rather than copying it. What earns a rule its place is the writer's and
// the reviewer's; `check:docs` resolves the pointers into the pages.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ROOT, packages, report } from './workspace.mjs';

const PAGE = 'INVARIANTS.md';
const TOP_LEVEL = new Set(['README.md', 'CHANGELOG.md']);
/** A relative markdown link target, anchor stripped; external and in-page links pass. */
const REL_LINK = /\]\((?!https?:|#|mailto:)([^)\s#]+)/g;

const errors = [];

if (existsSync(join(ROOT, 'prose')))
	errors.push('prose/: the workspace root holds no prose; a rule lives in its package');

for (const { at, json } of packages()) {
	const rel = (p) => relative(ROOT, join(at, p));
	const shipped = new Set(json.files ?? []);

	for (const name of readdirSync(at).filter((n) => n.endsWith('.md')))
		if (!TOP_LEVEL.has(name) && !shipped.has(name))
			errors.push(
				`${rel(name)}: a package's top level holds README.md, CHANGELOG.md and the docs \`files\` ships; a rule goes in prose/${PAGE}`
			);

	const prose = join(at, 'prose');
	if (existsSync(prose))
		for (const name of readdirSync(prose))
			if (name !== PAGE)
				errors.push(`${rel(join('prose', name))}: prose/ holds ${PAGE} and nothing else`);

	const page = join(prose, PAGE);
	if (!existsSync(page)) {
		if (!json.private)
			errors.push(`${rel(join('prose', PAGE))}: missing; every published package keeps one`);
		continue;
	}
	const text = readFileSync(page, 'utf8');
	if (!text.startsWith('# '))
		errors.push(`${rel(join('prose', PAGE))}: line 1 is not a \`# \` title`);
	text.split('\n').forEach((line, i) => {
		for (const [, target] of line.matchAll(REL_LINK))
			if (!existsSync(join(dirname(page), target)))
				errors.push(
					`${rel(join('prose', PAGE))}:${i + 1}: link target \`${target}\` does not resolve`
				);
	});
}

report(
	'Prose check',
	errors,
	`Prose OK — one ${PAGE} per published package, and nothing beside it.`
);
