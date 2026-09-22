// One page loaded in a real browser, over the debugging protocol it already speaks: a
// spawn, an endpoint read off stderr, three protocol calls. Node's own `WebSocket` is the
// transport, so a load costs the workspace no dependency, and the browser is whatever the
// host has.
//
// The workspace's, not one package's: quillkit's suite loads a laid site with it and
// `scripts/playground.mjs` loads a served playground with it, which is how a CSS fact in
// `@quillmark/svelte` is asked of a browser at all (CLAUDE.md §Verification).

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** A Playwright cache, by its own layout: a versioned directory per build. */
function cached() {
	const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
	if (cache === undefined || !existsSync(cache)) return [];
	// This repository's containers link the binary at the cache's root.
	const paths = [join(cache, 'chromium')];
	for (const entry of readdirSync(cache))
		if (entry.startsWith('chromium-')) paths.push(join(cache, entry, 'chrome-linux', 'chrome'));
	return paths;
}

/**
 * Where a browser is, in the order a host is likely to have one: the override, a
 * Playwright cache, then the package managers' paths on Linux and macOS. CI lands on
 * `/usr/bin/google-chrome`, the runner image shipping Chrome and no cache.
 */
function candidates() {
	return [
		process.env.QUILLKIT_CHROME,
		process.env.CHROME_PATH,
		...cached(),
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/snap/bin/chromium',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium'
	].filter((path) => path !== undefined);
}

/** The first candidate that is a binary, or a refusal naming the way out. */
export function chrome() {
	const tried = candidates();
	const at = tried.find((path) => existsSync(path) && statSync(path).isFile());
	if (at === undefined)
		throw new Error(
			`no browser found: install Chrome or Chromium, or set QUILLKIT_CHROME to one (tried ${tried.join(', ')})`
		);
	return at;
}

/**
 * `expression` owns its own waiting: the load event fires before a client has fetched
 * anything of its own, so what comes back is whatever the page holds when the
 * expression's promise settles.
 */
export async function load(url, expression, viewport) {
	const profile = await mkdtemp(join(tmpdir(), 'quillmark-chrome-'));
	const child = spawn(
		chrome(),
		[
			'--headless=new',
			// Containers run as root, where the sandbox refuses to start, and the page
			// loaded is one this process just laid on disk and served to itself.
			'--no-sandbox',
			'--disable-gpu',
			// A scrollbar takes its width out of the viewport, which would leave a caller's
			// widths off by a platform's chrome.
			'--hide-scrollbars',
			`--window-size=${viewport.width},${viewport.height}`,
			`--user-data-dir=${profile}`,
			// The port the OS hands out, printed on stderr with the endpoint.
			'--remote-debugging-port=0',
			'about:blank'
		],
		// Its own process group: a browser is a tree, and killing the parent alone leaves
		// children writing into the profile.
		{ detached: true }
	);
	// Its own group is out of reach of the signal that ends this process, so an exit that
	// skips the `finally` below takes it down here.
	const kill = () => {
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch {
			// Gone already.
		}
	};
	process.once('exit', kill);

	try {
		const endpoint = await new Promise((ok, no) => {
			let said = '';
			const timer = setTimeout(() => no(new Error(`browser printed no endpoint: ${said}`)), 30_000);
			child.stderr.on('data', (chunk) => {
				said += chunk.toString();
				const match = /ws:\/\/\S+/.exec(said);
				if (match) {
					clearTimeout(timer);
					ok(match[0]);
				}
			});
			child.on('error', no);
		});

		const targets = await (
			await fetch(new URL('/json/list', endpoint.replace('ws:', 'http:')))
		).json();
		const page = targets.find((t) => t.type === 'page');
		if (page === undefined) throw new Error('the browser opened no page');

		const socket = new WebSocket(page.webSocketDebuggerUrl);
		await new Promise((ok, no) => {
			socket.onopen = ok;
			socket.onerror = () => no(new Error(`cannot reach ${page.webSocketDebuggerUrl}`));
		});

		let last = 0;
		const answers = new Map();
		const events = new Map();
		socket.onmessage = (message) => {
			const said = JSON.parse(String(message.data));
			if (said.id !== undefined) answers.get(said.id)?.(said);
			else if (said.method !== undefined) events.get(said.method)?.();
		};
		// A call the browser refuses answers with `error` in place of `result`: a page that
		// navigated under an evaluation destroys the context it was running in.
		const call = (method, params) =>
			new Promise((ok, no) => {
				const id = ++last;
				answers.set(id, (said) => {
					answers.delete(id);
					if (said.error !== undefined) no(new Error(`${method}: ${said.error.message}`));
					else ok(said.result ?? {});
				});
				socket.send(JSON.stringify({ id, method, params }));
			});
		const fired = (method) => new Promise((ok) => events.set(method, ok));

		await call('Page.enable');
		// Armed before the navigation, the event being the answer to it.
		const loaded = fired('Page.loadEventFired');
		await call('Page.navigate', { url });
		await loaded;

		const answer = await call('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		});
		if (answer.exceptionDetails !== undefined)
			throw new Error(answer.exceptionDetails.exception?.description ?? 'the page threw');
		return answer.result.value;
	} finally {
		process.off('exit', kill);
		// The group, then the wait: a removal racing the tree's last flush finds a
		// directory refilling under it.
		const gone = new Promise((done) =>
			child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', done)
		);
		kill();
		await gone;
		await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	}
}
