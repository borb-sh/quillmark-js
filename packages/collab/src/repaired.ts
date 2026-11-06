// What a peer writes over a field whose merged state reads through a repair that inserts.
//
// Only a session's leader writes back an inserting repair: two peers each writing one
// insert it twice, and the extra copy is valid, so it stays. Every other peer writes its own edit
// alone. The Y state is the raw form, the Document the repaired one; a block the edit left as the
// repair made it is written as Y holds it, and a block the edit changed is written as the Document
// holds it, the repair inside it with it.
import type { Content, ContentContainer, ContentIsland } from '@quillmark/wasm';
import { changedRuns, meet } from './lines.js';
import { contentBlock, deriveMarks, islandOf } from './project.js';
import {
	MARK_KEYS,
	SLOT,
	canonical,
	markAttrs,
	yBlock,
	type Attrs,
	type YBlock,
	type YField
} from './shape.js';
import { islandWithoutAnchors } from './write.js';

/** One block: its record, its characters without the `\n` that opens it, their marks, and the
 *  islands behind its slots. */
interface Line {
	record: YBlock;
	chars: string[];
	marks: Attrs[];
	islands: ContentIsland[];
}

/**
 * The value to write over `raw` for the edit that took `repaired`, its projection, to `next`: each
 * run of blocks the repair mended and the edit did not meet is held as `raw` holds it, every other
 * block as `next` holds it.
 */
export function unrepaired(raw: YField, repaired: Content, next: Content): Content {
	const r = linesOfY(raw);
	const p = linesOf(repaired);
	const mended = changedRuns(r.map(keyOf), p.map(keyOf));
	if (!mended.length) return next;
	const d = linesOf(next);
	const edits = changedRuns(p.map(keyOf), d.map(keyOf));
	const subs = edits.map((e) => ({ from: e.from, to: e.to, lines: d.slice(e.at, e.end) }));
	const kept: Line[] = [];
	for (const m of mended) {
		const run = { from: m.at, to: m.end, at: m.at, end: m.end };
		if (edits.some((e) => meet(run, e))) continue;
		const lines = r.slice(m.from, m.to);
		kept.push(...lines);
		subs.push({ from: m.at, to: m.end, lines });
	}
	subs.sort((x, y) => x.from - y.from || x.to - y.to);
	const out: Line[] = [];
	let i = 0;
	for (const s of subs) {
		while (i < s.from) out.push(p[i++]);
		out.push(...s.lines);
		i = Math.max(i, s.to);
	}
	while (i < p.length) out.push(p[i++]);

	const containers: ContentContainer[] = [...(next.containers ?? [])];
	const named = new Set(containers.map((c) => c.id));
	for (const id of kept.flatMap((l) => l.record.path)) {
		const record = raw.containers.get(id);
		if (named.has(id) || record === undefined) continue;
		named.add(id);
		containers.push({ ...(record as object), id } as ContentContainer);
	}
	return contentOf(out, containers);
}

function linesOf(content: Content): Line[] {
	const chars = Array.from(content.text);
	return split(
		chars,
		markAttrs(content.marks ?? [], chars),
		content.blocks.map(yBlock),
		(content.islands ?? []).map(islandWithoutAnchors)
	);
}

function linesOfY(field: YField): Line[] {
	return split(field.chars, field.attrs, field.blocks, field.islands.map(islandOf));
}

function split(
	chars: string[],
	attrs: Attrs[],
	records: YBlock[],
	islands: ContentIsland[]
): Line[] {
	const out: Line[] = [];
	let island = 0;
	let line: Line = { record: records[0], chars: [], marks: [], islands: [] };
	chars.forEach((ch, i) => {
		if (ch === '\n') {
			out.push(line);
			line = { record: records[out.length], chars: [], marks: [], islands: [] };
			return;
		}
		line.chars.push(ch);
		line.marks.push(marksOf(attrs[i]));
		if (ch === SLOT) line.islands.push(islands[island++]);
	});
	out.push(line);
	return out;
}

function marksOf(attrs: Attrs): Attrs {
	const out: Attrs = {};
	for (const k of MARK_KEYS) if (attrs[k] != null) out[k] = attrs[k];
	return out;
}

const keyOf = (line: Line): string => canonical(line);

function contentOf(lines: Line[], containers: ContentContainer[]): Content {
	const chars: string[] = [];
	const attrs: Attrs[] = [];
	lines.forEach((line, k) => {
		if (k) {
			chars.push('\n');
			attrs.push({});
		}
		chars.push(...line.chars);
		attrs.push(...line.marks);
	});
	return {
		text: chars.join(''),
		blocks: lines.map((l) => contentBlock(l.record)),
		marks: deriveMarks(chars, attrs),
		islands: lines.flatMap((l) => l.islands),
		containers
	};
}
