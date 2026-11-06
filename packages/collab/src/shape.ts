// The Y shape of a document: which root holds what, and the read that flattens a content field.
//
// A card is `main` or its id. Its fields that are neither `richtext` nor `text` are keys of the
// card's own `Y.Map`, beside `$kind` and `$title`; each content field is a root of its own,
// `<card>/<field>`, and the body is `<card>/$body`. A field name is `[A-Za-z_][A-Za-z0-9_]*`, so
// none of `/`, `$`, `@` or `#` can collide with one. `$cards` orders the composable cards.
import * as Y from 'yjs';
import type { ContentBlock, ContentMark } from '@quillmark/wasm';

export const MAIN = 'main';
export const CARDS = '$cards';
export const SESSION = '$session';
export const KIND = '$kind';
export const TITLE = '$title';
/** A composable card's `$id`, as its Document holds it. */
export const ID = '$id';
export const BODY = '$body';

/** The card-map key that says a content field is present: an empty `Y.Text` is otherwise
 *  both an absent field and an empty one. */
export const present = (field: string): string => `@${field}`;

export const contentRoot = (card: string, field?: string): string => `${card}/${field ?? BODY}`;

export const SLOT = '￼';

/** The attribute keys the `\n` opening a block carries: its id, its kind with its attributes as
 *  a JSON string, and its container path as a JSON array. Each is its own key, so a concurrent
 *  kind change and path change both land. */
export const BLOCK_ID = 'qm:id';
const BLOCK_KIND = 'qm:kind';
const BLOCK_PATH = 'qm:path';
export const LINE_KEYS = [BLOCK_ID, BLOCK_KIND, BLOCK_PATH] as const;

/** The block-0 map's key naming the field's codec: `plain` for a `text` field's value, absent for
 *  rich content. */
export const CODEC = 'qm:codec';

/** The formatting marks a character attribute carries. */
export const MARK_KEYS = [
	'strong',
	'emph',
	'underline',
	'strike',
	'code',
	'link',
	'font_family'
] as const;

/** A block's record as Y holds it. `kind` is a JSON string, so equality is exact. */
export interface YBlock {
	id: string;
	kind: string;
	path: string[];
}

export type Attrs = Record<string, unknown>;

/** One content field's Y state, one entry per USV character. `islands[k]` is the map behind the
 *  `k`th slot. */
export interface YField {
	chars: string[];
	attrs: Attrs[];
	blocks: YBlock[];
	islands: Y.Map<unknown>[];
	containers: Y.Map<unknown>;
	codec?: 'plain';
}

export interface ContentTypes {
	text: Y.Text;
	meta: Y.Map<unknown>;
	containers: Y.Map<unknown>;
}

/** The shared types behind the content field named `name`: its text, block 0's record, which
 *  has no `\n` to sit on, and its containers by id. */
export function contentTypes(ydoc: Y.Doc, name: string): ContentTypes {
	return {
		text: ydoc.getText(name),
		meta: ydoc.getMap(`${name}#block0`),
		containers: ydoc.getMap(`${name}#containers`)
	};
}

/** The suffixes of a content root's companion maps, so a change to one reads as the root's. */
export const COMPANIONS = ['#block0', '#containers'] as const;

/** An island map's key for slot `id`: each slot is its own key, so edits to two cells both land. */
export const SLOT_PREFIX = 'slot:';
export const slotKey = (id: string): string => `${SLOT_PREFIX}${id}`;

const PARA = JSON.stringify({ kind: 'para' });

export function readField(types: ContentTypes): YField {
	const { text, meta, containers } = types;
	const chars: string[] = [];
	const attrs: Attrs[] = [];
	const islands: Y.Map<unknown>[] = [];
	const blocks: YBlock[] = [blockOf(Object.fromEntries(meta.entries()))];
	for (const op of text.toDelta() as { insert: string | object; attributes?: Attrs }[]) {
		const a = op.attributes ?? {};
		if (typeof op.insert === 'string') {
			for (const ch of op.insert) {
				chars.push(ch);
				attrs.push(a);
				if (ch === '\n') blocks.push(blockOf(a));
			}
		} else {
			chars.push(SLOT);
			attrs.push(a);
			islands.push(op.insert as Y.Map<unknown>);
		}
	}
	return {
		chars,
		attrs,
		blocks,
		islands,
		containers,
		...(meta.get(CODEC) === 'plain' ? { codec: 'plain' as const } : {})
	};
}

function blockOf(a: Attrs): YBlock {
	return {
		id: typeof a[BLOCK_ID] === 'string' ? (a[BLOCK_ID] as string) : '',
		kind: typeof a[BLOCK_KIND] === 'string' ? (a[BLOCK_KIND] as string) : PARA,
		path: typeof a[BLOCK_PATH] === 'string' ? JSON.parse(a[BLOCK_PATH] as string) : []
	};
}

/** The Y form of a block record. */
export function yBlock(block: ContentBlock): YBlock {
	const attrs = (block as { attrs?: unknown }).attrs;
	const kind = attrs === undefined ? { kind: block.kind } : { kind: block.kind, attrs };
	return { id: block.id, kind: canonical(kind), path: block.path ?? [] };
}

/** The attributes a `\n` carries for `block`. A default is absent rather than written. */
export function lineAttrs(block: YBlock): Attrs {
	return {
		[BLOCK_ID]: block.id,
		[BLOCK_KIND]: block.kind === PARA ? null : block.kind,
		[BLOCK_PATH]: block.path.length ? JSON.stringify(block.path) : null
	};
}

/** The formatting attributes at each USV position of `chars`, from marks over UTF-16 offsets. */
export function markAttrs(marks: readonly ContentMark[], chars: readonly string[]): Attrs[] {
	const out: Attrs[] = chars.map(() => ({}));
	const at: number[] = [];
	let u = 0;
	for (const ch of chars) {
		at.push(u);
		u += units(ch);
	}
	for (const m of marks) {
		if (!(MARK_KEYS as readonly string[]).includes(m.type)) continue;
		const value =
			m.type === 'link'
				? (m as { attrs: { url: string } }).attrs.url
				: m.type === 'font_family'
					? (m as { attrs: { name: string } }).attrs.name
					: true;
		for (let i = 0; i < chars.length && at[i] < m.end; i++)
			if (at[i] >= m.start) out[i][m.type] = value;
	}
	return out;
}

/** Equality over `keys`, an absent key and `null` being one value. */
export function attrsEqual(a: Attrs, b: Attrs, keys: readonly string[]): boolean {
	return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/** The UTF-16 length of one USV character. */
export const units = (ch: string): number => (ch.codePointAt(0)! > 0xffff ? 2 : 1);

/** The UTF-16 offset of USV position `end` in `chars`. */
export function utf16(chars: readonly string[], end: number): number {
	let n = 0;
	for (let i = 0; i < end; i++) n += units(chars[i]);
	return n;
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

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((x, i) => x === b[i]);
}
