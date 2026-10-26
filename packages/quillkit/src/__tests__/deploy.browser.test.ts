/**
 * The deploy as a reader reaches it: a studio and an app the bin laid, each served under a
 * subpath, opened in a browser (`scripts/browser.mjs`).
 *
 * The one test that loads what a consumer is served. Every other rule over built output
 * reads it as files — a path exists, a stylesheet survived the bundler — and a client
 * whose assets 404 or whose panes stand past the viewport passes all of them. The dev
 * server exhibits neither: it tree-shakes nothing and serves at a root.
 *
 * What it may assert is what TESTING.md §Assertions allows: presence against absence, and a
 * relation no dial owns.
 *
 * It runs against `dist/`, so it needs the package built, every half.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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
const APP_PREFIX = '/quillmark-js/app';

/** Both sides of the preset's threshold: two tracks abreast, then one. */
const WIDE: Viewport = { width: 1440, height: 900 };
const NARROW: Viewport = { width: 700, height: 900 };

/** A pack, a browser start and a wasm load. */
const LOAD_MS = 120_000;

/**
 * What the page is asked, once each handle it is asked about exists: the shell is the
 * mount, the picker stands only over a resolved quiver, the split only over an open
 * session. A handle that never arrives comes back null rather than hanging the load.
 *
 * `demand` is what the mounted surface asks its host for, measured where the host stops
 * answering for it: the editor's track put on its own min-content width, with and
 * without a wide element inside the surface. A surface whose width followed its contents
 * answers the second with the element's width, and the pane takes that width from
 * whatever stands beside it. The element stands in for a document's own widest construct
 * — a table is as wide as its columns — so what is asserted is the boundary rather than
 * any one construct.
 *
 * `guidance` raises each field hint the pane shows as a pointer does, and reads the gap
 * between its surface and the trigger's target: the glyph's box grown to the tap floor
 * its `::after` draws, which is what the pointer holds.
 *
 * `unfolded` opens each section and every record row in it, as a hand does, and reads two
 * relations off what that lays out: a block prose cell's inline edges against its subform
 * grid's, and a held leaf's note against the box it is drawn in and the text above it, the
 * leaf the note describes.
 */
const SURVEY = `(async () => {
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
	const pane = await until(() => document.querySelector('.qm-pane'));
	const width = (el) => (el === null ? null : el.getBoundingClientRect().width);
	const asked = () => {
		const track = pane.parentElement;
		track.style.width = 'min-content';
		const at = track.getBoundingClientRect().width;
		track.style.width = '';
		return at;
	};
	const demand = () => {
		const bare = asked();
		const wide = document.createElement('div');
		wide.style.cssText = 'width: 4000px; height: 1px';
		pane.appendChild(wide);
		const held = asked();
		wide.remove();
		return { bare, held };
	};
	const frame = () => new Promise((wake) => requestAnimationFrame(wake));
	const target = (trigger) => {
		const box = trigger.getBoundingClientRect();
		const floor = getComputedStyle(trigger, '::after');
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		const w = Math.max(box.width, parseFloat(floor.width)) / 2;
		const h = Math.max(box.height, parseFloat(floor.height)) / 2;
		return { left: x - w, right: x + w, top: y - h, bottom: y + h };
	};
	const guidance = async () => {
		const gaps = [];
		for (const trigger of pane.querySelectorAll('.qm-field-hint')) {
			const box = trigger.getBoundingClientRect();
			const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
			// In view, and not under a closed section or another surface.
			if (!trigger.contains(hit)) continue;
			trigger.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
			let surface = null;
			for (let tries = 0; tries < 60 && surface === null; tries++) {
				await frame();
				surface = document.querySelector('.qm-hint-popover[data-state="open"]');
			}
			if (surface === null) continue;
			await Promise.all(surface.getAnimations().map((done) => done.finished));
			await frame();
			const at = surface.getBoundingClientRect();
			const to = target(trigger);
			gaps.push(
				Math.max(to.top - at.bottom, at.top - to.bottom, to.left - at.right, at.left - to.right)
			);
			trigger.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
			for (let tries = 0; tries < 60 && surface.isConnected; tries++) await frame();
		}
		return { raised: gaps.length, clearance: Math.min(...gaps), pixel: 1 / devicePixelRatio };
	};
	const settled = async () => {
		await frame();
		await Promise.allSettled(document.getAnimations().map((done) => done.finished));
		await frame();
	};
	const unfolded = async () => {
		let cells = 0;
		let offset = 0;
		let notes = 0;
		let spill = -Infinity;
		for (const header of pane.querySelectorAll('.qm-group-header')) {
			if (header.getAttribute('aria-expanded') !== 'true') header.click();
			await settled();
			const panel = document.getElementById(header.getAttribute('aria-controls'));
			for (let shut; (shut = panel.querySelectorAll('.qm-element-summary[aria-expanded="false"]')).length; ) {
				for (const summary of shut) summary.click();
				await settled();
			}
			for (const cell of panel.querySelectorAll('.qm-prop-wide')) {
				const at = cell.getBoundingClientRect();
				const grid = cell.parentElement.getBoundingClientRect();
				offset = Math.max(offset, Math.abs(at.left - grid.left), Math.abs(at.right - grid.right));
				cells++;
			}
			for (const note of panel.querySelectorAll('.qm-prose-held-note')) {
				const at = note.getBoundingClientRect();
				const leaf = panel.querySelector('[aria-describedby~="' + CSS.escape(note.id) + '"]');
				const box = leaf?.closest('.qm-control-box')?.getBoundingClientRect();
				const text = leaf?.getBoundingClientRect();
				spill = box
					? Math.max(spill, box.left - at.left, at.right - box.right, text.bottom - at.top, at.bottom - box.bottom)
					: Infinity;
				notes++;
			}
		}
		return { cells, offset, notes, spill };
	};
	return {
		booted: shell !== null,
		quiverResolved: picker !== null,
		editorMounted: pane !== null,
		viewport: window.innerWidth,
		shellWidth: width(shell),
		splitWidth: width(split),
		search: location.search,
		demand: pane === null ? null : demand(),
		guidance: pane === null ? null : await guidance(),
		unfolded: pane === null ? null : await unfolded()
	};
})()`;

/**
 * What the app is asked: its landing over a quiver of several quills, then the first quill's
 * document once a card is picked, the form and the page each mounted and the tracks laid
 * against the viewport. Under the preset's threshold one track shows at a time, and the page
 * is the one the switch brings up.
 */
const APP_SURVEY = `(async () => {
	const deadline = Date.now() + 60000;
	const until = async (find) => {
		for (;;) {
			const found = find();
			if (found) return found;
			if (Date.now() > deadline) return null;
			await new Promise((wake) => setTimeout(wake, 50));
		}
	};
	const width = (el) => (el === null ? null : el.getBoundingClientRect().width);
	const header = await until(() => document.querySelector('.qm-app-header'));
	const cards = await until(() => {
		const found = document.querySelectorAll('[data-testid="pick"]');
		return found.length ? found : null;
	});
	cards?.[0].click();
	const pane = await until(() => document.querySelector('.qm-editor'));
	const hooked = await until(() => document.querySelector('[data-qm-card]'));
	const page = [...document.querySelectorAll('.qm-switch button')].find(
		(b) => b.textContent.trim() === 'Page' && b.offsetParent !== null
	);
	page?.click();
	const preview = await until(() => document.querySelector('.qm-preview canvas'));
	const shell = document.querySelector('.qm-workspace');
	const split = document.querySelector('.qm-split');
	return {
		booted: header !== null,
		cards: cards?.length ?? 0,
		editorMounted: pane !== null && hooked !== null,
		previewMounted: preview !== null,
		download: document.querySelector('.qm-app-primary') !== null,
		viewport: window.innerWidth,
		scrollWidth: document.documentElement.scrollWidth,
		shellWidth: width(shell),
		splitWidth: width(split)
	};
})()`;

interface Survey {
	booted: boolean;
	quiverResolved: boolean;
	editorMounted: boolean;
	viewport: number;
	shellWidth: number | null;
	splitWidth: number | null;
	/** The address bar's query once the surface is up. */
	search: string;
	/** The surface's own width demand, bare and holding a 4000px element. */
	demand: { bare: number; held: number } | null;
	/** How many hints raised a surface, the least gap between one and its trigger's
	 *  target, and the device pixel in CSS px. */
	guidance: { raised: number; clearance: number; pixel: number } | null;
	/** How many block prose cells and held notes the open sections lay out, the furthest a
	 *  cell's inline edge stands off its subform grid's, and the furthest a note reaches past
	 *  its box or up into its leaf's text, at most zero while it stands under the text. */
	unfolded: { cells: number; offset: number; notes: number; spill: number } | null;
}

interface AppSurvey {
	booted: boolean;
	cards: number;
	editorMounted: boolean;
	previewMounted: boolean;
	download: boolean;
	viewport: number;
	scrollWidth: number;
	shellWidth: number | null;
	splitWidth: number | null;
}

const temp = scratch('quillkit-deploy-');
let server: Server;
/** The quill the deployed quiver opens first, canonical. */
let first: string;
/** Opened by a link naming `first` by its name alone. */
let wide: Survey;
/** Opened by a link naming a ref the quiver does not hold. */
let narrow: Survey;
/** The app, wide and on a phone. */
let apps: AppSurvey[];

beforeAll(async () => {
	expect(
		existsSync(BIN),
		`${BIN} is missing: run \`npm run build -w packages/quillkit\` first`
	).toBe(true);

	const collection = await temp.collection();
	const site = join(await temp.dir(), 'site');
	const app = join(await temp.dir(), 'app');
	await run(process.execPath, [BIN, 'build', 'studio', '--out', site, '--drafts'], {
		cwd: collection
	});
	await run(process.execPath, [BIN, 'build', 'app', '--out', app, '--drafts'], {
		cwd: collection
	});
	const { quills } = JSON.parse(await readFile(join(site, 'quiver', 'quiver.json'), 'utf8'));
	first = `${quills[0].name}@${quills[0].version}`;

	server = createStaticServer([
		{ prefix: PREFIX, root: site },
		{ prefix: APP_PREFIX, root: app }
	]);
	const origin = `http://127.0.0.1:${await listen(server, 0, '127.0.0.1')}`;
	const url = `${origin}${PREFIX}/`;
	const appUrl = `${origin}${APP_PREFIX}/`;
	[wide, narrow, ...apps] = await Promise.all([
		load<Survey>(`${url}?quill=${quills[0].name}`, SURVEY, WIDE),
		load<Survey>(`${url}?quill=nope@9.9.9`, SURVEY, NARROW),
		load<AppSurvey>(appUrl, APP_SURVEY, WIDE),
		load<AppSurvey>(appUrl, APP_SURVEY, NARROW)
	]);
}, LOAD_MS);

afterAll(async () => {
	server?.close();
	await temp.cleanup();
});

describe('the built client, served under a subpath', () => {
	it('boots, resolves its quiver against the base it was served at, and mounts a surface', () => {
		for (const page of [wide, narrow]) {
			const where = `at ${page.viewport}px`;
			expect(page.booted, where).toBe(true);
			expect(page.quiverResolved, where).toBe(true);
			expect(page.editorMounted, where).toBe(true);
		}
	});

	it('stands its tracks in the viewport, at both sides of the threshold', () => {
		for (const page of [wide, narrow]) {
			const where = `at ${page.viewport}px`;
			// The second assertion is the load-bearing one: `inset: 0` pins the shell's
			// box at the viewport whatever its tracks do, so a column sized to its
			// content overflows silently under the shell's own `overflow: hidden`.
			expect(page.shellWidth, `the shell is the viewport ${where}`).toBeCloseTo(page.viewport, 0);
			expect(page.splitWidth, `the tracks sum to the shell ${where}`).toBeCloseTo(
				page.shellWidth ?? 0,
				0
			);
		}
	});

	it('asks its host for no more width than the document it holds', () => {
		expect(wide.demand?.held, 'a 4000px element inside the surface moves nothing').toBeCloseTo(
			wide.demand?.bare ?? NaN,
			0
		);
	});

	// By more than the device pixel floating-ui rounds a surface's position to: one the
	// rounding lands on the target takes a resting pointer off the trigger, which closes
	// the surface, and hands the pointer back as it goes.
	it("raises a field's guidance clear of the target that raised it", () => {
		for (const page of [wide, narrow]) {
			const where = `at ${page.viewport}px`;
			expect(page.guidance?.raised, `a hint in view raises its surface ${where}`).toBeGreaterThan(
				0
			);
			expect(
				page.guidance?.clearance,
				`a raised surface stands more than a device pixel clear of the target ${where}`
			).toBeGreaterThan(page.guidance?.pixel ?? Infinity);
		}
	});

	it('spans a block prose cell across its subform', () => {
		for (const page of [wide, narrow]) {
			const where = `at ${page.viewport}px`;
			expect(page.unfolded?.cells, `an open row lays out a block cell ${where}`).toBeGreaterThan(0);
			expect(
				page.unfolded?.offset,
				`a block cell's inline extent is its subform grid's ${where}`
			).toBeCloseTo(0, 0);
		}
	});

	it("draws a held leaf's note inside its box, under its text", () => {
		for (const page of [wide, narrow]) {
			const where = `at ${page.viewport}px`;
			expect(page.unfolded?.notes, `an open row lays out a held leaf ${where}`).toBeGreaterThan(0);
			expect(
				page.unfolded?.spill,
				`a held leaf's note lies inside its box, under the text ${where}`
			).toBeLessThanOrEqual(0);
		}
	});

	// A ref the quiver does not hold opens the catalog's first, the address bar corrected
	// to what is on screen.
	it('opens the quill a link names, and says which one is on screen', () => {
		expect(wide.search).toBe(`?quill=${first}`);
		expect(narrow.search).toBe(`?quill=${first}`);
	});
});

describe('the built app, served under a subpath', () => {
	it('boots, lands on a card for each quill, and opens the form and its page', () => {
		for (const page of apps) {
			const where = `at ${page.viewport}px`;
			expect(page.booted, where).toBe(true);
			expect(page.cards, `several quills land on a choice ${where}`).toBeGreaterThan(1);
			expect(page.editorMounted, where).toBe(true);
			expect(page.previewMounted, where).toBe(true);
			expect(page.download, where).toBe(true);
		}
	});

	it('stands its tracks in the viewport, at both sides of the threshold', () => {
		for (const page of apps) {
			const where = `at ${page.viewport}px`;
			expect(page.shellWidth, `the shell is the viewport ${where}`).toBeCloseTo(page.viewport, 0);
			expect(page.splitWidth, `the tracks sum to the shell ${where}`).toBeCloseTo(
				page.shellWidth ?? 0,
				0
			);
			expect(page.scrollWidth, `nothing scrolls sideways ${where}`).toBeLessThanOrEqual(
				page.viewport
			);
		}
	});
});
