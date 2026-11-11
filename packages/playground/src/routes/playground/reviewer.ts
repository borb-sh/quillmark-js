// `?review`: another writer's answer over the opened document, as a host's assistant hands one
// over. The writer rewrites a copy of the document, and `proposalsBetween` turns the copy and
// the document it read into the list the editor draws. Where the opened document lacks what an
// edit reads, the edit is left out.
import type { Addr, Document, Quill } from '@quillmark/wasm';
import { proposalsBetween, type Proposed } from '@quillmark/svelte/visual';

/** The answer's review: the opened document is the one its writer read. */
export function seedReview(doc: Document, quill: Quill): Proposed {
	const answer = doc.clone();
	try {
		write(answer, quill);
		return proposalsBetween(quill, doc, answer);
	} finally {
		answer.free();
	}
}

/** The writer's answer, written into its copy. */
function write(answer: Document, quill: Quill): void {
	const writer = quill.writer(answer);
	const fields = quill.schema.main.fields ?? {};
	const body: Addr = {};

	/** The first block at `addr` holding `find`, rewritten by `edit`. */
	const rewrite = (addr: Addr, find: string, edit: (markdown: string) => string): void => {
		const block = blocksOf(answer, addr).find((b) => b.markdown.includes(find));
		if (block)
			answer.applyBlocks(addr, [{ op: 'replace', id: block.id, markdown: edit(block.markdown) }]);
	};
	/** `markdown` added after the first block at `addr` holding `find`, or after the last. */
	const add = (addr: Addr, markdown: string, find?: string): void => {
		const blocks = blocksOf(answer, addr);
		const block =
			find === undefined ? blocks.at(-1) : blocks.find((b) => b.markdown.includes(find));
		if (block) answer.applyBlocks(addr, [{ op: 'insertAfter', id: block.id, markdown }]);
	};

	rewrite(body, 'disjoint', (md) => md.replace('disjoint', 'separate'));
	rewrite(body, ' emphasis,', (md) => md.replace(' emphasis,', ''));
	rewrite(body, 'A second one', (md) => md.replace('A second one', 'A second bullet'));
	add(body, '- A third, to show a proposal adding an item.', 'A second bullet');
	add(body, 'A paragraph the reviewer would add.');
	rewrite({ field: 'title' }, 'Showcase', (md) => `${md}, Reviewed`);
	rewrite({ field: 'abstract' }, 'never shares', (md) =>
		md.replace('never shares', 'does not share')
	);

	if (answer.getStored('subtitle') !== undefined)
		writer.set('subtitle', 'A reviewed reference document');
	const keywords = answer.getStored('keywords');
	if (Array.isArray(keywords)) writer.set('keywords', [...keywords, 'Review']);
	const contributors = answer.getStored('contributors');
	if (Array.isArray(contributors) && contributors.length > 1)
		writer.set('contributors', [
			contributors[0],
			{ ...contributors[1], role: 'editor' },
			...contributors.slice(2)
		]);
	if ('columns' in fields) writer.set('columns', 2);
	if ('draft_watermark' in fields) writer.set('draft_watermark', true);
	if ('accent' in fields) writer.set('accent', 'rust');
	if ('issued' in fields) writer.set('issued', '2026-02-01');
	if ('tab_stops' in fields) writer.set('tab_stops', [36]);
	if ('review_dates' in fields) writer.set('review_dates', ['2026-02-01']);
	if ('proofs_passed' in fields) writer.set('proofs_passed', [true]);
	if ('audiences' in fields) writer.set('audiences', ['press']);
	if (Array.isArray(contributors))
		writer.set('contributors', [
			...((answer.getStored('contributors') as unknown[]) ?? []),
			{ name: 'Alan Turing', role: 'reviewer' }
		]);
	const signature = answer.getStored('signature_block');
	if (Array.isArray(signature) && signature.length > 1)
		writer.set('signature_block', signature.slice(0, -1));
	const revisions = answer.getStored('revisions');
	if (Array.isArray(revisions) && revisions.length > 1)
		writer.set('revisions', revisions.slice(0, 1));
	const appendices = answer.getStored('appendices');
	if (Array.isArray(appendices))
		writer.set('appendices', [...appendices, { title: 'Index', entries: [] }]);
	const checks = answer.getStored('checks');
	if ('checks' in fields) writer.set('checks', { ...((checks as object) ?? {}), figures: true });

	if (quill.schema.card_kinds?.note)
		writer.addCard(
			'note',
			{ label: 'Aside', tone: 'warning' },
			'A note the reviewer would add.',
			1
		);
	if (answer.cardCount > 2) answer.removeCard(answer.cardCount - 1);
}

function blocksOf(doc: Document, addr: Addr): ReturnType<Document['blocks']> {
	try {
		return doc.blocks(addr);
	} catch {
		return [];
	}
}
