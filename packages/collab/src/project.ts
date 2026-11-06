// The projection: one content field's Y state → the `Content` every client derives from it.
//
// A pure function of the Y state, so two clients holding one state hand their Documents one
// value. Two valid edits can merge into a state no single edit makes: an item added to a list
// another client removed, two slots naming one island, text typed beside a table. The store's
// `repair` reads such a state as the one valid value, deterministically, every id it mints derived
// from the ids involved, so every client reads the same value without writing it.
import type * as Y from 'yjs';
import type {
	Content,
	ContentBlock,
	ContentContainer,
	ContentIsland,
	ContentMark,
	RawContent,
	Repair
} from '@quillmark/wasm';
import { core } from './core.js';
import { MARK_KEYS, SLOT_PREFIX, units, type Attrs, type YBlock, type YField } from './shape.js';

export interface Projection {
	content: Content;
	/** What `repair` mended to reach `content`, none for a state no merge broke. */
	repairs: Repair[];
}

export function project(field: YField): Projection {
	const raw: RawContent = {
		text: field.chars.join(''),
		blocks: field.blocks.map(contentBlock),
		containers: [...field.containers.entries()].map(
			([id, record]) => ({ ...(record as object), id }) as ContentContainer
		),
		marks: deriveMarks(field.chars, field.attrs),
		islands: field.islands.map(islandOf),
		...(field.codec ? { codec: field.codec } : {})
	};
	const { content, repairs } = core().repair(raw);
	return { content, repairs };
}

/** Whether a mend's write-back inserts text or a slot, which only a session's leader
 *  writes back. */
export const inserts = (r: Repair): boolean =>
	r.inserts === true || (r.repair === 'in_slot' && inserts(r.inner));

export function contentBlock(b: YBlock): ContentBlock {
	return {
		...(JSON.parse(b.kind) as { kind: 'para' }),
		id: b.id,
		...(b.path.length ? { path: b.path } : {})
	};
}

export function islandOf(map: Y.Map<unknown>): ContentIsland {
	const slots: Record<string, Content> = {};
	for (const [key, value] of map.entries())
		if (key.startsWith(SLOT_PREFIX))
			slots[key.slice(SLOT_PREFIX.length)] = structuredClone(value as Content);
	return {
		id: map.get('id') as string,
		type: map.get('type') as 'table',
		props: structuredClone(map.get('props')) as never,
		...(Object.keys(slots).length ? { slots } : {})
	};
}

export function deriveMarks(chars: string[], attrs: Attrs[]): ContentMark[] {
	const at: number[] = [];
	let u = 0;
	for (const ch of chars) {
		at.push(u);
		u += units(ch);
	}
	at.push(u);
	const marks: ContentMark[] = [];
	for (const key of MARK_KEYS) {
		let start = -1;
		let value: unknown = null;
		for (let i = 0; i <= chars.length; i++) {
			const v = i < chars.length && chars[i] !== '\n' ? (attrs[i][key] ?? null) : null;
			if (v === value && start >= 0) continue;
			if (start >= 0) marks.push(markOf(key, value, at[start], at[i]));
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
