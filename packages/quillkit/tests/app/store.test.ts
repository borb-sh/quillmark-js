/**
 * Which document the store says was open, when a save flushed on leaving one lands after
 * the next open has written its own.
 */

import { describe, it, expect } from 'vitest';
import { keep, type Store } from '../../app/store';
import type { DocRecord } from '../../app/records';

const record: DocRecord = { id: 'a', title: 'A', quill: 'memo@1.2.0', edited: 1, markdown: '' };

/** A store whose `put` lands only when `land` is called. */
function slowStore(): { store: Store; land: () => void; opened: () => string | undefined } {
	let openedId: string | undefined;
	let land = (): void => {};
	const store = {
		put: () => new Promise<void>((ok) => (land = ok)),
		setOpened: async (id: string | undefined) => {
			openedId = id;
		}
	} as unknown as Store;
	return { store, land: () => land(), opened: () => openedId };
}

describe('a flushed save', () => {
	it('leaves the next open standing when it lands after it', async () => {
		for (const next of [undefined, 'b']) {
			const { store, land, opened } = slowStore();
			let open: string | undefined = 'a';
			const saving = keep(store, record, () => open === record.id);
			open = next;
			await store.setOpened(next);
			land();
			await saving;
			expect(opened()).toBe(next);
		}
	});

	it('marks the document open when it is still the one open', async () => {
		const { store, land, opened } = slowStore();
		const saving = keep(store, record, () => true);
		land();
		await saving;
		expect(opened()).toBe(record.id);
	});
});
