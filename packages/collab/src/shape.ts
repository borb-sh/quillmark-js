// The Y shape of one content field, and the read that turns it back into flat arrays.
//
// A field is one `Y.Text` plus one `Y.Map`. The text holds the field's characters, each island
// slot as an embedded `Y.Map` (`id`, `type`, `props`). A formatting mark is a Y attribute on the
// characters it covers. Line `i ≥ 1` keeps its metadata as attributes on the `\n` that opens it;
// line 0 has no such `\n`, so its metadata sits in the sibling map under the same keys.
//
// Containers are stored by identity: a list item is `{ c: 'list_item', list, item, … }` and a quote
// `{ c: 'quote', id }`, each id minted at random by the client that opened it. The
// positional `ordinal` and `instance` a `Content` carries are derived on the way out (`project.ts`).
import * as Y from 'yjs';
import type { ContentMark } from '@quillmark/wasm';

export const SLOT = '￼';

/** The attribute keys a `\n` carries. Each is a separate key so a concurrent kind change and
 *  container change both land. */
export const KIND = 'qm:kind';
export const CONTAINERS = 'qm:containers';
export const CONTINUES = 'qm:continues';
export const LINE_KEYS = [KIND, CONTAINERS, CONTINUES] as const;

/** The formatting marks a character attribute carries. An anchor is identity, not formatting,
 *  and has no Y form. */
export const MARK_KEYS = ['strong', 'emph', 'underline', 'strike', 'code', 'link', 'font_family'];

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

/** A line's metadata as the Y side holds it. `kind` and `containers` are JSON strings so the
 *  equality a write compares by is exact. */
export interface YLine {
	kind: string;
	containers: YContainer[];
	continues: boolean;
}

export type Attrs = Record<string, unknown>;

/** One field's Y state, flattened per USV character. `islands[k]` is the map behind the `k`th
 *  slot. */
export interface YField {
	chars: string[];
	attrs: Attrs[];
	lines: YLine[];
	islands: Y.Map<unknown>[];
}

export interface FieldTypes {
	text: Y.Text;
	meta: Y.Map<unknown>;
}

/** The two shared types behind the field named `name` in `ydoc`. */
export function fieldTypes(ydoc: Y.Doc, name: string): FieldTypes {
	return { text: ydoc.getText(name), meta: ydoc.getMap(`${name}#line0`) };
}

export function readField({ text, meta }: FieldTypes): YField {
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
		kind: typeof a[KIND] === 'string' ? (a[KIND] as string) : PARA,
		containers: typeof a[CONTAINERS] === 'string' ? JSON.parse(a[CONTAINERS] as string) : [],
		continues: a[CONTINUES] === true
	};
}

export const PARA = JSON.stringify({ kind: 'para' });

/** The attributes a `\n` carries for `line`. A default value is absent rather than written. */
export function lineAttrs(line: YLine): Attrs {
	return {
		[KIND]: line.kind === PARA ? null : line.kind,
		[CONTAINERS]: line.containers.length ? JSON.stringify(line.containers) : null,
		[CONTINUES]: line.continues ? true : null
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

/** Equality over the keys either side sets, an absent key and `null` being one value. */
export function attrsEqual(a: Attrs, b: Attrs, keys: readonly string[]): boolean {
	return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}
