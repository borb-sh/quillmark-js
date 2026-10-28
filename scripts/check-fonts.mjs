// `@quillmark/fonts`' promise to stored documents, enforced. A `font_family` mark saves a
// family name, so the suite changes only in ways that keep an old document rendering the
// same (FONTS §Rules). Zero deps; run via `npm run check:fonts`.
//
// Four rules over the tree, and two more against the registry:
//
//   1. The bytes are the manifest's. Every face's file hashes to its `sha256`, and its name
//      carries the first sixteen hex digits of it, so a file swapped in under an old name is
//      seen.
//
//   2. TrueType or OpenType, nothing else. The engine's library refuses WOFF and WOFF2
//      (`engine::font_unsupported`), so a face is read by its magic, and its extension names
//      what the magic says.
//
//   3. Every family travels with its licence. Each licence the suite admits (OFL, GUST,
//      Bitstream Vera) requires its text beside the files, so a family's `licenseFile` is in
//      `files/`, and `files/` holds nothing the manifest does not name.
//
//   4. The entries agree with the manifest. `src/suite.ts` is written from it, one
//      `new URL` literal a face so a bundler emits each as an asset; `--write` rewrites it.
//
//   5. Append-only (`--published`). Every family the registry's latest release names is
//      still here, under the same name.
//
//   6. Pinned bytes (`--published`). Every face that release shipped is here at the same
//      weight and style with the same `sha256`, unless this version's major is above its
//      major: new metrics or a new subset can reflow a stored document.
//
// The registry pair runs where a release is prepared and cut (`release-prepare.yml`,
// `release.yml`), not in `gate`: it needs the network, and the version it compares against
// is the one this branch is about to follow.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, report } from './workspace.mjs';

const PKG = join(ROOT, 'packages', 'fonts');
const FILES = join(PKG, 'files');
const SUITE = join(PKG, 'src', 'suite.ts');
const NAME = '@quillmark/fonts';
const LICENSES = new Set(['OFL-1.1', 'LicenseRef-GUST-Font-License', 'Bitstream-Vera']);
const STYLES = new Set(['normal', 'italic']);

const errors = [];
const fail = (msg) => errors.push(msg);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const manifest = JSON.parse(readFileSync(join(PKG, 'manifest.json'), 'utf8'));
const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version;

/** `00 01 00 00` and `true` open a TrueType file, `OTTO` an OpenType one. */
function format(bytes) {
	const tag = bytes.subarray(0, 4).toString('latin1');
	if (tag === '\0\x01\0\0' || tag === 'true') return 'ttf';
	if (tag === 'OTTO') return 'otf';
	return tag === 'wOFF' || tag === 'wOF2' ? 'woff' : null;
}

// ── 1–3. The files ──────────────────────────────────────────────────────────────

const named = new Set();
const seen = new Set();
for (const family of manifest.families) {
	const at = `manifest.json: "${family.name}"`;
	if (seen.has(family.name)) fail(`${at} is listed twice`);
	seen.add(family.name);
	if ('label' in family && (typeof family.label !== 'string' || !family.label.trim()))
		fail(`${at}: \`label\` is a name to show, or left out`);
	if (!LICENSES.has(family.license))
		fail(`${at}: licence \`${family.license}\` is not one the suite ships`);
	named.add(family.licenseFile);
	try {
		readFileSync(join(FILES, family.licenseFile));
	} catch {
		fail(`${at}: \`files/${family.licenseFile}\` is missing — the licence travels with the files`);
	}

	const styles = new Set();
	for (const face of family.faces) {
		const where = `${at} ${face.weight} ${face.style}`;
		if (!STYLES.has(face.style)) fail(`${where}: style is \`normal\` or \`italic\``);
		if (styles.has(`${face.weight} ${face.style}`)) fail(`${where} is listed twice`);
		styles.add(`${face.weight} ${face.style}`);
		named.add(face.file);
		if (
			!/\.[0-9a-f]{16}\.(ttf|otf)$/.test(face.file) ||
			!face.file.includes(`.${face.sha256.slice(0, 16)}.`)
		)
			fail(`${where}: \`${face.file}\` does not carry its sha256's first sixteen digits`);
		let bytes;
		try {
			bytes = readFileSync(join(FILES, face.file));
		} catch {
			fail(`${where}: \`files/${face.file}\` is missing`);
			continue;
		}
		if (sha256(bytes) !== face.sha256)
			fail(`${where}: \`files/${face.file}\` does not hash to its manifest sha256`);
		const kind = format(bytes);
		if (kind === 'woff') fail(`${where}: \`${face.file}\` is WOFF — the engine reads TTF/OTF only`);
		else if (!kind) fail(`${where}: \`${face.file}\` is not a TrueType or OpenType file`);
		else if (!face.file.endsWith(`.${kind}`))
			fail(
				`${where}: \`${face.file}\` holds ${kind === 'ttf' ? 'TrueType' : 'OpenType'} outlines — name it \`.${kind}\``
			);
	}
}

for (const file of readdirSync(FILES))
	if (!named.has(file)) fail(`files/${file}: named by no family in manifest.json`);

// ── 4. The entries ──────────────────────────────────────────────────────────────

function render() {
	const families = manifest.families.map((f) => `\t'${f.name}',`);
	const labels = manifest.families
		.filter((f) => f.label)
		.map((f) => `\t${/^[A-Za-z_$][\w$]*$/.test(f.name) ? f.name : `'${f.name}'`}: '${f.label}',`);
	const urls = manifest.families.flatMap((f) =>
		f.faces.map((face) => `\tnew URL('../files/${face.file}', import.meta.url),`)
	);
	return [
		'// Written from `manifest.json` by `npm run check:fonts -- --write`, which fails while the two',
		'// disagree.',
		'',
		"/** The suite's families, in the manifest's order. */",
		'export const FAMILIES = [',
		...families.map((line, i) => (i === families.length - 1 ? line.slice(0, -1) : line)),
		'] as const;',
		'',
		'/** The name a picker shows for a family, where the manifest gives one other than its own. */',
		...(labels.length
			? [
					'export const LABELS: Readonly<Record<string, string>> = {',
					...labels.map((line, i) => (i === labels.length - 1 ? line.slice(0, -1) : line)),
					'};'
				]
			: ['export const LABELS: Readonly<Record<string, string>> = {};']),
		'',
		"/** Every face's file, in the manifest's order: one literal each, so a bundler emits each as",
		' *  an asset. */',
		'export const FILES: readonly URL[] = [',
		...urls.map((line, i) => (i === urls.length - 1 ? line.slice(0, -1) : line)),
		'];',
		''
	].join('\n');
}

const want = render();
if (process.argv.includes('--write')) writeFileSync(SUITE, want);
else if (readFileSync(SUITE, 'utf8') !== want)
	fail(
		'packages/fonts/src/suite.ts: disagrees with manifest.json — `npm run check:fonts -- --write`'
	);

// ── 5–6. Against the registry ───────────────────────────────────────────────────

/** The manifest the registry's latest release shipped, or `null` where none is published. */
function published() {
	let latest;
	try {
		latest = execFileSync('npm', ['view', NAME, 'version'], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		}).trim();
	} catch (err) {
		if (/E404/.test(`${err.stderr ?? ''}`)) return null;
		throw err;
	}
	const dir = mkdtempSync(join(tmpdir(), 'fonts-'));
	try {
		const tgz = execFileSync('npm', ['pack', `${NAME}@${latest}`, '--pack-destination', dir], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		})
			.trim()
			.split('\n')
			.pop();
		const json = execFileSync('tar', ['-xzOf', join(dir, tgz), 'package/manifest.json'], {
			encoding: 'utf8'
		});
		return { version: latest, manifest: JSON.parse(json) };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

let compared = '';
if (process.argv.includes('--published')) {
	const last = published();
	if (!last) compared = `, nothing of ${NAME} published to compare`;
	else {
		compared = `, against ${NAME}@${last.version}`;
		const major = (v) => Number(v.split('.')[0]);
		const repinned = major(version) > major(last.version);
		const here = new Map(manifest.families.map((f) => [f.name, f]));
		for (const family of last.manifest.families) {
			const now = here.get(family.name);
			if (!now) {
				fail(`"${family.name}" shipped in ${last.version} and is gone — a family is never removed`);
				continue;
			}
			for (const face of family.faces) {
				const match = now.faces.find((f) => f.weight === face.weight && f.style === face.style);
				if (!match)
					fail(
						`"${family.name}" ${face.weight} ${face.style} shipped in ${last.version} and is gone`
					);
				else if (match.sha256 !== face.sha256 && !repinned)
					fail(
						`"${family.name}" ${face.weight} ${face.style}: its bytes changed since ${last.version} — a face's file changes only in a major`
					);
			}
		}
	}
}

const faces = manifest.families.reduce((n, f) => n + f.faces.length, 0);
report(
	'Font suite check',
	errors,
	`Font suite ok: ${manifest.families.length} families, ${faces} faces${compared}`
);
