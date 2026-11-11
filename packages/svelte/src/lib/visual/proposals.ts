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
import { fieldPathForAddr } from '../core/address.js';
import { sameValue, type ReviewItem } from './review.js';
import { baseType, fieldValues, oneLine } from './structure.js';

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
 * Cards pair by id. Each paired card's body and block rich text fields take one `replace` item
 * per block the answer rewrote or took out, and one `insert` item per run of blocks it added.
 * Every other field takes an item per place that changed: a record's cell, and a list's member,
 * changed, taken out, or appended past the end, two appends to one list at successive indices.
 * A list that gains members anywhere but its end is compared member by member at each index, so
 * each place its controls draw says its own change; a record or a list written where none was is
 * compared with an empty one. A one-line rich text field, a value of a type nothing nests in, a
 * field the answer clears, and a rich text value inside a record or a list are proposed whole. Values
 * are in the form the editor's controls are handed, a text cell as its `Content`.
 *
 * A card the answer adds is an `add` item after the nearest card before it that the answer
 * keeps, so cards it adds in a run stand in list order; one it takes out is a `remove` item.
 * Paths and card indexes are `base`'s. A card the answer retypes is listed as taken out and
 * added; one it moves is not listed. `mint` names each item, and by default names it uniquely for the page.
 */
export function proposalsBetween(
	quill: Quill,
	base: Document,
	answer: Document,
	mint: () => string = () => `review-${minted++}`
): Proposed {
	const items: ReviewItem[] = [];
	const kinds = Array.from({ length: base.cardCount }, (_, i) => base.card(i).kind);
	const baseIds = Array.from({ length: base.cardCount }, (_, i) => base.card(i).id ?? '');
	const answerIds = Array.from({ length: answer.cardCount }, (_, i) => answer.card(i).id ?? '');

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
			if (f && baseType(f) === 'richtext' && !oneLine(f)) {
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
		const now = blocksOf(to, toAddr);
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
		const kind = f && baseType(f);
		if (kind === 'object' && f?.properties && isRecord(now) && (was == null || isRecord(was))) {
			const held: Record<string, unknown> = isRecord(was) ? was : {};
			for (const key of keysOf(f.properties, held, now))
				value(pathAt, f.properties[key], [...steps, key], held[key], now[key]);
			return;
		}
		if (kind !== 'array' || !Array.isArray(now) || !(was == null || Array.isArray(was)))
			return whole();
		const held: readonly unknown[] = Array.isArray(was) ? was : [];
		const runs = aligned(held, now) ?? [
			{ from: 0, to: 0, removed: held.length, added: now.length }
		];
		let appended = held.length;
		for (const { from, to, removed, added } of runs) {
			const paired = Math.min(removed, added);
			for (let k = 0; k < paired; k++)
				value(pathAt, f?.items, [...steps, from + k], held[from + k], now[to + k]);
			for (let k = paired; k < removed; k++)
				items.push({
					id: mint(),

					field: pathAt([...steps, from + k]),
					before: held[from + k]
				});
			for (let k = paired; k < added; k++)
				items.push({
					id: mint(),

					field: pathAt([...steps, appended++]),
					after: now[to + k]
				});
		}
	};

	diffCard(quill.schema.main, undefined, base.main, answer.main, undefined);
	/** The base's index of each card the answer keeps as it was, by its answer index. */
	const kept = new Map<number, number>();
	const removed: number[] = [];
	for (const [at, id] of baseIds.entries()) {
		const answerAt = answerIds.indexOf(id);
		const was = base.card(at);
		const now = answerAt < 0 ? undefined : answer.card(answerAt);
		if (!now || now.kind !== was.kind) {
			removed.push(at);
			continue;
		}
		kept.set(answerAt, at);
		diffCard(quill.schema.card_kinds?.[was.kind], at, was, now, answerAt);
	}
	for (const at of answerIds.keys()) {
		if (kept.has(at)) continue;
		let lead = at - 1;
		while (lead >= 0 && !kept.has(lead)) lead--;
		const after = kept.get(lead);
		items.push({ id: mint(), add: answer.card(at), ...(after !== undefined && { after }) });
	}
	for (const at of removed) items.push({ id: mint(), remove: at });
	return { items };
}

const addrOf = (card?: number, field?: string): Addr => ({
	...(card !== undefined && { card }),
	...(field !== undefined && { field })
});

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
 * pairs its members as changes, and takes out or appends the rest. `undefined` where a run adds
 * more members than it takes out anywhere but the end, which no index names.
 */
function aligned(
	was: readonly unknown[],
	now: readonly unknown[]
): { from: number; to: number; removed: number; added: number }[] | undefined {
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
	const close = (): boolean => {
		const removed = i - from;
		const added = j - to;
		if (added > removed && i < m) return false;
		if (removed || added) runs.push({ from, to, removed, added });
		return true;
	};
	while (i < m && j < n) {
		if (sameValue(was[i], now[j])) {
			if (!close()) return undefined;
			i++;
			j++;
			from = i;
			to = j;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
		else j++;
	}
	i = m;
	j = n;
	return close() ? runs : undefined;
}
