// The cards removed this session and not yet restored, each named by the place it left
// (INVARIANTS §"Card operations"): the cards either side of it, since an index names
// whatever stands there after the next insert, move or removal, and a session key names
// one card for the surface's life.

/** A removed card and the place it left. */
export interface RemovedCard<Card> {
	readonly id: string;
	readonly card: Card;
	above: string | undefined;
	below: string | undefined;
	/** The index it left, for a card both of whose neighbours are gone. */
	readonly at: number;
}

export interface RemovedCards<Card> {
	/** A card just removed from `at` in `ids`, the stack as it stood. */
	remove(id: string, card: Card, ids: readonly string[], at: number): RemovedCard<Card>;
	/** Where `gone` goes back in the stack `ids`: under the card it stood below, else over
	 *  the one it stood above, else the index it left, held to the stack's length. */
	place(gone: RemovedCard<Card>, ids: readonly string[]): number;
	/** `gone` went back under the session key `id`: a removal that named it as its
	 *  neighbour names the restored card. */
	restored(gone: RemovedCard<Card>, id: string): void;
}

export function removedCards<Card>(): RemovedCards<Card> {
	const held: RemovedCard<Card>[] = [];
	return {
		remove(id, card, ids, at) {
			const gone = { id, card, above: ids[at - 1], below: ids[at + 1], at };
			held.push(gone);
			return gone;
		},
		place(gone, ids) {
			const above = gone.above === undefined ? -1 : ids.indexOf(gone.above);
			if (above >= 0) return above + 1;
			const below = gone.below === undefined ? -1 : ids.indexOf(gone.below);
			return below >= 0 ? below : Math.min(gone.at, ids.length);
		},
		restored(gone, id) {
			held.splice(held.indexOf(gone), 1);
			for (const other of held) {
				if (other.above === gone.id) other.above = id;
				if (other.below === gone.id) other.below = id;
			}
		}
	};
}
