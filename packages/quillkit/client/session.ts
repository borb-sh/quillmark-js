// One quill, one document, one `LiveSession`: what the surfaces are mounted over, and
// what a repack replaces. The handle lifecycle lives here rather than in the
// component, because it is the one thing in studio that is not chrome.
import type {
	Diagnostic,
	Document,
	Engine,
	LiveSession,
	OutputFormat,
	Quill
} from '@quillmark/wasm';
import type { Quiver } from '@quillmark/quiver';
import { diagnosticsOf, messageOf } from './notes';

/** How the document got here, and what the landing cost. */
export interface Carry {
	/** `seeded`: the schema's example, for a first open or a different quill picked.
	 *  `carried`: the previous document, landed under the schema in hand.
	 *  `reseeded`: the previous document was refused, so the example stands in. */
	how: 'seeded' | 'carried' | 'reseeded';
	/** The `conform::*` diagnostics for the values the schema in hand will not take,
	 *  or the one refusal that dropped the document. Empty for a seed, and the point
	 *  of the surface rather than an error to swallow. */
	stranded: Diagnostic[];
}

export interface Opened {
	/** Canonical ref, `name@x.y.z`. */
	ref: string;
	/** Borrowed from the quiver, never freed here (see `close`). */
	quill: Quill;
	/** What this quill's backend emits, read once per open. An always-free probe off the
	 *  backend descriptor: no binary loaded, nothing cloned. */
	formats: OutputFormat[];
	doc: Document;
	/** Absent while the engine refuses this document ({@link openSession}). */
	session?: LiveSession;
	/** What the engine refused it with at the last attempt; empty while a session
	 *  stands. */
	refused: Diagnostic[];
	carry: Carry;
}

/**
 * Open `ref` from `quiver`, over `carry`: the canonical markdown of the document the
 * surfaces were holding, or `undefined` to seed a fresh example.
 *
 * Carrying is what makes a repack an edit to the quill rather than a reset of the
 * work: a plate-only change lands the same document verbatim, an additive schema
 * change keeps it and defaults the new fields, and an incompatible one leaves what the
 * schema will not take as authored, with a `conform::*` diagnostic naming each value it
 * would not commit.
 *
 * A card kind the schema does not declare strands nothing and produces no such
 * diagnostic: conform keeps the card whole, `quill.validate` names it, and `Engine.open`
 * refuses the document.
 */
export async function openRef(
	engine: Engine,
	quiver: Quiver,
	ref: string,
	carry?: string
): Promise<Opened> {
	// Borrowed: `getQuill` caches one quill per canonical ref and hands it to every
	// caller for the quiver's lifetime, so studio holds it and frees nothing (QUIVER
	// §getQuill). Studio rewrites no quill bytes, so it needs no quill of its own and
	// pays for no second materialization.
	const quill = await quiver.getQuill(ref);
	const formats = await engine.supportedFormats(quill);

	let doc: Document | undefined;
	let landed: Carry = { how: 'seeded', stranded: [] };
	if (carry !== undefined) {
		try {
			// The bound ingestion door: parse, then conform against the schema in hand,
			// landing every declared field at its canonical rest. The `conform::*`
			// diagnostics for the values that would not commit arrive on `warnings`.
			doc = quill.parse(carry);
			landed = { how: 'carried', stranded: doc.warnings };
		} catch (err) {
			// `toMarkdown` round-trips and the ref is unchanged, so a refusal here is
			// outside the contract: seed, and say what refused.
			landed = { how: 'reseeded', stranded: [{ severity: 'warning', message: messageOf(err) }] };
		}
	}
	doc ??= quill.seedDocument();

	return { ref, quill, formats, doc, ...(await openSession(engine, quill, doc)), carry: landed };
}

/**
 * A session over `doc`, or the diagnostics the engine refused it with. The refusal is
 * returned because it is a state of the document rather than the end of the open: the
 * editor stands on the quill and the document alone, so it draws the card the refusal
 * named, and the edit that answers it calls this again.
 */
export async function openSession(
	engine: Engine,
	quill: Quill,
	doc: Document
): Promise<{ session?: LiveSession; refused: Diagnostic[] }> {
	try {
		return { session: await engine.open(quill, doc), refused: [] };
	} catch (err) {
		return { refused: diagnosticsOf(err) };
	}
}

/**
 * Free what studio owns: the session and the document. The quill is the quiver's,
 * borrowed for as long as the quiver lives, and freeing it would leave the next caller
 * holding a freed handle; dropping the quiver drops the last reference to it.
 */
export function close(open: Opened): void {
	open.session?.free();
	open.doc.free();
}
