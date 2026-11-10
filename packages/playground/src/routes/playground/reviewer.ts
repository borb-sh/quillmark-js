// `?review`: another writer's hand over the opened document, through the verbs a host's own
// reviewer has. It writes a few changes and lays a few proposals where the document holds the
// text for them, and answers the reader as a host does: an accepted or dismissed item leaves the
// list with its anchor left in place, a reopened one comes back to it, and a change taken back is
// written back with one step back offered on the editor's undo. The anchors are transient, so
// they stand until the page goes and cost the stored value nothing.
import type { Addr, Content, Document, Quill } from '@quillmark/wasm';
import type { ReviewEvent, ReviewItem } from '@quillmark/svelte/visual';

/** The editor verbs an answer needs. */
export interface ReviewEditor {
	applyExternal(field: string): void;
	refresh(): void;
	offerUndo(notice: string, undo: () => void): () => void;
}

const BODY: Addr = {};

/** One item, the content field its anchor is in, and its change's two writes. */
interface Held {
	item: ReviewItem;
	addr?: Addr;
	/** Write back what the change replaced. */
	revert?: () => void;
	/** Write a field's change again. */
	redo?: () => void;
}

export interface Reviewer {
	/** The list the editor draws. */
	items(): ReviewItem[];
	/** Make the write an answer asks for, and drop the item or put it back. */
	answer(event: ReviewEvent, editor: ReviewEditor): void;
}

/** The anchor `id` as the value at `addr` holds it now. */
function anchorOf(
	doc: Document,
	addr: Addr,
	id: string
): { id: string; start: number; end: number } | undefined {
	const found = doc.read(addr).anchors?.find((a) => a.id === id);
	return found && { id, start: found.start, end: found.end };
}

export function seedReview(doc: Document, quill: Quill, changed: () => void): Reviewer {
	const held: Held[] = [];
	let serial = 0;
	const mint = (): string => `~review-${serial++}`;
	const has = (addr: Addr): boolean => {
		try {
			doc.read(addr);
			return true;
		} catch {
			return false;
		}
	};

	/** Write `insert` over the first `find` at `addr`, or after it where nothing is `before`,
	 *  marked as a change over the words written. */
	const rewrite = (addr: Addr, find: string, insert: string, before?: string): void => {
		if (!has(addr)) return;
		const at = doc.read(addr).text.indexOf(find);
		if (at < 0) return;
		const id = mint();
		const start = before === undefined ? at + find.length : at;
		const lead = insert.length - insert.trimStart().length;
		doc.apply(addr, {
			steps: [
				before === undefined
					? { splice: { at: start, insert } }
					: { splice: { at, delete: find, insert } },
				{ anchor: { id, start: start + lead, end: start + insert.length } }
			]
		});
		held.push({
			item: { id, state: 'changed', anchor: id, ...(before !== undefined && { before }) },
			addr,
			revert: () => {
				const now = anchorOf(doc, addr, id);
				if (!now) return;
				doc.apply(addr, {
					steps: [
						{ anchor: { id, remove: true } },
						{
							splice: {
								at: now.start - lead,
								delete: doc.read(addr).text.slice(now.start - lead, now.end),
								insert: before ?? ''
							}
						}
					]
				});
			}
		});
	};

	/** Propose `after` for the paragraphs the first `find` at `addr` touches, or at its end. */
	const propose = (addr: Addr, find: string, after: string, point = false): void => {
		if (!has(addr)) return;
		const at = doc.read(addr).text.indexOf(find);
		if (at < 0) return;
		const id = mint();
		const end = at + find.length;
		doc.apply(addr, { steps: [{ anchor: { id, start: point ? end : at, end } }] });
		held.push({ item: { id, state: 'proposed', anchor: id, after }, addr });
	};

	rewrite(BODY, 'disjoint', 'separate', 'disjoint');
	rewrite(BODY, ' emphasis,', '', ' emphasis,');
	rewrite(BODY, 'list container', ' of its own');
	propose(
		BODY,
		'A second one',
		'- A second bullet, so the list has a sibling to nest against.\n- A third, to show a proposal adding an item.'
	);
	const body = doc.read(BODY).text;
	propose(
		BODY,
		body.slice(body.lastIndexOf('\n') + 1),
		'A paragraph the reviewer would add.',
		true
	);
	propose({ field: 'title' }, 'Showcase', 'The Showcase Quill, Reviewed');
	rewrite({ field: 'abstract' }, 'never shares', 'does not share', 'never shares');

	const subtitle = doc.getStored('subtitle') as { text: string } | undefined;
	if (subtitle) {
		const redo = (): void =>
			void quill.writer(doc).set('subtitle', 'A reviewed reference document');
		redo();
		held.push({
			item: {
				id: `review-${serial++}`,
				state: 'changed',
				field: doc.pathFor('subtitle'),
				before: subtitle.text
			},
			revert: () => void quill.writer(doc).set('subtitle', subtitle.text),
			redo
		});
	}
	if ('columns' in (quill.schema.main.fields ?? {}))
		held.push({
			item: { id: `review-${serial++}`, state: 'proposed', field: doc.pathFor('columns'), after: 2 }
		});

	/** The items answered, by id, with where each stood on the list, for a reopen. */
	const answered = new Map<string, { entry: Held; at: number }>();

	return {
		items: () => held.map((h) => h.item),
		answer({ id, action }, editor) {
			if (action === 'reopen') {
				const back = answered.get(id);
				if (!back) return;
				answered.delete(id);
				held.splice(Math.min(back.at, held.length), 0, back.entry);
				changed();
				return;
			}
			const at = held.findIndex((h) => h.item.id === id);
			if (at < 0) return;
			const [entry] = held.splice(at, 1);
			const { addr } = entry;
			/** The editor re-reads what this side wrote, and the page the list. */
			const land = (): void => {
				if (addr) editor.applyExternal(doc.pathFor(addr));
				else editor.refresh();
				changed();
			};
			if (action === 'revert') {
				const written: Content | undefined = addr && doc.read(addr);
				entry.revert?.();
				editor.offerUndo('Change reverted', () => {
					if (addr && written) doc.replace(addr, written);
					else entry.redo?.();
					held.splice(at, 0, entry);
					land();
				});
				land();
				return;
			}
			// The editor wrote what an accept takes, and its ⌘Z reopens either answer, so the
			// anchor stays where the item can be placed again.
			answered.set(id, { entry, at });
			changed();
		}
	};
}
