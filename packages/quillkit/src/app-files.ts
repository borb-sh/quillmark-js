/**
 * The app target's two inputs and what they resolve to. `App.yaml` says what the app is,
 * `app.css` how it looks, and `app.json` is both resolved against the quiver: the quills
 * pinned, the author's files named, and the pins earlier builds shipped kept as retired
 * (QUILLKIT §"The app target").
 *
 * Everything that can refuse is read before a build clears anything, so a bad `App.yaml`
 * leaves the last deploy where it stood.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { isDraft, type Quiver } from '@quillmark/quiver/node';
import { within } from './paths.js';

export const APP_YAML = 'App.yaml';
export const APP_CSS = 'app.css';
export const APP_JSON = 'app.json';
/** Every pin a build of this app has shipped, committed beside `App.yaml`. */
export const APP_LOCK = 'app-lock.json';

/** The classes an author's stylesheet may aim at (THEMING §"What a stylesheet may aim at"). */
export const PROMISED = [
	'qm-editor',
	'qm-preview',
	'qm-pane',
	'qm-app-header',
	'qm-app-title',
	'qm-app-footer',
	'qm-app-primary'
];
/** The one promised attribute. */
const HOOK = 'data-qm-card';

/** The top-level names a deploy's client and quiver occupy, so no author file lands on one. */
export const RESERVED = ['index.html', 'assets', 'quiver', APP_JSON];

export interface AppYaml {
	title?: string;
	description?: string;
	quills?: string[];
	icon?: string;
}

const KEYS = ['title', 'description', 'quills', 'icon'];

/** `App.yaml` at `root`, checked, or undefined where there is none. */
export function readAppYaml(root: string): AppYaml | undefined {
	const at = join(root, APP_YAML);
	if (!existsSync(at)) return undefined;
	let doc: unknown;
	try {
		doc = parseYaml(readFileSync(at, 'utf8'));
	} catch (cause) {
		throw new Error(`${APP_YAML} is not YAML`, { cause });
	}
	if (doc == null) return {};
	if (typeof doc !== 'object' || Array.isArray(doc))
		throw new Error(`${APP_YAML}: expected a mapping at the top level`);
	const fields = doc as Record<string, unknown>;
	for (const key of Object.keys(fields))
		if (!KEYS.includes(key))
			throw new Error(`${APP_YAML}: unknown key "${key}"; the keys are ${KEYS.join(', ')}`);
	for (const key of ['title', 'description', 'icon'])
		if (fields[key] !== undefined && (typeof fields[key] !== 'string' || fields[key].trim() === ''))
			throw new Error(`${APP_YAML}: "${key}" is a string`);
	const { quills } = fields;
	if (
		quills !== undefined &&
		(!Array.isArray(quills) || quills.length === 0 || quills.some((q) => typeof q !== 'string'))
	)
		throw new Error(`${APP_YAML}: "quills" is a list of quill selectors`);
	return fields as AppYaml;
}

const versionOf = (ref: string): string => ref.slice(ref.indexOf('@') + 1);

/**
 * The canonical refs an app pins: each selector `App.yaml` lists, resolved, or every quill
 * at its latest version where it lists none. A draft is admitted only under `drafts`, as a
 * pack admits one (QUIVER §"The draft floor").
 */
export function resolveRefs(
	quiver: Quiver,
	selectors: string[] | undefined,
	drafts: boolean
): string[] {
	const admitted = (version: string): boolean => drafts || !isDraft(version);
	if (selectors === undefined) {
		const refs = quiver.quillNames().flatMap((name) => {
			const version = quiver.versionsOf(name).find(admitted);
			return version === undefined ? [] : [`${name}@${version}`];
		});
		if (refs.length === 0)
			throw new Error('the quiver holds no quill at 0.1.0 or above: pass --drafts to ship a draft');
		return refs;
	}
	const named = new Map<string, string>();
	return selectors.map((selector) => {
		let ref: string;
		try {
			ref = quiver.resolve(selector);
		} catch {
			throw new Error(`${APP_YAML}: "${selector}" names no quill in the quiver`);
		}
		if (!admitted(versionOf(ref)))
			throw new Error(
				`${APP_YAML}: "${selector}" resolves to ${ref}, a draft: pass --drafts to ship it`
			);
		const name = ref.slice(0, ref.indexOf('@'));
		const twice = named.get(name);
		if (twice !== undefined)
			throw new Error(
				`${APP_YAML}: "${twice}" and "${selector}" both name ${name}; an app pins one version of a quill`
			);
		named.set(name, selector);
		return ref;
	});
}

/** `memo_for` → `Memo For`: an id as the label a reader sees, where nothing names it in words. */
const humanize = (name: string): string =>
	name
		.split('_')
		.filter(Boolean)
		.map((w) => w[0]!.toUpperCase() + w.slice(1))
		.join(' ');

/**
 * What `app.css` reaches for: the files its `url()`s name beside it, and every selector name
 * it aims at that the theming contract does not promise. A `url()` naming a scheme, a
 * protocol-relative host or a fragment is someone else's to serve.
 */
export function scanCss(css: string): { urls: string[]; absolute: string[]; stray: string[] } {
	const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const urls = new Set<string>();
	const absolute = new Set<string>();
	for (const m of bare.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/g)) {
		const url = (m[1] ?? m[2] ?? m[3] ?? '').trim();
		if (url === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url)) continue;
		if (url.startsWith('/')) absolute.add(url);
		else urls.add(decodeURIComponent(url.replace(/[?#].*$/, '')));
	}
	const selectors = bare.replace(/url\([^)]*\)/g, '').replace(/"[^"]*"|'[^']*'/g, '');
	const stray = new Set<string>();
	for (const [, name] of selectors.matchAll(/\.(qm-[\w-]+)/g))
		if (!PROMISED.includes(name!)) stray.add(`.${name}`);
	for (const [, name] of selectors.matchAll(/\[\s*(data-qm-[\w-]+)/g))
		if (name !== HOOK) stray.add(`[${name}]`);
	return { urls: [...urls], absolute: [...absolute], stray: [...stray] };
}

/** `rel` as a file of the quiver's that a deploy may carry, spelled with `/`. */
function authorFile(root: string, rel: string, what: string): string {
	if (isAbsolute(rel)) throw new Error(`${what} names "${rel}", an absolute path`);
	const abs = resolve(root, rel);
	if (!within(root, abs)) throw new Error(`${what} names "${rel}", outside the quiver`);
	if (!existsSync(abs) || !statSync(abs).isFile())
		throw new Error(`${what} names "${rel}", which is not a file in the quiver`);
	const path = relative(root, abs).split(sep).join('/');
	const top = path.split('/')[0]!;
	if (RESERVED.includes(top) || path === APP_CSS)
		throw new Error(`${what} names "${rel}", where the deploy's own ${top} stands`);
	return path;
}

/** One quill the app opens, as `app.json` names it. */
export interface AppQuill {
	ref: string;
	title: string;
	description?: string;
}

/** `app.json`, which the app client reads at boot. */
export interface AppJson {
	title: string;
	description?: string;
	icon?: string;
	css?: string;
	quills: AppQuill[];
	retired: string[];
}

/** An app resolved against its quiver, before anything is written. */
export interface Prepared {
	app: Omit<AppJson, 'retired'>;
	/** The author's files the deploy carries, `/`-separated and relative to the quiver. */
	files: string[];
	/** Every canonical ref the pack holds, which is where a retired pin can still open. */
	held: Set<string>;
	warnings: string[];
}

/**
 * Read `App.yaml` and `app.css` at `root` and resolve them against `quiver`, the source
 * layout loaded whole: every refusal a build can meet, met before it clears anything.
 */
export async function prepareApp(root: string, quiver: Quiver, drafts: boolean): Promise<Prepared> {
	const yaml = readAppYaml(root) ?? {};
	const warnings: string[] = [];
	const files: string[] = [];

	const icon =
		yaml.icon === undefined ? undefined : authorFile(root, yaml.icon, `${APP_YAML} "icon"`);
	if (icon !== undefined) files.push(icon);

	let css: string | undefined;
	if (existsSync(join(root, APP_CSS))) {
		css = APP_CSS;
		const scanned = scanCss(readFileSync(join(root, APP_CSS), 'utf8'));
		for (const url of scanned.urls) files.push(authorFile(root, url, APP_CSS));
		for (const url of scanned.absolute)
			warnings.push(
				`${APP_CSS} names "${url}" from the host's root, which a deploy under a subpath does not serve; name it relative to ${APP_CSS}`
			);
		for (const name of scanned.stray)
			warnings.push(
				`${APP_CSS} aims at ${name}, which the theming contract does not promise, so a release may move it`
			);
	}

	const quills: AppQuill[] = [];
	for (const ref of resolveRefs(quiver, yaml.quills, drafts)) {
		const quill = await quiver.getQuill(ref);
		const { name, description, license } = quill.metadata;
		if (!license)
			warnings.push(
				`${ref} declares no license, and an app hands its plate and fonts to every reader: name one under \`quill:\` in its Quill.yaml`
			);
		quills.push({
			ref,
			title: quill.schema.main.title ?? humanize(name),
			...(description ? { description } : {})
		});
	}

	const held = new Set(
		quiver.quillNames().flatMap((name) =>
			quiver
				.versionsOf(name)
				.filter((v) => drafts || !isDraft(v))
				.map((v) => `${name}@${v}`)
		)
	);

	const description = yaml.description ?? quiver.description;
	return {
		app: {
			title: yaml.title ?? humanize(quiver.name),
			...(description ? { description: description.trim() } : {}),
			...(icon ? { icon } : {}),
			...(css ? { css } : {}),
			quills
		},
		files: [...new Set(files)],
		held,
		warnings
	};
}

/** The pins `app-lock.json` records, or none where it is absent. */
function readLock(root: string): string[] {
	const at = join(root, APP_LOCK);
	if (!existsSync(at)) return [];
	let pins: unknown;
	try {
		pins = JSON.parse(readFileSync(at, 'utf8')).pins;
	} catch (cause) {
		throw new Error(`${APP_LOCK} is not JSON`, { cause });
	}
	if (!Array.isArray(pins) || pins.some((p) => typeof p !== 'string'))
		throw new Error(`${APP_LOCK}: "pins" is a list of canonical refs`);
	return pins;
}

/**
 * Write `app.json` and the author's files into `out`. A pin an earlier build shipped and this
 * one does not is retired: listed, so a document made on it opens on that version, as long
 * as the pack still holds it. With `lock`, the pins this build ships join `app-lock.json`,
 * which is what a fresh checkout reads them back from.
 */
export async function writeApp(
	prepared: Prepared,
	root: string,
	out: string,
	{ lock }: { lock: boolean }
): Promise<string[]> {
	const warnings = [...prepared.warnings];
	const locked = readLock(root);
	const current = prepared.app.quills.map((q) => q.ref);
	const earlier = locked.filter((ref) => !current.includes(ref));
	const retired = earlier.filter((ref) => prepared.held.has(ref));
	for (const ref of earlier.filter((ref) => !prepared.held.has(ref)))
		warnings.push(
			`${ref} shipped in an earlier build and the pack no longer holds it: a document made on it offers its markdown and the latest form`
		);

	await mkdir(out, { recursive: true });
	const app: AppJson = { ...prepared.app, retired };
	const json = join(out, APP_JSON);
	await writeFile(`${json}.next`, `${JSON.stringify(app, null, '\t')}\n`);
	await rename(`${json}.next`, json);
	for (const file of [...(prepared.app.css ? [prepared.app.css] : []), ...prepared.files]) {
		await mkdir(dirname(join(out, file)), { recursive: true });
		await copyFile(join(root, file), join(out, file));
	}

	if (lock) {
		const pins = [...new Set([...locked, ...current])].sort();
		if (pins.length !== locked.length || pins.some((p, i) => p !== [...locked].sort()[i]))
			await writeFile(join(root, APP_LOCK), `${JSON.stringify({ pins }, null, '\t')}\n`);
	}
	return warnings;
}
