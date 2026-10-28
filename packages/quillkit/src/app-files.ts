/**
 * The app target's inputs and what they resolve to: `App.yaml`, `app.css` and the icon,
 * each found by name, resolved against the quiver into `app.json` (QUILLKIT §"The app target").
 * Everything that can refuse is read before a build clears anything.
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
/** The names an app's icon is found by, the first present taken. */
export const ICONS = ['icon.svg', 'icon.png'];

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

interface AppYaml {
	title?: string;
	description?: string;
}

const KEYS = ['title', 'description'];

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
	for (const key of KEYS)
		if (fields[key] !== undefined && (typeof fields[key] !== 'string' || fields[key].trim() === ''))
			throw new Error(`${APP_YAML}: "${key}" is a string`);
	return fields as AppYaml;
}

/**
 * The canonical refs an app opens: every quill the quiver holds, at its latest version. A
 * draft is admitted only under `drafts`, as a pack admits one (QUIVER §"The draft floor").
 */
export function appRefs(quiver: Quiver, drafts: boolean): string[] {
	const refs = quiver.quillNames().flatMap((name) => {
		const version = quiver.versionsOf(name).find((v) => drafts || !isDraft(v));
		return version === undefined ? [] : [`${name}@${version}`];
	});
	if (refs.length === 0)
		throw new Error('the quiver holds no quill at 0.1.0 or above: pass --drafts to ship a draft');
	return refs;
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
interface AppJson {
	title: string;
	description?: string;
	icon?: string;
	css?: string;
	quills: AppQuill[];
}

/** An app resolved against its quiver, before anything is written. */
interface Prepared {
	app: AppJson;
	/** The author's files the deploy carries, `/`-separated and relative to the quiver. */
	files: string[];
	warnings: string[];
}

/**
 * Read `App.yaml`, `app.css` and the icon at `root` and resolve them against `quiver`, the
 * source layout loaded whole: every refusal a build can meet, met before it clears anything.
 */
export async function prepareApp(root: string, quiver: Quiver, drafts: boolean): Promise<Prepared> {
	const yaml = readAppYaml(root) ?? {};
	const warnings: string[] = [];
	const files: string[] = [];

	const icon = ICONS.find((name) => existsSync(join(root, name)));
	if (icon !== undefined) files.push(authorFile(root, icon, 'the icon'));

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
	for (const ref of appRefs(quiver, drafts)) {
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
		warnings
	};
}

/** Write `app.json` and the author's files into `out`. */
export async function writeApp(prepared: Prepared, root: string, out: string): Promise<void> {
	await mkdir(out, { recursive: true });
	const json = join(out, APP_JSON);
	await writeFile(`${json}.next`, `${JSON.stringify(prepared.app, null, '\t')}\n`);
	await rename(`${json}.next`, json);
	for (const file of [...(prepared.app.css ? [prepared.app.css] : []), ...prepared.files]) {
		await mkdir(dirname(join(out, file)), { recursive: true });
		await copyFile(join(root, file), join(out, file));
	}
}
