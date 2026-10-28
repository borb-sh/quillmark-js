// The projection: one field's Y state → the `Content` every client derives from it.
//
// A pure function of the Y state, so two clients holding the same state hand their Documents the
// same value. The positional numbers are derived here: a list item's `ordinal` counts item-id
// changes within a run of one list id, and `instance` alternates where two adjacent runs at one
// depth carry different ids.
//
// A table slot that shares its line with other characters is the one merge outcome no `Content`
// can hold (two clients, one inserting a table on an empty line, the other typing on it). The
// projection splits the line around the slot and says so with `repaired`; the binding then writes
// the split back, which is what brings Y and the Document back to one text.
import type * as Y from 'yjs';
import type {
	Content,
	ContentContainer,
	ContentIsland,
	ContentLine,
	ContentMark
} from '@quillmark/wasm';
import { MARK_KEYS, SLOT, type YContainer, type YField, type YLine } from './shape.js';

export interface Projection {
	content: Content;
	/** Whether a line was split around a table slot, so the content's text is not the Y text. */
	repaired: boolean;
}

export function project(field: YField): Projection {
	const chars = [...field.chars];
	const attrs = [...field.attrs];
	const ylines = [...field.lines];
	const islands = field.islands.map(islandOf);
	const repaired = splitBlockSlots(chars, attrs, ylines, islands);
	return {
		content: {
			text: chars.join(''),
			lines: deriveLines(ylines),
			marks: deriveMarks(chars, attrs),
			islands
		},
		repaired
	};
}

function islandOf(map: Y.Map<unknown>): ContentIsland {
	return {
		id: map.get('id') as string,
		type: map.get('type'),
		props: structuredClone(map.get('props'))
	} as ContentIsland;
}

function deriveLines(ylines: YLine[]): ContentLine[] {
	const out: ContentLine[] = [];
	// Per depth, what the previous line held there: its identity key, and the numbers derived.
	let prev: { key: string; run: string; ordinal: number; instance: number }[] = [];
	for (const yl of ylines) {
		const containers: ContentContainer[] = [];
		const here: typeof prev = [];
		let prefixSame = true;
		yl.containers.forEach((yc, d) => {
			const run = yc.c === 'list_item' ? yc.list : yc.id;
			const key = yc.c === 'list_item' ? `${yc.list}/${yc.item}` : yc.id;
			const p = prefixSame ? prev[d] : undefined;
			let ordinal = 0;
			let instance = 0;
			if (p && p.run === run) {
				instance = p.instance;
				ordinal = p.key === key ? p.ordinal : p.ordinal + 1;
			} else if (p && sameShape(p.key, yc)) {
				instance = 1 - p.instance;
			}
			here.push({ key, run, ordinal, instance });
			containers.push(containerOf(yc, ordinal, instance));
			prefixSame = prefixSame && !!p && p.key === key;
		});
		prev = here;
		out.push({
			...(JSON.parse(yl.kind) as Pick<ContentLine, 'kind'>),
			containers,
			...(yl.continues ? { continues: true } : {})
		} as ContentLine);
	}
	return out;
}

/** Whether the container before, by its key, and `yc` are the same kind of container: two
 *  adjacent runs of one kind need distinct instances or the store reads them as one. */
function sameShape(prevKey: string, yc: YContainer): boolean {
	return prevKey.includes('/') === (yc.c === 'list_item');
}

function containerOf(yc: YContainer, ordinal: number, instance: number): ContentContainer {
	const inst = instance ? { instance } : {};
	switch (yc.c) {
		case 'list_item':
			return {
				container: 'list_item',
				attrs: {
					ordered: yc.ordered,
					start: yc.start,
					ordinal,
					...(yc.checked === undefined ? {} : { checked: yc.checked })
				},
				...inst
			};
		case 'quote':
			return { container: 'quote', ...inst };
	}
}

function deriveMarks(chars: string[], attrs: Record<string, unknown>[]): ContentMark[] {
	const marks: ContentMark[] = [];
	for (const key of MARK_KEYS) {
		let start = -1;
		let value: unknown = null;
		const close = (end: number) => {
			if (start < 0) return;
			marks.push(markOf(key, value, start, end));
			start = -1;
		};
		for (let i = 0; i <= chars.length; i++) {
			const v = i < chars.length && chars[i] !== '\n' ? (attrs[i][key] ?? null) : null;
			if (v === value && start >= 0) continue;
			close(i);
			if (v !== null) start = i;
			value = v;
		}
	}
	return marks.sort((a, b) => a.start - b.start || a.end - b.end);
}

function markOf(key: string, value: unknown, start: number, end: number): ContentMark {
	if (key === 'link') return { type: 'link', attrs: { url: value as string }, start, end };
	if (key === 'font_family')
		return { type: 'font_family', attrs: { name: value as string }, start, end };
	return { type: key as 'strong', start, end };
}

/** Put every table slot alone on its line, in place. The new lines take the containers of the
 *  line they split and the `para` kind. */
function splitBlockSlots(
	chars: string[],
	attrs: Record<string, unknown>[],
	ylines: YLine[],
	islands: ContentIsland[]
): boolean {
	let repaired = false;
	let slot = -1;
	let line = 0;
	for (let i = 0; i < chars.length; i++) {
		if (chars[i] === '\n') {
			line++;
			continue;
		}
		if (chars[i] !== SLOT) continue;
		slot++;
		if (islands[slot].type !== 'table') continue;
		const split = { kind: JSON.stringify({ kind: 'para' }), containers: ylines[line].containers };
		const after = i + 1 < chars.length && chars[i + 1] !== '\n';
		const before = i > 0 && chars[i - 1] !== '\n';
		if (after) {
			chars.splice(i + 1, 0, '\n');
			attrs.splice(i + 1, 0, {});
			ylines.splice(line + 1, 0, { ...split, continues: false });
			repaired = true;
		}
		if (before) {
			chars.splice(i, 0, '\n');
			attrs.splice(i, 0, {});
			ylines.splice(line + 1, 0, { ...split, continues: false });
			line++;
			i++;
			repaired = true;
		}
	}
	return repaired;
}
