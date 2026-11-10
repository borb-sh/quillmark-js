// The binding: a WASM `Document` kept equal to a Y state, in both directions.
//
// Local edits go out by `push`: after the Document commits, the binding writes what differs to Y,
// field by field. A content field is diffed (`write.ts`); a card's other fields are keys of its map,
// each written whole. Card inserts, removes and moves are written as those operations, because a
// diff of the card list cannot tell a move from two edits. Remote edits come in whole: a Y
// transaction from any other origin projects each root it touched into the Document, a content
// field through `replace`, which keeps the Document's own anchors. Nothing here knows the
// editor; the host hears what moved through `onRemote`.
//
// A field's Y form follows its value: a content value is a content root, a declared `text` or
// `richtext` field always one, anything else a value in the card map. A retype to a kind that does not declare the field leaves its root where it is, so an edit
// to the root racing the retype lands; the reader takes whichever form a field arrives in:
// `@<field>` in the card map says which root holds it.
import * as Y from 'yjs';
import type {
	Addr,
	Card,
	CardAddr,
	CardInput,
	Content,
	Document,
	PayloadItem,
	Quill,
	QuillCardSchema
} from '@quillmark/wasm';
import {
	BODY,
	CARDS,
	COMPANIONS,
	ID,
	KIND,
	MAIN,
	SESSION,
	TITLE,
	canonical,
	contentRoot,
	contentTypes,
	present,
	readField
} from './shape.js';
import { inserts, project, type Projection } from './project.js';
import { unrepaired } from './repaired.js';
import { withoutAnchors, writeContent, type Mint } from './write.js';
import { deltaOf, type Delta } from './delta.js';
import { commonRun } from './lines.js';
import type { Grain } from './words.js';

/** A change to the composable card list, by index, as the Document takes it. */
export type CardOp =
	| { op: 'insert'; at: number }
	| { op: 'remove'; at: number }
	| { op: 'move'; from: number; to: number };

/**
 * The card operations that take a list of `count` cards to the one `from` describes: for each
 * card of the new list, the index of the old card it is, or `null` for an inserted one, as
 * `writer.reviseDocument`'s receipt reports. Removals come first, highest index first. The kept
 * cards that stay put are the longest run the old and new orders share, picked as `changesSince`
 * and `writeFrom`'s conflict check pick it, so the update moves exactly the cards they read as
 * moved. Every other kept card is moved once and every inserted card inserted, each placed after
 * the card before it in the new list. Throws `RangeError` when `from` names a card twice or one
 * past `count`.
 */
export function cardOps(from: readonly (number | null)[], count: number): CardOp[] {
	const kept = from.filter((i): i is number => i !== null);
	const named = new Set(kept);
	if (named.size < kept.length || kept.some((i) => !Number.isInteger(i) || i < 0 || i >= count))
		throw new RangeError(`cardOps: from names a card twice or one past ${count} cards`);
	const ops: CardOp[] = [];
	for (let i = count - 1; i >= 0; i--) if (!named.has(i)) ops.push({ op: 'remove', at: i });

	const list = [...kept].sort((x, y) => x - y);
	const stays = new Set(commonRun(list.map(String), kept.map(String)).map(([i]) => list[i]));
	const key = (j: number) => from[j] ?? -1 - j;
	from.forEach((i, j) => {
		if (i !== null && stays.has(i)) return;
		const at = i === null ? -1 : list.indexOf(i);
		if (at >= 0) list.splice(at, 1);
		const to = j === 0 ? 0 : list.indexOf(key(j - 1)) + 1;
		list.splice(to, 0, key(j));
		if (i === null) ops.push({ op: 'insert', at: to });
		else ops.push({ op: 'move', from: at, to });
	});
	return ops;
}

/** A card by its place in the Document: the main card, or a composable card's index. */
export type CardRef = 'main' | number;

/** What a remote transaction moved in the Document, already applied there. */
export interface RemoteChange {
	/** Card list operations, in the order they were applied. */
	cards: CardOp[];
	/** Cards, by their index after `cards`, whose kind, title or whole-value fields changed. */
	fields: CardRef[];
	/** Text and content fields that changed. A field revised in place carries the change its text
	 *  took in the Document, which a host maps its selection through; one that landed whole
	 *  carries none. A card `cards` inserted is new as a whole and is not
	 *  listed. */
	content: { addr: Addr; delta?: Delta }[];
}

export interface BindDocumentOpts {
	doc: Document;
	quill: Quill;
	ydoc: Y.Doc;
	/** Whether this client leads: it writes back a repair that inserts once it reads one, so the
	 *  state no longer needs it. A binding alone on its Y.Doc leads; one among peers leads only
	 *  where its session elects it. */
	leader: boolean;
	onRemote?(change: RemoteChange): void;
	/** A remote value the Document refused. The field keeps its last value. */
	onError?(error: unknown): void;
	/** `holding` turned: a remote value the Document refused is now held, or the last one is
	 *  released. While it holds one, the Document is not the Y state's projection, so a host
	 *  that saves the Document waits. */
	onHolding?(holding: boolean): void;
}

export interface DocumentBinding {
	/**
	 * Write the Document's committed state to Y, after a local edit. Pass the card operations the
	 * edit was, in order; anything else is found by comparing. Returns the content fields the
	 * write changed in the Document in turn, where a new island took a minted id: the host
	 * redraws them.
	 */
	push(op?: CardOp | readonly CardOp[]): Addr[];
	/** The Y id of each composable card, in Document order. */
	readonly ids: readonly string[];
	/** Whether a remote value the Document refused is held: the Document is then not the Y
	 *  state's projection, and a save of it would leave that value out. */
	readonly holding: boolean;
	/** Whether this client leads (`BindDocumentOpts.leader`). Set it as the session's election
	 *  moves; a binding made leader writes back each repair that inserts it reads now. */
	leader: boolean;
	destroy(): void;
}

/** Which form a field takes in Y: a content root, or a card-map value. */
type Form = 'content' | 'value';

export function bindDocument(opts: BindDocumentOpts): DocumentBinding {
	return bindWith(opts, 'char');
}

/** `bindDocument` writing at `grain`: a write from a revision writes whole words. */
export function bindWith(opts: BindDocumentOpts, grain: Grain): DocumentBinding {
	const { doc, quill, ydoc } = opts;
	const origin = Symbol('quillmark-collab');
	const mint = minter(ydoc);
	const reader = quill.reader(doc);
	const order = ydoc.getArray<string>(CARDS);
	let ids: string[] = [];
	/** Each root's value as last synced, both sides agreeing: a push skips a field whose
	 *  Document value still reads this. */
	const synced = new Map<string, string>();
	/** Cards and fields, by Y name, whose last remote value the Document refused. A push leaves
	 *  them as Y holds them: the Document's value is not one this client synced. */
	const held = new Set<string>();
	/** The roots whose projection last read through a repair that inserts: a write there holds
	 *  what the repair mended as Y holds it (`unrepaired`). */
	const inserting = new Set<string>();
	/** The fields a pull landed under ids Y does not hold, written back once it ends. */
	let reminted: { root: string; addr: Addr }[] = [];
	/** The cards a pull gave another `$id` than their map claims, written back once it ends. */
	let claims: string[] = [];
	/** The card list a remote change could not be applied to: nothing more is pulled or pushed. */
	let diverged = false;
	let mismatchReported = false;

	const report = (error: unknown) => opts.onError?.(error);
	let leader = opts.leader;
	const nameOf = (c: CardRef): string => (c === MAIN ? MAIN : ids[c]);
	const addrOf = (c: CardRef, field?: string): Addr => ({
		...(c === MAIN ? {} : { card: c }),
		...(field === undefined ? {} : { field })
	});
	const cardAddr = (c: CardRef): CardAddr => (c === MAIN ? {} : { card: c });
	const cardOf = (c: CardRef): Card => (c === MAIN ? doc.main : doc.card(c));
	/** `addr` naming its card by `$id`, as a content write takes it. */
	const writeAddr = (addr: Addr): Addr =>
		typeof addr.card === 'number' ? { ...addr, card: doc.card(addr.card).id } : addr;
	const schemaOf = (c: CardRef, kind?: string): QuillCardSchema | undefined =>
		c === MAIN ? quill.schema.main : quill.schema.card_kinds?.[kind ?? doc.card(c).kind];
	const refs = (): CardRef[] => [MAIN, ...ids.map((_, i) => i)];

	/** The form `schema` declares for field `name`; an undeclared field is a value. */
	const declared = (schema: QuillCardSchema | undefined, name: string): Form =>
		schema && Object.hasOwn(schema.fields, name) ? formOf(schema.fields[name].type) : 'value';
	/** The form `value` is written in: a content root where the kind declares one or the value is
	 *  content, else a value. */
	const formFor = (declared: Form, value: unknown): Form =>
		declared === 'content' || isContent(value) ? 'content' : 'value';
	/** The form a field arrives in from Y; `undefined` where Y holds none. */
	const arrived = (map: Y.Map<unknown>, key: string): Form | undefined => {
		if (map.get(present(key)) === 'content') return 'content';
		return map.has(key) ? 'value' : undefined;
	};

	/** A content field's value in the Document, as content; `undefined` where it is absent. */
	function storedContent(addr: Addr): Content | undefined {
		const v = doc.getStored(addr);
		if (v == null) return undefined;
		if (typeof v === 'object') return v as Content;
		return reader.getContent(addr) ?? undefined;
	}
	function projectField(root: string): Projection {
		const projection = project(readField(contentTypes(ydoc, root)));
		if (projection.repairs.some(inserts)) inserting.add(root);
		else inserting.delete(root);
		return projection;
	}
	const projectRoot = (root: string): Content => projectField(root).content;

	/** Write `content` over the content root `root`. A peer other than the leader writes back no
	 *  repair that inserts: it reads it through `repair`. */
	function writeField(root: string, content: Content): Map<string, string> {
		const types = contentTypes(ydoc, root);
		if (leader || !inserting.has(root)) return writeContent(types, content, mint, grain);
		const raw = readField(types);
		const projection = project(raw);
		if (!projection.repairs.some(inserts)) {
			inserting.delete(root);
			return writeContent(types, content, mint, grain);
		}
		return writeContent(types, unrepaired(raw, projection.content, content), mint, grain);
	}

	// ── Document → Y ─────────────────────────────────────────────────────────

	function push(op?: CardOp | readonly CardOp[]): Addr[] {
		if (diverged) return [];
		const ops = op === undefined ? [] : Array.isArray(op) ? op : [op as CardOp];
		const renames: { root: string; addr: Addr }[] = [];
		ydoc.transact(() => {
			for (const o of ops) applyOp(o);
			if (!ops.length && doc.cardCount !== ids.length) realign();
			for (const c of refs()) pushCard(c, renames);
		}, origin);
		const rewritten: Addr[] = [];
		const reminted: { root: string; addr: Addr }[] = [];
		for (const { root, addr } of renames) {
			try {
				land(root, addr, projectRoot(root), reminted);
				rewritten.push(addr);
			} catch (e) {
				report(e);
			}
		}
		writeBack(reminted);
		return rewritten;
	}

	/**
	 * Write `content`, the projection of `root`, over the field at `addr`. The value `replace`
	 * lands can differ from the projection by ids; such a field is named in `reminted`, to be
	 * written back to Y. A field the Document does not hold is stored whole, as `replace` would
	 * write it in the rich codec. Returns the change the write made to the field's text, none for
	 * one stored whole.
	 */
	function land(
		root: string,
		addr: Addr,
		content: Content,
		reminted: { root: string; addr: Addr }[]
	): Delta | undefined {
		const held = storedContent(addr) !== undefined;
		const applied = held ? doc.replace(writeAddr(addr), content).applied : undefined;
		if (!held) doc.unchecked.storeField(addr, content);
		const landed = contentKey(storedContent(addr));
		synced.set(root, landed);
		if (landed !== contentKey(content)) reminted.push({ root, addr });
		return applied && deltaOf(applied);
	}

	/** Write each field's Document value to Y, where it landed under ids Y does not hold or,
	 *  for the leader, read through a repair that inserts. */
	function writeBack(reminted: { root: string; addr: Addr }[], named: string[] = []): void {
		if (!reminted.length && !named.length) return;
		ydoc.transact(() => {
			for (const name of named) {
				const c = ids.indexOf(name);
				if (c >= 0) ydoc.getMap<unknown>(name).set(ID, doc.card(c).id);
			}
			for (const { root, addr } of reminted) {
				const content = storedContent(addr);
				if (content) writeField(root, content);
			}
		}, origin);
	}

	/** Where the `k`th card in Document order sits in `$cards`, which can hold an id twice
	 *  after two concurrent moves of one card. `k` past the end is the end. */
	function yIndex(k: number): number {
		if (k >= ids.length) return order.length;
		return order.toArray().indexOf(ids[k]);
	}
	function dropFromOrder(id: string): void {
		const all = order.toArray();
		for (let i = all.length - 1; i >= 0; i--) if (all[i] === id) order.delete(i, 1);
	}

	function applyOp(op: CardOp): void {
		if (op.op === 'insert') {
			const id = mint();
			order.insert(yIndex(op.at), [id]);
			ids.splice(op.at, 0, id);
		} else if (op.op === 'remove') {
			const [id] = ids.splice(op.at, 1);
			if (id !== undefined) dropFromOrder(id);
		} else {
			const [id] = ids.splice(op.from, 1);
			if (id === undefined) return;
			dropFromOrder(id);
			order.insert(yIndex(op.to), [id]);
			ids.splice(op.to, 0, id);
		}
	}

	/** The card list changed with no operation named: cards added at the end or dropped from
	 *  it, the only reading a count alone supports. */
	function realign(): void {
		while (ids.length > doc.cardCount) applyOp({ op: 'remove', at: ids.length - 1 });
		while (ids.length < doc.cardCount) applyOp({ op: 'insert', at: ids.length });
	}

	function pushCard(c: CardRef, renames: { root: string; addr: Addr }[]): void {
		const name = nameOf(c);
		if (held.has(name)) return;
		const card = cardOf(c);
		const map = ydoc.getMap<unknown>(name);
		if (c !== MAIN && map.get(KIND) !== card.kind) map.set(KIND, card.kind);
		if (c !== MAIN && map.get(ID) !== card.id) map.set(ID, card.id);
		const title = titleOf(card.ext);
		if ((map.get(TITLE) ?? null) !== (title ?? null)) {
			if (title === undefined) map.delete(TITLE);
			else map.set(TITLE, title);
		}
		const schema = schemaOf(c, card.kind);
		pushContent(contentRoot(name), addrOf(c), card.body, renames);

		const seen = new Set<string>();
		for (const item of fieldItems(card.payloadItems)) {
			const addr = addrOf(c, item.key);
			const form = formFor(declared(schema, item.key), item.value);
			const root = contentRoot(name, item.key);
			if (held.has(root)) {
				seen.add(item.key).add(present(item.key));
				continue;
			}
			if (form === 'value') {
				seen.add(item.key);
				if (canonical(map.get(item.key)) !== canonical(item.value))
					map.set(item.key, structuredClone(item.value));
				continue;
			}
			seen.add(present(item.key));
			if (map.get(present(item.key)) !== form) {
				clearRoot(root);
				map.set(present(item.key), form);
			}
			const content = storedContent(addr);
			if (content) pushContent(root, addr, content, renames);
		}
		for (const key of [...map.keys()]) {
			if (key.startsWith('$') || seen.has(key)) continue;
			if (held.has(contentRoot(name, key.startsWith('@') ? key.slice(1) : key))) continue;
			map.delete(key);
		}
	}

	/** Empty a root whose form is changing, so the new form is written over nothing. */
	function clearRoot(root: string): void {
		const { text, meta, containers } = contentTypes(ydoc, root);
		if (text.length) text.delete(0, text.length);
		for (const key of [...meta.keys()]) meta.delete(key);
		for (const key of [...containers.keys()]) containers.delete(key);
		synced.delete(root);
		inserting.delete(root);
	}

	function pushContent(
		root: string,
		addr: Addr,
		content: Content,
		renames: { root: string; addr: Addr }[]
	): void {
		const value = contentKey(content);
		if (held.has(root) || synced.get(root) === value) return;
		const renamed = writeField(root, content);
		synced.set(root, value);
		if (renamed.size) renames.push({ root, addr });
	}

	// ── Y → Document ─────────────────────────────────────────────────────────

	function pull(touched: Set<string> | 'all'): RemoteChange {
		const change: RemoteChange = { cards: [], fields: [], content: [] };
		if (diverged) return change;
		const hit = (name: string) => touched === 'all' || touched.has(name);
		reminted = [];
		claims = [];
		const hitRoot = (root: string) => hit(root) || COMPANIONS.some((s) => hit(`${root}${s}`));
		const inserted = new Set<string>();
		const listMoved =
			touched === 'all' || touched.has(CARDS) || order.toArray().some((id) => touched.has(id));
		if (listMoved) pullCards(change, inserted);
		if (diverged) return change;
		for (const c of refs()) {
			const name = nameOf(c);
			if (inserted.has(name)) continue;
			const map = ydoc.getMap<unknown>(name);
			if (hit(name)) pullCard(c, change);
			if (hitRoot(contentRoot(name))) pullBody(c, change);
			for (const key of [...map.keys()]) {
				if (!key.startsWith('@')) continue;
				const field = key.slice(1);
				if (hitRoot(contentRoot(name, field))) pullField(c, field, change);
			}
		}
		writeBack(reminted, claims);
		const session = ydoc.getMap<unknown>(SESSION).get('quill');
		if (typeof session === 'string' && session !== doc.quillRef && !mismatchReported) {
			mismatchReported = true;
			report(new Error(`the session is seeded under ${session}, the document is ${doc.quillRef}`));
		}
		return change;
	}

	function pullCards(change: RemoteChange, inserted: Set<string>): void {
		const seen = new Set<string>();
		const target = order.toArray().filter((id) => {
			if (seen.has(id) || typeof ydoc.getMap(id).get(KIND) !== 'string') return false;
			seen.add(id);
			return true;
		});
		const want = cardIds(target);
		try {
			for (let i = ids.length - 1; i >= 0; i--) {
				if (seen.has(ids[i])) continue;
				doc.removeCard(i);
				ids.splice(i, 1);
				change.cards.push({ op: 'remove', at: i });
			}
			// A card whose `$id` the list now gives another card leaves, to return under its own.
			const rekeyed = new Map<string, Card>();
			for (let i = ids.length - 1; i >= 0; i--) {
				if (doc.card(i).id === want.get(ids[i])) continue;
				rekeyed.set(ids[i], doc.card(i));
				doc.removeCard(i);
				ids.splice(i, 1);
				change.cards.push({ op: 'remove', at: i });
			}
			for (let i = 0; i < target.length; i++) {
				if (ids[i] === target[i]) continue;
				const j = ids.indexOf(target[i]);
				if (j >= 0) {
					doc.moveCard(j, i);
					ids.splice(j, 1);
					ids.splice(i, 0, target[i]);
					change.cards.push({ op: 'move', from: j, to: i });
					continue;
				}
				const was = rekeyed.get(target[i]);
				const id = want.get(target[i])!;
				doc.unchecked.insertCard(was ? { ...was, id } : cardFromY(target[i], id), i);
				ids.splice(i, 0, target[i]);
				change.cards.push({ op: 'insert', at: i });
				if (was) continue;
				inserted.add(target[i]);
				markSynced(i);
			}
		} catch (e) {
			diverged = true;
			report(new Diverged(e));
			return;
		}
		for (const name of target) if (ydoc.getMap(name).get(ID) !== want.get(name)) claims.push(name);
	}

	/**
	 * The `$id` each card of `target`, in list order, takes: the one its map claims, where it is a
	 * card id no card before it took, else its Y name. Two clients that place a card at once mint
	 * one id, and every client hands it to the same card.
	 */
	function cardIds(target: readonly string[]): Map<string, string> {
		const out = new Map<string, string>();
		const taken = new Set<string>();
		for (const name of target) {
			const claim = ydoc.getMap(name).get(ID);
			if (typeof claim !== 'string' || !CARD_ID.test(claim) || taken.has(claim)) continue;
			out.set(name, claim);
			taken.add(claim);
		}
		for (const name of target) {
			if (out.has(name)) continue;
			let id = name;
			for (let k = 1; taken.has(id); k++) id = `${name}-${k}`;
			out.set(name, id);
			taken.add(id);
		}
		return out;
	}

	/** A field's value as Y holds it, in whichever form it arrived; `undefined` where absent. */
	function yValue(name: string, key: string): unknown {
		const map = ydoc.getMap<unknown>(name);
		const form = arrived(map, key);
		if (form === 'content') return projectRoot(contentRoot(name, key));
		return form === 'value' ? structuredClone(map.get(key)) : undefined;
	}
	/** The field names Y holds for card `name`, in either form. */
	function yFields(name: string): string[] {
		const out = new Set<string>();
		for (const key of ydoc.getMap<unknown>(name).keys()) {
			if (key.startsWith('$')) continue;
			out.add(key.startsWith('@') ? key.slice(1) : key);
		}
		return [...out];
	}

	/** A composable card built from its Y state, for a card another client inserted. */
	function cardFromY(name: string, id: string): CardInput {
		const map = ydoc.getMap<unknown>(name);
		const kind = map.get(KIND) as string;
		const schema = quill.schema.card_kinds?.[kind];
		const order = Object.keys(schema?.fields ?? {});
		const held = yFields(name);
		const keys = [
			...order.filter((k) => held.includes(k)),
			...held.filter((k) => !order.includes(k)).sort()
		];
		const title = map.get(TITLE);
		return {
			kind,
			id,
			payloadItems: keys.map((key) => ({ type: 'field', key, value: yValue(name, key) })),
			body: projectRoot(contentRoot(name)),
			...(typeof title === 'string' ? { ext: { editor: { title } } } : {})
		};
	}

	/** Record every root of card `c` as synced at the value the Document now holds. */
	function markSynced(c: CardRef): void {
		const name = nameOf(c);
		synced.set(contentRoot(name), contentKey(storedContent(addrOf(c))));
		const map = ydoc.getMap<unknown>(name);
		for (const key of yFields(name))
			if (arrived(map, key) === 'content')
				synced.set(contentRoot(name, key), contentKey(storedContent(addrOf(c, key))));
	}

	function pullCard(c: CardRef, change: RemoteChange): void {
		const name = nameOf(c);
		const map = ydoc.getMap<unknown>(name);
		let moved = false;
		const kind = map.get(KIND);
		if (c !== MAIN && typeof kind === 'string' && kind !== doc.card(c).kind) {
			const was = doc.card(c);
			try {
				doc.removeCard(c);
				try {
					doc.unchecked.insertCard({ ...was, kind }, c);
				} catch (e) {
					doc.unchecked.insertCard(was, c);
					throw e;
				}
				moved = true;
			} catch (e) {
				held.add(name);
				return report(e);
			}
		}
		held.delete(name);
		const card = cardOf(c);
		const title = map.get(TITLE);
		if ((typeof title === 'string' ? title : undefined) !== titleOf(card.ext)) {
			storeTitle(doc, cardAddr(c), typeof title === 'string' ? title : undefined);
			moved = true;
		}
		const schema = schemaOf(c, card.kind);
		const keys = new Set([...yFields(name), ...fieldItems(card.payloadItems).map((i) => i.key)]);
		for (const key of keys) {
			const form = arrived(map, key);
			const addr = addrOf(c, key);
			const isLeaf = declared(schema, key) !== 'value';
			const root = contentRoot(name, key);
			try {
				if (form === undefined) {
					if (doc.getStored(addr) == null) {
						held.delete(root);
						continue;
					}
					doc.removeField(addr);
					synced.delete(contentRoot(name, key));
				} else if (form === 'content' && isLeaf) {
					if (doc.getStored(addr) != null) continue;
					pullField(c, key, change);
					continue;
				} else {
					const value = yValue(name, key);
					if (canonical(doc.getStored(addr)) === canonical(value)) continue;
					doc.unchecked.storeField(addr, value);
				}
				held.delete(root);
				if (isLeaf) change.content.push({ addr });
				else moved = true;
			} catch (e) {
				held.add(root);
				report(e);
			}
		}
		for (const root of held) {
			const key = root.slice(name.length + 1);
			if (root.startsWith(`${name}/`) && key !== BODY && !keys.has(key)) held.delete(root);
		}
		if (moved && !change.fields.includes(c)) change.fields.push(c);
	}

	function pullBody(c: CardRef, change: RemoteChange): void {
		reviseFrom(contentRoot(nameOf(c)), addrOf(c), change);
	}

	function pullField(c: CardRef, field: string, change: RemoteChange): void {
		const name = nameOf(c);
		const addr = addrOf(c, field);
		const form = arrived(ydoc.getMap<unknown>(name), field);
		const root = contentRoot(name, field);
		if (change.content.some((x) => sameAddr(x.addr, addr))) return;
		const schema = schemaOf(c);
		try {
			if (form === 'content' && declared(schema, field) === 'content')
				return reviseFrom(root, addr, change);
			const value = yValue(name, field);
			if (value === undefined || canonical(doc.getStored(addr)) === canonical(value)) return;
			doc.unchecked.storeField(addr, value);
			held.delete(root);
			synced.set(root, canonical(value));
			if (declared(schema, field) === 'value') {
				if (!change.fields.includes(c)) change.fields.push(c);
			} else change.content.push({ addr });
		} catch (e) {
			held.add(root);
			report(e);
		}
	}

	/** Write the projection of `root` over the content field at `addr`. */
	function reviseFrom(root: string, addr: Addr, change: RemoteChange): void {
		if (change.content.some((x) => sameAddr(x.addr, addr))) return;
		try {
			const projection = projectField(root);
			if (leader && projection.repairs.some(inserts)) reminted.push({ root, addr });
			const before = storedContent(addr);
			if (before && contentKey(before) === contentKey(projection.content)) {
				held.delete(root);
				synced.set(root, contentKey(before));
				return;
			}
			const delta = land(root, addr, projection.content, reminted);
			held.delete(root);
			change.content.push(delta ? { addr, delta } : { addr });
		} catch (e) {
			held.add(root);
			report(e);
		}
	}

	// ── Wiring ───────────────────────────────────────────────────────────────

	const onAfter = (tr: Y.Transaction) => {
		if (tr.origin === origin) {
			return;
		}
		const touched = new Set<string>();
		for (const [name, type] of ydoc.share)
			if (tr.changed.has(type) || tr.changedParentTypes.has(type as Y.AbstractType<Y.YEvent<any>>))
				touched.add(name);
		if (!touched.size) return;
		const holding = held.size > 0;
		const change = pull(touched);
		if (holding !== held.size > 0)
			try {
				opts.onHolding?.(!holding);
			} catch (e) {
				report(e);
			}
		if (!change.cards.length && !change.fields.length && !change.content.length) return;
		try {
			opts.onRemote?.(change);
		} catch (e) {
			report(e);
		}
	};

	if (ydoc.getMap(SESSION).has('quill') || order.length > 0 || ydoc.getMap(MAIN).size > 0) {
		// Adopt the Y ids by position where the kinds line up, so the cards keep what has no Y
		// form (comments, other `$ext` namespaces, anchors), and project the rest in.
		// Cards that do not line up are the Document's own and leave, so the list is Y's alone.
		const target = order.toArray();
		const adopted =
			target.length === doc.cardCount &&
			target.every((id, i) => ydoc.getMap(id).get(KIND) === doc.card(i).kind);
		ids = adopted ? [...target] : Array.from({ length: doc.cardCount }, (_, i) => `\0${i}`);
		pull('all');
	} else {
		ydoc.transact(() => {
			ids = Array.from({ length: doc.cardCount }, () => mint());
			order.insert(0, ids);
			ydoc.getMap<unknown>(SESSION).set('quill', doc.quillRef);
		}, origin);
		push();
	}
	ydoc.on('afterTransaction', onAfter);

	return {
		push,
		get ids() {
			return ids;
		},
		get holding() {
			return held.size > 0;
		},
		get leader() {
			return leader;
		},
		set leader(next: boolean) {
			if (next === leader) return;
			leader = next;
			if (!leader || !inserting.size) return;
			const change = pull('all');
			if (change.cards.length || change.fields.length || change.content.length) {
				try {
					opts.onRemote?.(change);
				} catch (e) {
					report(e);
				}
			}
		},
		destroy() {
			ydoc.off('afterTransaction', onAfter);
		}
	};
}

/**
 * The Y update that seeds a session with `doc`. It is written by client id 0 with ids minted from
 * that id, so every client that seeds the same Document writes the same bytes, and two of them
 * seeding at once land one copy rather than two.
 */
export function seedDocument(doc: Document, quill: Quill): Uint8Array {
	const ydoc = new Y.Doc({ gc: false });
	ydoc.clientID = 0;
	const own = doc.clone();
	bindDocument({ doc: own, quill, ydoc, leader: true }).destroy();
	own.free();
	const update = Y.encodeStateAsUpdate(ydoc);
	ydoc.destroy();
	return update;
}

/** A remote card-list change the Document refused: this client can no longer follow the
 *  session, and the binding stops. */
export class Diverged extends Error {
	constructor(readonly cause: unknown) {
		super(
			`the document refused a remote card change: ${cause instanceof Error ? cause.message : String(cause)}`
		);
	}
}

export { canonical };

const isContent = (v: unknown): v is Content =>
	typeof v === 'object' &&
	v !== null &&
	typeof (v as Content).text === 'string' &&
	Array.isArray((v as Content).blocks);

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function formOf(type: string): Form {
	const base = type.endsWith('?') ? type.slice(0, -1) : type;
	return base === 'richtext' || base === 'text' ? 'content' : 'value';
}

function fieldItems(items: PayloadItem[]): { key: string; value: unknown }[] {
	return items.filter((i): i is Extract<PayloadItem, { type: 'field' }> => i.type === 'field');
}

export function titleOf(ext: Record<string, unknown> | undefined): string | undefined {
	const t = (ext?.editor as { title?: unknown } | undefined)?.title;
	return typeof t === 'string' ? t : undefined;
}

/** Give the card at `addr` the title, the one part of its `$ext` a session carries. */
export function storeTitle(doc: Document, addr: CardAddr, title: string | undefined): void {
	const ext = doc.getExt(addr) ?? {};
	const editor = { ...((ext.editor as Record<string, unknown> | undefined) ?? {}) };
	if (title === undefined) delete editor.title;
	else editor.title = title;
	const { editor: _, ...rest } = ext;
	const next = Object.keys(editor).length ? { ...rest, editor } : rest;
	if (Object.keys(next).length) doc.storeExt(addr, next);
	else if (doc.getExt(addr)) doc.removeExt(addr);
}

const sameAddr = (a: Addr, b: Addr): boolean => a.card === b.card && a.field === b.field;

/** A content value's key for comparing what Y carries: its anchors are the Document's own. */
function contentKey(content: Content | undefined): string {
	return canonical(content ? withoutAnchors(content) : null);
}

function minter(ydoc: Y.Doc): Mint {
	const prefix = ydoc.clientID.toString(36);
	let n = 0;
	return () => `${prefix}-${(n++).toString(36)}`;
}
