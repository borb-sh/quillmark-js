// A content value as its blocks: cut, and put together from blocks of other values. A held part
// of a write is a run of blocks, so holding it and writing it later are both a splice of blocks.
import type {
	Content,
	ContentBlock,
	ContentContainer,
	ContentIsland,
	ContentMark
} from '@quillmark/wasm';
import { core } from './core.js';
import type { Splice } from './lines.js';
import { SLOT, units } from './shape.js';

/** One block of a value, its marks counted from the block's start, its `\n` not included. */
interface Part {
	chars: string[];
	block: ContentBlock;
	islands: ContentIsland[];
	marks: ContentMark[];
}

function partsOf(content: Content): Part[] {
	const chars = Array.from(content.text);
	const islands = content.islands ?? [];
	const out: Part[] = [];
	let i = 0;
	let unit = 0;
	let island = 0;
	for (const block of content.blocks) {
		const start = i;
		const u0 = unit;
		const own: ContentIsland[] = [];
		while (i < chars.length && chars[i] !== '\n') {
			if (chars[i] === SLOT && islands[island]) own.push(islands[island++]);
			unit += units(chars[i++]);
		}
		const u1 = unit;
		const marks = (content.marks ?? [])
			.filter((m) => m.start < u1 && m.end > u0)
			.map((m) => ({ ...m, start: Math.max(m.start, u0) - u0, end: Math.min(m.end, u1) - u0 }));
		out.push({ chars: chars.slice(start, i), block, islands: own, marks });
		i += 1;
		unit += 1;
	}
	return out;
}

function compose(parts: Part[], pool: Map<string, ContentContainer>, codec?: 'plain'): Content {
	const marks: ContentMark[] = [];
	let unit = 0;
	for (const part of parts) {
		for (const m of part.marks) marks.push({ ...m, start: m.start + unit, end: m.end + unit });
		for (const ch of part.chars) unit += units(ch);
		unit += 1;
	}
	const used = new Set(parts.flatMap((p) => p.block.path ?? []));
	const out: Content = {
		text: parts.map((p) => p.chars.join('')).join('\n'),
		blocks: parts.map((p) => p.block),
		containers: [...pool.values()].filter((c) => used.has(c.id)),
		marks,
		islands: parts.flatMap((p) => p.islands),
		...(codec ? { codec } : {})
	};
	return core().normalize(out);
}

function pool(...values: Content[]): Map<string, ContentContainer> {
	const out = new Map<string, ContentContainer>();
	for (const v of values) for (const c of v.containers ?? []) if (!out.has(c.id)) out.set(c.id, c);
	return out;
}

/** Blocks `[from, to)` of `content` as a value of their own. */
export function sliceBlocks(content: Content, from: number, to: number): Content {
	return compose(partsOf(content).slice(from, to), pool(content), content.codec);
}

/** `target` with each run of its blocks replaced by a run of `source`'s, runs in order and apart. */
export function spliceBlocks(target: Content, source: Content, runs: Splice[]): Content {
	const t = partsOf(target);
	const s = partsOf(source);
	const out: Part[] = [];
	let k = 0;
	for (const r of runs) {
		out.push(...t.slice(k, r.at), ...s.slice(r.from, r.to));
		k = r.end;
	}
	out.push(...t.slice(k));
	return compose(out, pool(target, source), target.codec);
}
