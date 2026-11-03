// Probe 8: what the surface costs. The package size is the linked build's against the published
// one; the timings are a 100-message sync on a 20 000-character body. Numbers print; the
// assertions only hold what was measured to be measured.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BODY, core, docMd, parse, peers, step, typeAt, type Peer } from './helpers.js';

const modules = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules');
const root = (name: string) => join(modules, name);

function sizes(pkg: string) {
	const out: Record<string, { raw: number; gzip: number }> = {};
	for (const f of [
		'core/wasm_bg.wasm',
		'core/wasm.js',
		'render/wasm_bg.wasm',
		'runtime/runtime.js'
	]) {
		const p = join(root(pkg), f);
		out[f] = { raw: statSync(p).size, gzip: gzipSync(readFileSync(p)).length };
	}
	return out;
}

const ms = (f: () => void): number => {
	const t = performance.now();
	f();
	return performance.now() - t;
};

describe('cost', () => {
	it('package size, linked build against the published one', () => {
		const built = sizes('@quillmark/wasm');
		const published = sizes('@quillmark/wasm-published');
		const version = (n: string) =>
			JSON.parse(readFileSync(join(root(n), 'package.json'), 'utf8')).version;
		console.log(
			JSON.stringify({
				built: version('@quillmark/wasm'),
				published: version('@quillmark/wasm-published')
			}),
			JSON.stringify({ built, published }, null, 1)
		);
		expect(built['core/wasm_bg.wasm'].raw).toBeGreaterThan(0);
	});

	it('a 100-message sync on a 20 000-character body', () => {
		const para =
			'The quick brown fox jumps over the lazy dog, and then some more words follow here. ';
		const body = Array.from({ length: 202 }, (_, i) => `${i} ${para}${para}`.slice(0, 99)).join(
			'\n\n'
		);
		const md = docMd(body);
		const origin = parse(md);
		const chars = origin.read(BODY).text.length;
		let seed!: Uint8Array;
		const build = ms(() => (seed = origin.save(BODY)));
		const [a, b] = peers(2, () => parse(md));
		const load = ms(() => {
			a.doc.load(BODY, seed);
			b.doc.load(BODY, seed);
		});
		let messages = 0;
		let syncMs = 0;
		let applyMs = 0;
		let edits = 0;
		const sync = (x: Peer, y: Peer) => {
			syncMs += ms(() => {
				for (;;) {
					const one = step(x, y, BODY);
					const two = step(y, x, BODY);
					messages += Number(one) + Number(two);
					if (!one && !two) return;
				}
			});
		};
		for (let i = 0; messages < 100; i++) {
			const p = i % 2 ? a : b;
			const at = (i * 997) % chars;
			edits++;
			applyMs += ms(() => typeAt(p, BODY, p.doc.read(BODY).text[at] === '\n' ? at + 1 : at, 'k'));
			sync(a, b);
		}
		const late = parse(md);
		late.load(BODY, seed);
		const lp: Peer = {
			name: 'late',
			doc: late,
			actor: 'late',
			states: new Map(),
			receipts: [],
			errors: []
		};
		const before = messages;
		const join = ms(() => {
			while (step(a, lp, BODY) || step(lp, a, BODY)) messages++;
		});
		expect(a.doc.toStored()).toBe(b.doc.toStored());
		expect(core.Document.fromStored(a.doc.toStored()).read(BODY).text).toBe(late.read(BODY).text);
		let genMs = 0;
		let receives = 0;
		let recvMs = 0;
		const st = [core.Document.syncState(), core.Document.syncState()];
		for (let i = 0; i < 10; i++) {
			typeAt(a, BODY, 1, 'g');
			for (;;) {
				let m: Uint8Array | undefined;
				genMs += ms(() => (m = a.doc.generateSyncMessage(BODY, st[0])));
				let n: Uint8Array | undefined;
				if (m) ((recvMs += ms(() => lp.doc.receiveSyncMessage(BODY, st[1], m!))), receives++);
				genMs += ms(() => (n = lp.doc.generateSyncMessage(BODY, st[1])));
				if (n) ((recvMs += ms(() => a.doc.receiveSyncMessage(BODY, st[0], n!))), receives++);
				if (!m && !n) break;
			}
		}
		const result = {
			generateMsPerCall: +(genMs / (2 * receives)).toFixed(2),
			receiveMsPerMessage: +(recvMs / receives).toFixed(2),
			chars,
			seedBytes: seed.length,
			buildAndSaveMs: Math.round(build),
			loadTwoMs: Math.round(load),
			messages: before,
			syncMs: Math.round(syncMs),
			perMessageMs: +(syncMs / before).toFixed(2),
			edits,
			applyMsPerEdit: +(applyMs / edits).toFixed(2),
			lateJoinMessages: messages - before,
			lateJoinMs: Math.round(join),
			saveBytesAfter: a.doc.save(BODY).length
		};
		console.log(JSON.stringify(result, null, 1));
		expect(lp.doc.toStored()).toBe(a.doc.toStored());
	});
});
