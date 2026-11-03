/**
 * Runs the room: two people type, a slow writer revises from an old read,
 * everyone converges, the log compacts, and two peers sync directly.
 *
 *   QUILLMARK_WASM=/path/to/quillmark/pkg node spikes/automerge-room/run.mjs
 */
import { strict as assert } from 'node:assert';
import { performance } from 'node:perf_hooks';
import { Client, Store, sync } from './room.mjs';

const pkg =
	process.env.QUILLMARK_WASM ?? new URL('../../../quillmark/pkg', import.meta.url).pathname;
const { init } = await import(`${pkg}/runtime/runtime.js`);
const { Document, SyncState } = await init();

const splice = (at, insert, del = '') => ({ steps: [{ splice: { at, delete: del, insert } }] });
const seed = Document.parse(
	'~~~\n$quill: memo@0.1.0\n~~~\n\nRevenue grew 12% this quarter.\n\nShip v2 in May.\n'
);
const store = new Store(seed.save());

const ann = new Client(Document, store, 'ann');
const bo = new Client(Document, store, 'bo');

const writer = new Client(Document, store, 'llm');
const read = writer.read();

ann.edit((doc, actor) => doc.apply({}, splice(0, 'Q3: '), { actor }));
bo.edit((doc, actor) => doc.apply({}, splice(bo.doc.read({}).text.length, ' Then v3.'), { actor }));
ann.pull();
bo.pull();
assert.equal(ann.doc.read({}).text, bo.doc.read({}).text);

const elsewhere = new Client(Document, store, 'server');
assert.throws(
	() => elsewhere.doc.revise({}, read.markdown.replace('12%', '15%'), { base: read.base }),
	/changed since/
);
const receipt = writer.doc.revise({}, read.markdown.replace('12%', '15%'), {
	base: read.base,
	actor: 'llm'
});
writer.push();
ann.pull();
bo.pull();
const text = ann.doc.read({}).text;
assert.equal(bo.doc.read({}).text, text);
assert.ok(text.includes('Q3: Revenue grew 15%') && text.includes('Then v3.'), text);
console.log('slow writer rebased:', receipt.rebased, '\n', JSON.stringify(text));
console.log('the same base hash in another process: edit::stale_base');

const entries = store.log.length;
const before = store.row.length + store.log.reduce((n, e) => n + e.length, 0);
store.compact(Document);
const late = new Client(Document, store, 'cy');
assert.equal(late.doc.read({}).text, text);
console.log(`compacted ${entries} entries: ${before} bytes -> ${store.row.length} bytes`);

const a = Document.fromBytes(store.row);
const b = Document.fromBytes(store.row);
a.apply({}, splice(0, 'A '), { actor: 'a1' });
b.apply({}, splice(0, 'B '), { actor: 'b1' });
const crossed = sync(SyncState, a, b);
assert.equal(a.read({}).text, b.read({}).text);
console.log(`sync: ${crossed} messages, both read ${JSON.stringify(a.read({}).text.slice(0, 12))}`);

const big = Document.fromBytes(store.row);
const t0 = performance.now();
for (let i = 0; i < 500; i++) {
	const heads = big.heads();
	big.apply({}, splice(0, 'x'), { actor: 'ann' });
	big.saveSince(heads);
}
console.log(`500 keystrokes with an append each: ${(performance.now() - t0).toFixed(0)} ms`);
