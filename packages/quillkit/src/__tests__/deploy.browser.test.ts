/**
 * The deploy as a reader reaches it: a site the bin laid, served under a subpath, opened
 * in a browser (`scripts/browser.mjs`).
 *
 * The one test that loads what a consumer is served. Every other rule over built output
 * reads it as files — a path exists, a stylesheet survived the bundler — and a client
 * whose assets 404 or whose panes stand past the viewport passes all of them. The dev
 * server exhibits neither: it tree-shakes nothing and serves at a root.
 *
 * What it may assert is CLAUDE.md §Verification's: presence against absence, and a
 * relation no dial owns.
 *
 * It runs against `dist/`, so it needs the package built, both halves.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { createStaticServer, listen } from '../serve.js';
import { scratch } from './helpers/collection.js';
import { load, type Viewport } from '../../../../scripts/browser.mjs';

const run = promisify(execFile);

const BIN = fileURLToPath(new URL('../../dist/bin/quillkit.js', import.meta.url));

/**
 * Two segments deep, the shape a project page is served at. A client resolving its
 * assets or its quiver against the origin rather than the document's base is whole at a
 * root and blank here.
 */
const PREFIX = '/quillmark-js/studio';

/** Both sides of the preset's threshold: two tracks abreast, then one. */
const WIDE: Viewport = { width: 1440, height: 900 };
const NARROW: Viewport = { width: 700, height: 900 };

/** A pack, a browser start and a wasm load. */
const LOAD_MS = 120_000;

/**
 * What the page is asked, once each handle it is asked about exists: the shell is the
 * mount, the picker stands only over a resolved quiver, the split only over an open
 * session. A handle that never arrives comes back null rather than hanging the load.
 */
const PROBE = `(async () => {
	const deadline = Date.now() + 30000;
	const until = async (find) => {
		for (;;) {
			const found = find();
			if (found) return found;
			if (Date.now() > deadline) return null;
			await new Promise((wake) => setTimeout(wake, 50));
		}
	};
	const shell = await until(() => document.querySelector('.qm-workspace'));
	const picker = await until(() => document.querySelector('.picker'));
	const split = await until(() => document.querySelector('.qm-split'));
	const width = (el) => (el === null ? null : el.getBoundingClientRect().width);
	return {
		booted: shell !== null,
		quiverResolved: picker !== null,
		editorMounted: document.querySelector('.qm-pane') !== null,
		viewport: window.innerWidth,
		shellWidth: width(shell),
		splitWidth: width(split),
		panesLaid: split === null ? 0 : [...split.children].filter((p) => width(p) > 0).length
	};
})()`;

/**
 * What the mounted surface asks its host for, measured where the host stops answering
 * for it: the editor's track is put on its own min-content width, with and without a
 * wide element inside the surface. A surface whose width followed its contents answers
 * the second question with the element's width, and the pane it is mounted in takes that
 * width from whatever stands beside it.
 *
 * The element stands in for a document's own widest construct — a table is as wide as
 * its columns — so what is asserted is the boundary rather than any one construct.
 */
const DEMAND = `(async () => {
	const deadline = Date.now() + 30000;
	const until = async (find) => {
		for (;;) {
			const found = find();
			if (found) return found;
			if (Date.now() > deadline) return null;
			await new Promise((wake) => setTimeout(wake, 50));
		}
	};
	const pane = await until(() => document.querySelector('.qm-pane'));
	if (pane === null) return null;
	const track = pane.parentElement;
	const asked = () => {
		track.style.width = 'min-content';
		const width = track.getBoundingClientRect().width;
		track.style.width = '';
		return width;
	};

	const bare = asked();
	const probe = document.createElement('div');
	probe.style.cssText = 'width: 4000px; height: 1px';
	pane.appendChild(probe);
	const held = asked();
	probe.remove();
	return { bare, held };
})()`;

/**
 * The link half: what opened, and what the address bar says once it has. Read after the
 * surface mounts, the write standing ahead of the open that follows it.
 */
const LINKED = `(async () => {
	const deadline = Date.now() + 30000;
	const until = async (find) => {
		for (;;) {
			const found = find();
			if (found) return found;
			if (Date.now() > deadline) return null;
			await new Promise((wake) => setTimeout(wake, 50));
		}
	};
	const mounted = await until(() => document.querySelector('.qm-pane'));
	return { editorMounted: mounted !== null, search: location.search };
})()`;

interface Demand {
	/** The surface's own width demand. */
	bare: number;
	/** The same, holding a 4000px element. */
	held: number;
}

interface Linked {
	editorMounted: boolean;
	/** The address bar's query once the surface is up. */
	search: string;
}

interface Probe {
	booted: boolean;
	quiverResolved: boolean;
	editorMounted: boolean;
	viewport: number;
	shellWidth: number | null;
	splitWidth: number | null;
	panesLaid: number;
}

const temp = scratch('quillkit-deploy-');
let server: Server;
let url: string;

beforeAll(async () => {
	expect(
		existsSync(BIN),
		`${BIN} is missing: run \`npm run build -w packages/quillkit\` first`
	).toBe(true);

	const site = join(await temp.dir(), 'site');
	await run(process.execPath, [BIN, 'site', '--quiver', await temp.collection(), '--out', site]);

	server = createStaticServer([{ prefix: PREFIX, root: site }]);
	const port = await listen(server, 0, '127.0.0.1');
	url = `http://127.0.0.1:${port}${PREFIX}/`;
}, LOAD_MS);

afterAll(async () => {
	server?.close();
	await temp.cleanup();
});

describe('the built client, served under a subpath', () => {
	it(
		'boots, resolves its quiver against the base it was served at, and mounts a surface',
		async () => {
			const page = await load<Probe>(url, PROBE, WIDE);

			expect(page.booted).toBe(true);
			expect(page.quiverResolved).toBe(true);
			expect(page.editorMounted).toBe(true);
		},
		LOAD_MS
	);

	it(
		'stands its tracks in the viewport, at both sides of the threshold',
		async () => {
			for (const viewport of [WIDE, NARROW]) {
				const page = await load<Probe>(url, PROBE, viewport);
				const where = `at ${viewport.width}px`;

				// The second assertion is the load-bearing one: `inset: 0` pins the shell's
				// box at the viewport whatever its tracks do, so a column sized to its
				// content overflows silently under the shell's own `overflow: hidden`.
				expect(page.shellWidth, `the shell is the viewport ${where}`).toBeCloseTo(page.viewport, 0);
				expect(page.splitWidth, `the tracks sum to the shell ${where}`).toBeCloseTo(
					page.shellWidth ?? 0,
					0
				);
			}
		},
		LOAD_MS
	);

	it(
		'asks its host for no more width than the document it holds',
		async () => {
			const asked = await load<Demand | null>(url, DEMAND, WIDE);

			expect(asked, 'the editor mounted').not.toBeNull();
			expect(asked?.held, 'a 4000px element inside the surface moves nothing').toBeCloseTo(
				asked?.bare ?? 0,
				0
			);
		},
		LOAD_MS
	);

	it(
		'shows both panes above the threshold and one under it',
		async () => {
			expect((await load<Probe>(url, PROBE, WIDE)).panesLaid).toBe(2);
			expect((await load<Probe>(url, PROBE, NARROW)).panesLaid).toBe(1);
		},
		LOAD_MS
	);

	// The deployed fixture quiver holds `showcase@1.0.0` alone — `usaf_memo` sits under
	// the draft floor `build` packs above — so what is asserted is the link itself: a
	// selector opens and is said canonically, and a ref the quiver does not hold still
	// reaches a surface with the address bar corrected to what is on it.
	it(
		'opens the quill a link names, and says which one is on screen',
		async () => {
			const named = await load<Linked>(`${url}?quill=showcase`, LINKED, WIDE);
			expect(named.editorMounted, 'a link to a quill mounts a surface').toBe(true);
			expect(named.search).toBe('?quill=showcase@1.0.0');

			const stray = await load<Linked>(`${url}?quill=nope@9.9.9`, LINKED, WIDE);
			expect(stray.editorMounted, 'a ref the quiver does not hold still opens').toBe(true);
			expect(stray.search).toBe('?quill=showcase@1.0.0');
		},
		LOAD_MS
	);
});
