// The binding: a WASM `Document` kept equal to a Y state, in both directions.
//
// Local edits go out by `push`: after the Document commits, the binding writes what differs to Y,
// field by field. A content field is diffed (`write.ts`); a card's other fields are keys of its map,
// each written whole. Card inserts, removes and moves are written as those operations, because a
// diff of the card list cannot tell a move from two edits. Remote edits come in whole: a Y
// transaction from any other origin projects each root it touched into the Document, a content
// field through `reviseContent`, which keeps the Document's own anchors. Nothing here knows the
// editor; the host hears what moved through `onRemote`.
//
// A field's Y form follows its declared type on the card's current kind: a `richtext` field is a
// content root, a `text` field a plain one, anything else a value in the card map. A retype can
// change which, so the writer always writes the form the kind declares and the reader takes
// whichever form a field arrives in: `@<field>` in the card map says which root holds it.
import * as Y from 'yjs';
import type {
	Addr,
	Card,
	CardAddr,
	CardInput,
	Content,
	Delta,
	Document,
	PayloadItem,
	Quill,
	QuillCardSchema
} from '@quillmark/wasm';
import {
	CARDS,
	KIND,
	MAIN,
	SESSION,
	TITLE,
	contentRoot,
	contentTypes,
	present,
	readField,
	utf16
} from './shape.js';
import { project } from './project.js';
import { writeContent, type Mint } from './write.js';
import { usvDelta } from './delta.js';
import { changedRuns, commonRun } from './lines.js';

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
	/** Text and content fields that changed. A content field revised in place carries the delta
	 *  from its previous text, which a host maps its selection through; one that landed whole,
	 *  and a `text` field, carry none. A card `cards` inserted is new as a whole and is not
	 *  listed. */
	content: { addr: Addr; delta?: Delta }[];
}

export interface BindDocumentOpts {
	doc: Document;
	quill: Quill;
	ydoc: Y.Doc;
	onRemote?(change: RemoteChange): void;
	/** A remote value the Document refused. The field keeps its last value. */
	onError?(error: unknown): void;
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
	destroy(): void;
}

/** Which form a field takes in Y: a content root, a plain-text root, or a card-map value. */
type Form = 'content' | 'plain' | 'value';

export function bindDocument(opts: BindDocumentOpts): DocumentBinding {
	const { doc, quill, ydoc } = opts;
	const origin = Symbol('quillmark-collab');
	const mint = minter(ydoc);
	const reader = quill.reader(doc);
	const order = ydoc.getArray<string>(CARDS);
	let ids: string[] = [];
	/** Each root's value as last synced, both sides agreeing: a push skips a field whose
	 *  Document value still reads this. */
	const synced = new Map<string, string>();
	/** The text event of the transaction in flight, per root, read by the pull. */
	const events = new Map<string, Y.YTextEvent>();
	const observed = new Map<Y.Text, (e: Y.YTextEvent) => void>();
	/** Cards and fields, by Y name, whose last remote value the Document refused. A push leaves
	 *  them as Y holds them: the Document's value is not one this client synced. */
	const held = new Set<string>();
	/** The card list a remote change could not be applied to: nothing more is pulled or pushed. */
	let diverged = false;
	let mismatchReported = false;

	const report = (error: unknown) => opts.onError?.(error);
	const nameOf = (c: CardRef): string => (c === MAIN ? MAIN : ids[c]);
	const addrOf = (c: CardRef, field?: string): Addr => ({
		...(c === MAIN ? {} : { card: c }),
		...(field === undefined ? {} : { field })
	});
	const cardAddr = (c: CardRef): CardAddr => (c === MAIN ? {} : { card: c });
	const cardOf = (c: CardRef): Card => (c === MAIN ? doc.main : doc.card(c));
	const schemaOf = (c: CardRef, kind?: string): QuillCardSchema | undefined =>
		c === MAIN ? quill.schema.main : quill.schema.card_kinds?.[kind ?? doc.card(c).kind];
	const refs = (): CardRef[] => [MAIN, ...ids.map((_, i) => i)];

	/** The form `schema` declares for field `name`; an undeclared field is a value. */
	const declared = (schema: QuillCardSchema | undefined, name: string): Form =>
		schema && Object.hasOwn(schema.fields, name) ? formOf(schema.fields[name].type) : 'value';
	/** The form a field arrives in from Y; `undefined` where Y holds none. */
	const arrived = (map: Y.Map<unknown>, key: string): Form | undefined => {
		const at = map.get(present(key));
		if (at === 'content' || at === 'plain') return at;
		return map.has(key) ? 'value' : undefined;
	};

	/** Observe a content root's text, so a pull reads the change's own delta. */
	function watch(root: string): void {
		const text = ydoc.getText(root);
		if (observed.has(text)) return;
		const fn = (e: Y.YTextEvent) => events.set(root, e);
		text.observe(fn);
		observed.set(text, fn);
	}
	function watchCard(name: string, schema: QuillCardSchema | undefined): void {
		watch(contentRoot(name));
		for (const [field, f] of Object.entries(schema?.fields ?? {}))
			if (formOf(f.type) === 'content') watch(contentRoot(name, field));
	}

	/** A content field's value in the Document, as content; `undefined` where it is absent. */
	function storedContent(addr: Addr): Content | undefined {
		const v = doc.getStored(addr);
		if (v == null) return undefined;
		if (typeof v === 'object') return v as Content;
		return reader.getContent(addr) ?? undefined;
	}
	const projectRoot = (root: string): Content =>
		project(readField(contentTypes(ydoc, root))).content;

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
		for (const { root, addr } of renames) {
			try {
				doc.reviseContent(addr, projectRoot(root));
				synced.set(root, contentKey(storedContent(addr)));
				rewritten.push(addr);
			} catch (e) {
				report(e);
			}
		}
		return rewritten;
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
		const title = titleOf(card.ext);
		if ((map.get(TITLE) ?? null) !== (title ?? null)) {
			if (title === undefined) map.delete(TITLE);
			else map.set(TITLE, title);
		}
		const schema = schemaOf(c, card.kind);
		watchCard(name, schema);
		pushContent(contentRoot(name), addrOf(c), card.body, renames);

		const seen = new Set<string>();
		for (const item of fieldItems(card.payloadItems)) {
			const addr = addrOf(c, item.key);
			let form = declared(schema, item.key);
			if (form === 'plain' && typeof item.value !== 'string') form = 'value';
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
			if (form === 'plain') pushPlain(root, item.value as string);
			else {
				const content = storedContent(addr);
				if (content) pushContent(root, addr, content, renames);
			}
		}
		for (const key of [...map.keys()]) {
			if (key.startsWith('$') || seen.has(key)) continue;
			if (held.has(contentRoot(name, key.startsWith('@') ? key.slice(1) : key))) continue;
			map.delete(key);
		}
	}

	/** Empty a root whose form is changing, so the new form is written over nothing. */
	function clearRoot(root: string): void {
		const { text, meta } = contentTypes(ydoc, root);
		if (text.length) text.delete(0, text.length);
		for (const key of [...meta.keys()]) meta.delete(key);
		synced.delete(root);
	}

	function pushContent(
		root: string,
		addr: Addr,
		content: Content,
		renames: { root: string; addr: Addr }[]
	): void {
		const value = contentKey(content);
		if (held.has(root) || synced.get(root) === value) return;
		watch(root);
		const renamed = writeContent(contentTypes(ydoc, root), content, mint);
		synced.set(root, value);
		if (renamed.size) renames.push({ root, addr });
	}

	function pushPlain(root: string, value: string): void {
		const json = JSON.stringify(value);
		if (synced.get(root) === json) return;
		spliceText(ydoc.getText(root), value);
		synced.set(root, json);
	}

	// ── Y → Document ─────────────────────────────────────────────────────────

	function pull(touched: Set<string> | 'all'): RemoteChange {
		const change: RemoteChange = { cards: [], fields: [], content: [] };
		if (diverged) return change;
		const hit = (name: string) => touched === 'all' || touched.has(name);
		const hitRoot = (root: string) => hit(root) || hit(`${root}#line0`);
		const inserted = new Set<string>();
		const known = new Set(ids);
		const listMoved =
			touched === 'all' ||
			touched.has(CARDS) ||
			order.toArray().some((id) => !known.has(id) && touched.has(id));
		if (listMoved) pullCards(change, inserted);
		if (diverged) return change;
		const reids: [Y.Map<unknown>, string][] = [];
		for (const c of refs()) {
			const name = nameOf(c);
			if (inserted.has(name)) continue;
			const map = ydoc.getMap<unknown>(name);
			if (hit(name)) pullCard(c, change, reids);
			if (hitRoot(contentRoot(name))) pullBody(c, change, reids);
			for (const key of [...map.keys()]) {
				if (!key.startsWith('@')) continue;
				const field = key.slice(1);
				if (hitRoot(contentRoot(name, field))) pullField(c, field, change, reids);
			}
		}
		events.clear();
		if (reids.length)
			ydoc.transact(() => {
				for (const [map, id] of reids) map.set('id', id);
			}, origin);
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
		for (let i = ids.length - 1; i >= 0; i--) {
			if (seen.has(ids[i])) continue;
			doc.removeCard(i);
			ids.splice(i, 1);
			change.cards.push({ op: 'remove', at: i });
		}
		for (let i = 0; i < target.length; i++) {
			if (ids[i] === target[i]) continue;
			const j = ids.indexOf(target[i]);
			try {
				if (j >= 0) {
					doc.moveCard(j, i);
					ids.splice(j, 1);
					ids.splice(i, 0, target[i]);
					change.cards.push({ op: 'move', from: j, to: i });
				} else {
					doc.insertCard(cardFromY(target[i]), i);
					ids.splice(i, 0, target[i]);
					inserted.add(target[i]);
					change.cards.push({ op: 'insert', at: i });
					markSynced(i);
				}
			} catch (e) {
				diverged = true;
				report(new Diverged(e));
				return;
			}
		}
	}

	/** A field's value as Y holds it, in whichever form it arrived; `undefined` where absent. */
	function yValue(name: string, key: string): unknown {
		const map = ydoc.getMap<unknown>(name);
		const form = arrived(map, key);
		if (form === 'content') return projectRoot(contentRoot(name, key));
		if (form === 'plain') return ydoc.getText(contentRoot(name, key)).toString();
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
	function cardFromY(id: string): CardInput {
		const map = ydoc.getMap<unknown>(id);
		const kind = map.get(KIND) as string;
		const schema = quill.schema.card_kinds?.[kind];
		watchCard(id, schema);
		const order = Object.keys(schema?.fields ?? {});
		const held = yFields(id);
		const keys = [
			...order.filter((k) => held.includes(k)),
			...held.filter((k) => !order.includes(k)).sort()
		];
		const title = map.get(TITLE);
		return {
			kind,
			payloadItems: keys.map((key) => ({ type: 'field', key, value: yValue(id, key) })),
			body: projectRoot(contentRoot(id)),
			...(typeof title === 'string' ? { ext: { editor: { title } } } : {})
		};
	}

	/** Record every root of card `c` as synced at the value the Document now holds. */
	function markSynced(c: CardRef): void {
		const name = nameOf(c);
		synced.set(contentRoot(name), contentKey(storedContent(addrOf(c))));
		const map = ydoc.getMap<unknown>(name);
		for (const key of yFields(name)) {
			const form = arrived(map, key);
			const root = contentRoot(name, key);
			const v = doc.getStored(addrOf(c, key));
			if (form === 'plain') synced.set(root, JSON.stringify(v));
			else if (form === 'content') synced.set(root, contentKey(storedContent(addrOf(c, key))));
		}
	}

	function pullCard(c: CardRef, change: RemoteChange, reids: [Y.Map<unknown>, string][]): void {
		const name = nameOf(c);
		const map = ydoc.getMap<unknown>(name);
		let moved = false;
		const kind = map.get(KIND);
		if (c !== MAIN && typeof kind === 'string' && kind !== doc.card(c).kind) {
			try {
				doc.insertCard({ ...doc.card(c), kind }, c);
				doc.removeCard(c + 1);
				watchCard(name, schemaOf(c, kind));
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
			storeTitle(cardAddr(c), typeof title === 'string' ? title : undefined);
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
					if (doc.getStored(addr) == null) continue;
					doc.removeField(addr);
					synced.delete(contentRoot(name, key));
				} else if (form === 'content' && isLeaf) {
					if (doc.getStored(addr) != null) continue;
					pullField(c, key, change, reids);
					continue;
				} else {
					const value = yValue(name, key);
					if (canonical(doc.getStored(addr)) === canonical(value)) continue;
					doc.storeField(addr, value);
					if (form === 'plain') synced.set(contentRoot(name, key), JSON.stringify(value));
				}
				held.delete(root);
				if (isLeaf) change.content.push({ addr });
				else moved = true;
			} catch (e) {
				held.add(root);
				report(e);
			}
		}
		if (moved && !change.fields.includes(c)) change.fields.push(c);
	}

	function pullBody(c: CardRef, change: RemoteChange, reids: [Y.Map<unknown>, string][]): void {
		reviseFrom(contentRoot(nameOf(c)), addrOf(c), change, reids);
	}

	function pullField(
		c: CardRef,
		field: string,
		change: RemoteChange,
		reids: [Y.Map<unknown>, string][]
	): void {
		const name = nameOf(c);
		const addr = addrOf(c, field);
		const form = arrived(ydoc.getMap<unknown>(name), field);
		const root = contentRoot(name, field);
		if (change.content.some((x) => sameAddr(x.addr, addr))) return;
		const schema = schemaOf(c);
		try {
			if (form === 'content' && declared(schema, field) === 'content')
				return reviseFrom(root, addr, change, reids);
			const value = yValue(name, field);
			if (value === undefined || canonical(doc.getStored(addr)) === canonical(value)) return;
			doc.storeField(addr, value);
			held.delete(root);
			synced.set(root, form === 'plain' ? JSON.stringify(value) : canonical(value));
			if (declared(schema, field) === 'value') {
				if (!change.fields.includes(c)) change.fields.push(c);
			} else change.content.push({ addr });
		} catch (e) {
			held.add(root);
			report(e);
		}
	}

	/** Revise the content field at `addr` to the projection of `root`. */
	function reviseFrom(
		root: string,
		addr: Addr,
		change: RemoteChange,
		reids: [Y.Map<unknown>, string][]
	): void {
		if (change.content.some((x) => sameAddr(x.addr, addr))) return;
		try {
			const projection = project(readField(contentTypes(ydoc, root)));
			reids.push(...projection.reids);
			const before = storedContent(addr);
			if (before && contentKey(before) === contentKey(projection.content)) {
				held.delete(root);
				synced.set(root, contentKey(before));
				return;
			}
			const event = events.get(root);
			if (!before) {
				doc.overwrite(addr, projection.content);
				held.delete(root);
				synced.set(root, contentKey(storedContent(addr)));
				change.content.push({ addr });
				return;
			}
			const revised = doc.reviseContent(addr, projection.content);
			held.delete(root);
			synced.set(root, contentKey(storedContent(addr)));
			const delta = event ? usvDelta(event, Array.from(before.text)) : revised.delta;
			change.content.push({ addr, delta });
		} catch (e) {
			held.add(root);
			report(e);
		}
	}

	function storeTitle(addr: CardAddr, title: string | undefined): void {
		const ext = doc.getExt(addr) ?? {};
		const editor = { ...((ext.editor as Record<string, unknown> | undefined) ?? {}) };
		if (title === undefined) delete editor.title;
		else editor.title = title;
		const { editor: _, ...rest } = ext;
		const next = Object.keys(editor).length ? { ...rest, editor } : rest;
		if (Object.keys(next).length) doc.storeExt(addr, next);
		else if (doc.getExt(addr)) doc.removeExt(addr);
	}

	// ── Wiring ───────────────────────────────────────────────────────────────

	const onAfter = (tr: Y.Transaction) => {
		if (tr.origin === origin) {
			events.clear();
			return;
		}
		const touched = new Set<string>();
		for (const [name, type] of ydoc.share)
			if (tr.changed.has(type) || tr.changedParentTypes.has(type as Y.AbstractType<Y.YEvent<any>>))
				touched.add(name);
		if (!touched.size) return;
		const change = pull(touched);
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
		watchCard(MAIN, schemaOf(MAIN));
		if (adopted) for (let i = 0; i < ids.length; i++) watchCard(ids[i], schemaOf(i));
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
		destroy() {
			ydoc.off('afterTransaction', onAfter);
			for (const [text, fn] of observed) text.unobserve(fn);
			observed.clear();
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
	bindDocument({ doc: own, quill, ydoc }).destroy();
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

export function formOf(type: string): Form {
	const base = type.endsWith('?') ? type.slice(0, -1) : type;
	return base === 'richtext' ? 'content' : base === 'text' ? 'plain' : 'value';
}

function fieldItems(items: PayloadItem[]): { key: string; value: unknown }[] {
	return items.filter((i): i is Extract<PayloadItem, { type: 'field' }> => i.type === 'field');
}

function titleOf(ext: Record<string, unknown> | undefined): string | undefined {
	const t = (ext?.editor as { title?: unknown } | undefined)?.title;
	return typeof t === 'string' ? t : undefined;
}

const sameAddr = (a: Addr, b: Addr): boolean => a.card === b.card && a.field === b.field;

/** A content value's key for comparing what Y carries: its anchors are the Document's own. */
function contentKey(content: Content | undefined): string {
	if (!content) return canonical(null);
	return canonical({ ...content, marks: content.marks.filter((m) => m.type !== 'anchor') });
}

/** JSON with keys sorted at every depth, so two values compare by content alone. */
export function canonical(value: unknown): string {
	return JSON.stringify(value ?? null, (_, v) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(
					Object.keys(v)
						.sort()
						.map((k) => [k, v[k]])
				)
			: v
	);
}

/** Replace `text`'s content with `next`: a splice over each run of lines that differs, over its
 *  common prefix and suffix, so a change far from another leaves what lies between untouched. */
function spliceText(text: Y.Text, next: string): void {
	const a = Array.from(text.toString());
	const b = Array.from(next);
	const x = linesOf(a);
	const y = linesOf(b);
	const at = (lines: number[], chars: string[], k: number) =>
		k < lines.length ? lines[k] : chars.length;
	const runs = changedRuns(
		x.map((from, k) => a.slice(from, at(x, a, k + 1)).join('')),
		y.map((from, k) => b.slice(from, at(y, b, k + 1)).join(''))
	);
	for (const run of runs.reverse()) {
		const [a0, a1] = [at(x, a, run.from), at(x, a, run.to)];
		const [b0, b1] = [at(y, b, run.at), at(y, b, run.end)];
		let p = 0;
		while (a0 + p < a1 && b0 + p < b1 && a[a0 + p] === b[b0 + p]) p++;
		let s = 0;
		while (s < a1 - a0 - p && s < b1 - b0 - p && a[a1 - 1 - s] === b[b1 - 1 - s]) s++;
		const from = utf16(a, a0 + p);
		const removed = utf16(a, a1 - s) - from;
		if (removed) text.delete(from, removed);
		if (b1 - s > b0 + p) text.insert(from, b.slice(b0 + p, b1 - s).join(''));
	}
}

/** Where each line of `chars` starts: a line runs up to and including its `\n`. */
function linesOf(chars: string[]): number[] {
	const out = [0];
	chars.forEach((ch, i) => {
		if (ch === '\n' && i + 1 < chars.length) out.push(i + 1);
	});
	return chars.length ? out : [];
}

function minter(ydoc: Y.Doc): Mint {
	const prefix = ydoc.clientID.toString(36);
	let n = 0;
	return () => `${prefix}-${(n++).toString(36)}`;
}
