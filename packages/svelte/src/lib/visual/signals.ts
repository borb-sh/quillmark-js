// What the editor emits. The editor is unaware of the preview
// (VISUAL_EDITOR §"Focus and the preview bridge"), so nothing here imports it; what the two share
// is `/core`'s address vocabulary, which is what lets a consumer wire the bridge
// as a pass-through rather than a translation.
import type { DocPath } from '../core/address.js';

/**
 * Which lane an edit came down. The three differ in cost, not in meaning: prose
 * arrives per keystroke and wants a debounce, a structure op arrives once per
 * gesture and does not. A host that recompiles the same way for all three never
 * reads it.
 */
export type ChangeSource =
	/** A content commit from a prose leaf's own edit. */
	| 'prose'
	/** A scalar/array/object write through the typed writer, or a field cleared. */
	| 'field'
	/** A card operation: add, move, remove, retype, rename, tips dismissal. */
	| 'structure';

/**
 * A card's session key: the editor's own identity for a card instance, `'main'` for
 * the main card and an opaque `IdSeq` id (`structure.ts`) for a composable one. It
 * rides beside every address the surface emits, because no address survives a
 * reorder: `Addr` and `DocPath` are both positional, so a host holding
 * `cards.indorsement[2].from` names a different card after one `moveCard`, and
 * silently. The key does not move.
 *
 * Session-scoped by construction. Nothing document-side backs it (the document model
 * carries no card handle): it is minted at mount and dies with the surface, so it
 * does not survive a reload and a host persisting one is persisting a session key.
 *
 * The keys track the inserts, moves and removals the editor performs, and the ones a
 * host reports through `applyCardOps` after making them itself (a live session's
 * remote edits). A host that mutates the card array behind the editor and reports
 * nothing desyncs them: there is nothing document-side to reconcile against.
 */
export type CardId = string;

/** A change to the composable card list, by index, as the document applied it. */
export type CardOp =
	| { op: 'insert'; at: number }
	| { op: 'remove'; at: number }
	| { op: 'move'; from: number; to: number };

/** An edit that landed on the document, and which lane it came down. */
export interface EditorChange {
	source: ChangeSource;
	/**
	 * Where it landed, in the canonical `DocPath` the preview and every diagnostic
	 * already speak: a field for the prose and field lanes, the card itself
	 * (`cards.<kind>[i]`) for a structure op, where the change is the card rather than
	 * anything inside it. Absent for a card removal and a tips dismissal, which are
	 * the stack's change rather than a leaf's.
	 */
	path?: DocPath;
	/**
	 * Which card it landed in ({@link CardId}). Present for a removal, whose `path`
	 * is not: the index is meaningless once the card is gone, and the key is the only
	 * handle a host tracking cards has left to drop. Absent only for the tips
	 * dismissal, which is document-level chrome and names no card.
	 */
	cardId?: CardId;
	/** The card-list change a structure op made: an add, a move or a removal. A retype
	 *  and a rename leave the list as it was and carry none. */
	op?: CardOp;
}

/** The leaf that has focus: where it sits, and which card holds it. */
export interface ActiveLeaf {
	/** The leaf's own address, the same `DocPath` a `Place`, a `ContentHit` and a
	 *  `Diagnostic` name a field with. */
	field: DocPath;
	cardId: CardId;
}
