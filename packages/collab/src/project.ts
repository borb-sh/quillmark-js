// The projection: one content field's Y state → the `Content` every client derives from it.
//
// A pure function of the Y state, so two clients holding one state hand their Documents one
// value. The positional numbers are derived here: a list item's `ordinal` counts item-id changes
// within a run of one list id, and `instance` alternates where two adjacent runs at one depth
// carry different ids of one shape (a quote, or a list of one `ordered`).
import type * as Y from 'yjs';
import type {
	Content,
	ContentContainer,
	ContentIsland,
	ContentLine,
	ContentMark
} from '@quillmark/wasm';
import { MARK_KEYS, type Attrs, type YContainer, type YField, type YLine } from './shape.js';

interface Projection {
	content: Content;
	/** Island maps whose id another slot in the field already holds, with the id each takes.
	 *  Every client derives the same ids, so writing them back to Y agrees. */
	reids: [Y.Map<unknown>, string][];
}

export function project(field: YField): Projection {
	const reids: Projection['reids'] = [];
	const seen = new Set<string>();
	const islands = field.islands.map((map) => {
		const island = islandOf(map);
		if (seen.has(island.id)) {
			let n = 1;
			while (seen.has(`${island.id}~${n}`)) n++;
			island.id = `${island.id}~${n}`;
			reids.push([map, island.id]);
		}
		seen.add(island.id);
		return island;
	});
	return {
		content: {
			text: field.chars.join(''),
			lines: deriveLines(field.lines),
			marks: deriveMarks(field.chars, field.attrs),
			islands
		},
		reids
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
	// Per depth, what the line before held there: its identity, and the numbers derived for it.
	let prev: { key: string; run: string; shape: string; ordinal: number; instance: number }[] = [];
	return ylines.map((yl) => {
		const here: typeof prev = [];
		let samePrefix = true;
		const containers = yl.containers.map((yc, d) => {
			const list = yc.c === 'list_item';
			const run = list ? `${yc.list}:${yc.ordered}` : yc.id;
			const key = list ? `${yc.list}/${yc.item}` : yc.id;
			const shape = list ? `list:${yc.ordered}` : 'quote';
			const p = samePrefix ? prev[d] : undefined;
			let ordinal = 0;
			let instance = 0;
			if (p && p.run === run) {
				instance = p.instance;
				ordinal = p.key === key ? p.ordinal : p.ordinal + 1;
			} else if (p && p.shape === shape) {
				instance = 1 - p.instance;
			}
			here.push({ key, run, shape, ordinal, instance });
			samePrefix = samePrefix && !!p && p.key === key;
			return containerOf(yc, ordinal, instance);
		});
		prev = here;
		return {
			...(JSON.parse(yl.kind) as Pick<ContentLine, 'kind'>),
			containers,
			...(yl.continues ? { continues: true } : {})
		} as ContentLine;
	});
}

function containerOf(yc: YContainer, ordinal: number, instance: number): ContentContainer {
	const inst = instance ? { instance } : {};
	if (yc.c === 'quote') return { container: 'quote', ...inst };
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
}

function deriveMarks(chars: string[], attrs: Attrs[]): ContentMark[] {
	const marks: ContentMark[] = [];
	for (const key of MARK_KEYS) {
		let start = -1;
		let value: unknown = null;
		for (let i = 0; i <= chars.length; i++) {
			const v = i < chars.length && chars[i] !== '\n' ? (attrs[i][key] ?? null) : null;
			if (v === value && start >= 0) continue;
			if (start >= 0) marks.push(markOf(key, value, start, i));
			start = v === null ? -1 : i;
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
