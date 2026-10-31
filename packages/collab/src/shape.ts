// The Y shape of a document: which root holds what, and the read that flattens a content field.
//
// A card is `main` or its id. Its fields that are neither `richtext` nor `text` are keys of the
// card's own `Y.Map`, beside `$kind` and `$title`; each content field is a root of its own,
// `<card>/<field>`, and the body is `<card>/$body`. A field name is `[A-Za-z_][A-Za-z0-9_]*`, so
// none of `/`, `$`, `@` or `#` can collide with one. `$cards` orders the composable cards.
import * as Y from 'yjs';
import type { ContentMark } from '@quillmark/wasm';

export const MAIN = 'main';
export const CARDS = '$cards';
export const SESSION = '$session';
export const KIND = '$kind';
export const TITLE = '$title';
export const BODY = '$body';

/** The card-map key that says a content field is present: an empty `Y.Text` is otherwise
 *  both an absent field and an empty one. */
export const present = (field: string): string => `@${field}`;

export const contentRoot = (card: string, field?: string): string => `${card}/${field ?? BODY}`;

export const SLOT = '￼';

/** The attribute keys a line's opening `\n` carries. Each is its own key, so a concurrent kind
 *  change and container change both land. */
const LINE_KIND = 'qm:kind';
const LINE_CONTAINERS = 'qm:containers';
const LINE_CONTINUES = 'qm:continues';
export const LINE_KEYS = [LINE_KIND, LINE_CONTAINERS, LINE_CONTINUES] as const;

/** The formatting marks a character attribute carries. An anchor is identity, not formatting,
 *  and has no Y form. */
export const MARK_KEYS = [
	'strong',
	'emph',
	'underline',
	'strike',
	'code',
	'link',
	'font_family'
] as const;

/** A container as Y holds it: by identity, never by position. */
export type YContainer =
	| {
			c: 'list_item';
			list: string;
			item: string;
			ordered: boolean;
			start: number;
			checked?: boolean;
	  }
	| { c: 'quote'; id: string };

/** A line's metadata as Y holds it. `kind` is a JSON string, so equality is exact. */
export interface YLine {
	kind: string;
	containers: YContainer[];
	continues: boolean;
}

export type Attrs = Record<string, unknown>;

/** One content field's Y state, one entry per USV character. `islands[k]` is the map behind the
 *  `k`th slot. */
export interface YField {
	chars: string[];
	attrs: Attrs[];
	lines: YLine[];
	islands: Y.Map<unknown>[];
}

export interface ContentTypes {
	text: Y.Text;
	meta: Y.Map<unknown>;
}

/** The two shared types behind the content field named `name`: its text, and line 0's
 *  metadata, which has no `\n` to sit on. */
export function contentTypes(ydoc: Y.Doc, name: string): ContentTypes {
	return { text: ydoc.getText(name), meta: ydoc.getMap(`${name}#line0`) };
}

const PARA = JSON.stringify({ kind: 'para' });

export function readField({ text, meta }: ContentTypes): YField {
	const chars: string[] = [];
	const attrs: Attrs[] = [];
	const islands: Y.Map<unknown>[] = [];
	const lines: YLine[] = [lineOf(Object.fromEntries(meta.entries()))];
	for (const op of text.toDelta() as { insert: string | object; attributes?: Attrs }[]) {
		const a = op.attributes ?? {};
		if (typeof op.insert === 'string') {
			for (const ch of op.insert) {
				chars.push(ch);
				attrs.push(a);
				if (ch === '\n') lines.push(lineOf(a));
			}
		} else {
			chars.push(SLOT);
			attrs.push(a);
			islands.push(op.insert as Y.Map<unknown>);
		}
	}
	return { chars, attrs, lines, islands };
}

function lineOf(a: Attrs): YLine {
	return {
		kind: typeof a[LINE_KIND] === 'string' ? (a[LINE_KIND] as string) : PARA,
		containers:
			typeof a[LINE_CONTAINERS] === 'string' ? JSON.parse(a[LINE_CONTAINERS] as string) : [],
		continues: a[LINE_CONTINUES] === true
	};
}

/** The attributes a `\n` carries for `line`. A default is absent rather than written. */
export function lineAttrs(line: YLine): Attrs {
	return {
		[LINE_KIND]: line.kind === PARA ? null : line.kind,
		[LINE_CONTAINERS]: line.containers.length ? JSON.stringify(line.containers) : null,
		[LINE_CONTINUES]: line.continues ? true : null
	};
}

/** The formatting attributes at each USV position of a `length`-character field. */
export function markAttrs(marks: ContentMark[], length: number): Attrs[] {
	const out: Attrs[] = Array.from({ length }, () => ({}));
	for (const m of marks) {
		if (m.type === 'anchor') continue;
		const value = m.type === 'link' ? m.attrs.url : m.type === 'font_family' ? m.attrs.name : true;
		for (let i = m.start; i < m.end && i < length; i++) out[i][m.type] = value;
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
