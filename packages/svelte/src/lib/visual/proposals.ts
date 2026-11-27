// An answer as a review list: what a host hands the editor after another writer rewrote a copy
// of the document. Compared against the copy as that writer read it, never against the live
// document, which the editor compares each item with itself as it draws.
import type {
	Addr,
	Card,
	Document,
	PathStep,
	Quill,
	QuillCardSchema,
	QuillFieldSchema
} from '@quillmark/wasm';
import { addrForFieldPath, fieldPathForAddr } from '../core/address.js';
import { schemaOf } from '../core/schema.js';
import { asContent, lineRuns } from '../core/codec/value-plan.js';
import {
	byBlocks,
	sameValue,
	type BlockProposal,
	type ReviewItem,
	type ReviewLabel
} from './review.js';
import { VARIANT_DISCRIMINANT, baseType, fieldValues, textKind } from './structure.js';

/** The review an answer makes: the items the editor draws, the cards it adds or takes out
 *  among them. */
export interface Proposed {
	items: ReviewItem[];
}

type BlockRead = ReturnType<Document['blocks']>[number];

let minted = 0;

/**
 * The review list from `base`, the document as the answer's writer read it, to `answer`, the
 * document as the writer left it: a copy of `base` the writer edited, so the two share card and
 * block ids. Each item carries `before`, what the writer read, so the editor keeps what the
 * reader has written since and reports a place both changed as outdated.
 *
 * Cards pair by id. Each paired card's body and its rich text fields of `blocks` take one
 * `replace` item per block the answer rewrote or took out, and one `insert` item per run of blocks
 * it added. A text field of one line or of lines, at the top of a card or inside a record or a
 * list, takes one item per run of lines the answer changed, lines paired by their words: each the
 * value read with that run alone written, runs at most two unchanged lines apart one item, and a
 * value that changes one run proposed whole. Every other field takes an item per place that
 * changed: a record's cell, and a list's member, changed, taken out, or appended past the end, two
 * appends to one list at successive indices. Members a list gains anywhere but its end are one
 * item per run, `ahead` naming the member that follows them. A record or a list written where none
 * was is compared with an empty one. A choice with variants is compared as a record, its
 * discriminant a cell of it, and a checklist member by member: one ticked or unticked is proposed
 * whole, and one held on both sides cell by cell. A value of a type nothing nests in, a field the
 * answer clears, and a rich text value of `blocks` inside a record or a list are proposed whole.
 * Values are in the form the editor's controls are handed, a text cell as its `Content`.
 *
 * A card the answer adds is an `add` item after the nearest card before it that the answer
 * keeps, so cards it adds in a run stand in list order; one it takes out is a `remove` item.
 * Paths and card indexes are `base`'s, and an item on a card, after one or taking one out names
 * it by its `$id` too where it has one. A card the answer retypes is listed as taken out and
 * added; one it moves is not listed.
 *
 * `mint`, or `opts.mint`, names each item, and by default names it uniquely for the page.
 * `opts.label` is handed each item once the list is made and returns its `note` and `group`,
 * from what the host knows of the edit that made it: a block id or a field path it wrote.
 */
export function proposalsBetween(
	quill: Quill,
	base: Document,
	answer: Document,
	opts: (() => string) | ProposalsOpts = {}
): Proposed {
	const { mint = () => `review-${minted++}`, label } =
		typeof opts === 'function' ? { mint: opts } : opts;
	const items: ReviewItem[] = [];
	const schemas = schemaOf(quill);
	const baseCards = base.cards;
	const answerCards = answer.cards;
	const kinds = baseCards.map((c) => c.kind);
	const baseIds = baseCards.map((c) => c.id ?? '');
	const answerIds = answerCards.map((c) => c.id ?? '');

	const pathOf = (at: number | undefined, field: string | undefined, steps: PathStep[] = []) =>
		fieldPathForAddr(addrOf(at, field), kinds, steps)!;

	const diffCard = (
		schema: QuillCardSchema | undefined,
		at: number | undefined,
		was: Card,
		now: Card,
		answerAt: number | undefined
	): void => {
		const before = fieldValues(was.payloadItems);
		const after = fieldValues(now.payloadItems);
		const fields = schema?.fields ?? {};
		for (const name of keysOf(fields, before, after)) {
			const f = fields[name] as QuillFieldSchema | undefined;
			const kind = f && textKind(f);
			if (kind?.type === 'richtext' && kind.shape === 'blocks') {
				blocks(pathOf(at, name), base, addrOf(at, name), answer, addrOf(answerAt, name));
				continue;
			}
			value(
				(steps) => pathOf(at, name, steps),
				f,
				[],
				before[name] ?? undefined,
				after[name] ?? undefined
			);
		}
		if (schema?.body?.enabled !== false)
			blocks(pathOf(at, undefined), base, addrOf(at), answer, addrOf(answerAt));
	};

	const blocks = (
		field: string,
		from: Document,
		fromAddr: Addr,
		to: Document,
		toAddr: Addr
	): void => {
		const was = blocksOf(from, fromAddr);
		const now = leading(was, blocksOf(to, toAddr));
		const nowById = new Map(now.map((b) => [b.id, b]));
		for (const b of was) {
			const next = nowById.get(b.id);
			if (next?.markdown === b.markdown) continue;
			items.push({
				id: mint(),

				field,
				replace: [b.id],
				before: b.markdown,
				after: next?.markdown ?? ''
			});
		}
		const kept = new Set(was.map((b) => b.id));
		let lead: string | undefined;
		let run: BlockRead[] = [];
		const flush = (next: string | undefined): void => {
			if (!run.length) return;
			items.push({
				id: mint(),

				field,
				insert: lead ? { after: lead } : next ? { before: next } : 'end',
				after: run.map((b) => b.markdown).join('\n\n')
			});
			run = [];
		};
		for (const b of now) {
			if (!kept.has(b.id)) {
				run.push(b);
				continue;
			}
			flush(b.id);
			lead = b.id;
		}
		flush(undefined);
	};

	const value = (
		pathAt: (steps: PathStep[]) => string,
		f: QuillFieldSchema | undefined,
		steps: PathStep[],
		was: unknown,
		now: unknown
	): void => {
		if (sameValue(was, now)) return;
		const whole = (): void =>
			void items.push({
				id: mint(),

				field: pathAt(steps),
				...(was !== undefined && { before: was }),
				...(now !== undefined && { after: now })
			});
		const text = f && textKind(f);
		const words = text ? [asContent(was), asContent(now)] : [];
		if (text && words[0] && words[1] && now != null) {
			const runs = lineRuns(words[0], words[1], text.shape === 'blocks' ? 'paragraph' : 'run');
			if (runs.length > 1) {
				for (const run of runs)
					items.push({ id: mint(), field: pathAt(steps), before: was, after: run });
				return;
			}
		}
		const kind = f && baseType(f);
		const records = isRecord(now) && (was == null || isRecord(was));
		const cells: Record<string, unknown> = isRecord(was) ? was : {};
		if (kind === 'object' && f?.properties && records) {
			for (const key of keysOf(f.properties, cells, now))
				value(pathAt, f.properties[key], [...steps, key], cells[key], now[key]);
			return;
		}
		if (kind === 'enum' && f?.variants && records) {
			const cell = (key: string): QuillFieldSchema | undefined =>
				key === VARIANT_DISCRIMINANT
					? { ...f, variants: undefined }
					: Object.values(f.variants ?? {}).find((world) => world && key in world)?.[key];
			for (const key of keysOf({ [VARIANT_DISCRIMINANT]: null }, cells, now))
				value(
					pathAt,
					cell(key),
					[...steps, key],
					cells[key],
					(now as Record<string, unknown>)[key]
				);
			return;
		}
		if (kind === 'matrix' && records) {
			const next = now as Record<string, unknown>;
			for (const member of keysOf({}, cells, next)) {
				const a = cells[member];
				const b = next[member];
				if (sameValue(a, b)) continue;
				if (isRecord(a) && isRecord(b))
					for (const key of keysOf(f?.properties ?? {}, a, b))
						value(pathAt, f?.properties?.[key], [...steps, member, key], a[key], b[key]);
				else
					items.push({
						id: mint(),
						field: pathAt([...steps, member]),
						...(a !== undefined && { before: a }),
						...(b !== undefined && { after: b })
					});
			}
			return;
		}
		if (kind !== 'array' || !Array.isArray(now) || !(was == null || Array.isArray(was)))
			return whole();
		const held: readonly unknown[] = Array.isArray(was) ? was : [];
		let appended = held.length;
		for (const { from, to, removed, added } of aligned(held, now)) {
			const paired = Math.min(removed, added);
			for (let k = 0; k < paired; k++)
				value(pathAt, f?.items, [...steps, from + k], held[from + k], now[to + k]);
			for (let k = paired; k < removed; k++)
				items.push({
					id: mint(),

					field: pathAt([...steps, from + k]),
					before: held[from + k]
				});
			if (added > paired && from + removed < held.length)
				items.push({
					id: mint(),
					field: pathAt([...steps, from + removed]),
					ahead: held[from + removed],
					after: now.slice(to + paired, to + added)
				});
			else
				for (let k = paired; k < added; k++)
					items.push({
						id: mint(),
						field: pathAt([...steps, appended++]),
						after: now[to + k]
					});
		}
	};

	diffCard(schemas.main, undefined, base.main, answer.main, undefined);
	/** The base's index of each card the answer keeps as it was, by its answer index. */
	const kept = new Map<number, number>();
	const removed: number[] = [];
	for (const [at, id] of baseIds.entries()) {
		const answerAt = answerIds.indexOf(id);
		const was = baseCards[at];
		const now = answerAt < 0 ? undefined : answerCards[answerAt];
		if (!now || now.kind !== was.kind) {
			removed.push(at);
			continue;
		}
		kept.set(answerAt, at);
		const first = items.length;
		diffCard(schemas[was.kind], at, was, now, answerAt);
		if (id) for (const item of items.slice(first)) Object.assign(item, { card: id });
	}
	for (const at of answerIds.keys()) {
		if (kept.has(at)) continue;
		let lead = at - 1;
		while (lead >= 0 && !kept.has(lead)) lead--;
		const after = kept.get(lead);
		items.push({
			id: mint(),
			add: answerCards[at],
			...(after !== undefined && { after }),
			...(after !== undefined && baseIds[after] && { afterCard: baseIds[after] })
		});
	}
	for (const at of removed)
		items.push({ id: mint(), remove: at, ...(baseIds[at] && { card: baseIds[at] }) });
	if (label)
		for (const item of items) {
			const { note, group } = label(item) ?? {};
			if (note !== undefined) item.note = note;
			if (group !== undefined) item.group = group;
		}
	return { items };
}

/** How `proposalsBetween` names and labels the items it makes. */
export interface ProposalsOpts {
	mint?: () => string;
	label?: (item: Readonly<ReviewItem>) => ReviewLabel | undefined;
}

const addrOf = (card?: number, field?: string): Addr => ({
	...(card !== undefined && { card }),
	...(field !== undefined && { field })
});

/**
 * `now` with the first block's id on the block that is the first block read: a rewrite keeps that
 * id on whichever block it puts first, so blocks added above the first read as its rewrite. The
 * block put first then takes an id `was` does not hold, so it and those after it up to that block
 * are added before it.
 */
function leading(was: readonly BlockRead[], now: BlockRead[]): BlockRead[] {
	const at = heir(was, now);
	if (!at) return now;
	const first = was[0].id;
	const held = new Set(was.map((b) => b.id));
	let added = `${first}+`;
	while (held.has(added)) added += '+';
	return now.map((b, i) => (i === 0 ? { ...b, id: added } : i === at ? { ...b, id: first } : b));
}

/**
 * The index in `now` of the block that is `was`'s first block where a rewrite put others above it,
 * `0` where it stands first. Of the blocks ahead of the next one `now` keeps, the first reading as
 * the first block did is it, or, where the block put first is of another kind, the first of the
 * first block's kind.
 */
function heir(was: readonly BlockRead[], now: readonly BlockRead[]): number {
	const first = was[0];
	if (!first || now[0]?.id !== first.id || now[0].markdown === first.markdown) return 0;
	const held = new Set(was.map((b) => b.id));
	let end = 1;
	while (end < now.length && !held.has(now[end].id)) end++;
	const ahead = now.slice(1, end);
	return (
		ahead.findIndex((b) => b.markdown === first.markdown) + 1 ||
		(now[0].kind !== first.kind && ahead.findIndex((b) => b.kind === first.kind) + 1) ||
		0
	);
}

/**
 * `items` naming the blocks of `now`, a whole-document revise of `was`, such as a return from
 * editing the document as Markdown. A revise keeps a field's first id on whichever block it puts
 * first, so a block written above the first takes its id and the first block moves under a new
 * one. An item naming that id, to rewrite the block or to add beside it, names the new one, where
 * the first block stands as {@link proposalsBetween} reads a block put above it. Every other item
 * is as it was, and so is every id a revise keeps on its block.
 */
export function reviewRevised(
	items: readonly ReviewItem[],
	was: Document,
	now: Document
): ReviewItem[] {
	const moves = new Map<string, readonly [string, string] | undefined>();
	const moveOf = (item: BlockProposal): readonly [string, string] | undefined => {
		const key = `${item.card ?? ''} ${item.field}`;
		if (moves.has(key)) return moves.get(key);
		let move: readonly [string, string] | undefined;
		const addr = addrForFieldPath(item.field);
		if (addr) {
			const at: Addr = item.card === undefined ? addr : { ...addr, card: item.card };
			const before = blocksOf(was, at);
			const after = blocksOf(now, at);
			const k = heir(before, after);
			if (k) move = [before[0].id, after[k].id];
		}
		moves.set(key, move);
		return move;
	};
	return items.map((item) => {
		if (!byBlocks(item)) return item;
		const move = moveOf(item);
		if (!move) return item;
		const moved = (id: string): string => (id === move[0] ? move[1] : id);
		if ('replace' in item) return { ...item, replace: item.replace.map(moved) };
		const at = item.insert;
		if (at === 'end') return item;
		return {
			...item,
			insert: 'after' in at ? { after: moved(at.after) } : { before: moved(at.before) }
		};
	});
}

/** The blocks of the value at `addr`, none where it holds none. */
function blocksOf(doc: Document, addr: Addr): BlockRead[] {
	try {
		return doc.blocks(addr);
	} catch {
		return [];
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** The keys a schema declares, then any either value holds beyond them. */
function keysOf(declared: Record<string, unknown>, ...values: unknown[]): string[] {
	const keys = new Set(Object.keys(declared));
	for (const v of values) if (isRecord(v)) for (const key of Object.keys(v)) keys.add(key);
	return [...keys];
}

/**
 * The runs where two lists differ, members matched by value along their longest common run:
 * at each, `removed` members of `was` from `from` and `added` members of `now` from `to`. A run
 * pairs its members as changes, and takes out, appends or puts in the rest.
 */
function aligned(
	was: readonly unknown[],
	now: readonly unknown[]
): { from: number; to: number; removed: number; added: number }[] {
	const m = was.length;
	const n = now.length;
	const lcs = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--)
		for (let j = n - 1; j >= 0; j--)
			lcs[i][j] = sameValue(was[i], now[j])
				? lcs[i + 1][j + 1] + 1
				: Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	const runs: { from: number; to: number; removed: number; added: number }[] = [];
	let i = 0;
	let j = 0;
	let from = 0;
	let to = 0;
	const close = (): void => {
		const removed = i - from;
		const added = j - to;
		if (removed || added) runs.push({ from, to, removed, added });
	};
	while (i < m && j < n) {
		if (sameValue(was[i], now[j])) {
			close();
			i++;
			j++;
			from = i;
			to = j;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
		else j++;
	}
	i = m;
	j = n;
	close();
	return runs;
}
