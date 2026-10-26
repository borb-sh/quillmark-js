// The documents a browser keeps for one app: IndexedDB, one database per app base URL, so
// two apps on one origin never read each other's (APP §"Documents"). Each document is a
// record of its own; beside them sits which one was open, so a reload reopens it.

import { readRecord, toStored, type DocRecord } from './records';

const DOCUMENTS = 'documents';
const STATE = 'state';
const OPEN = 'open';

export interface Store {
	/** Every record this release reads, most recently edited first. */
	list(): Promise<DocRecord[]>;
	get(id: string): Promise<DocRecord | undefined>;
	put(record: DocRecord): Promise<void>;
	remove(id: string): Promise<void>;
	clear(): Promise<void>;
	/** The record that was open, or undefined where none was. */
	opened(): Promise<string | undefined>;
	setOpened(id: string | undefined): Promise<void>;
}

const done = <T>(request: IDBRequest<T>): Promise<T> =>
	new Promise((ok, no) => {
		request.onsuccess = () => ok(request.result);
		request.onerror = () => no(request.error);
	});

const committed = (tx: IDBTransaction): Promise<void> =>
	new Promise((ok, no) => {
		tx.oncomplete = () => ok();
		tx.onerror = () => no(tx.error);
		tx.onabort = () => no(tx.error);
	});

/**
 * The store for the app served at `base`, or undefined where the browser keeps none: a
 * private window may refuse IndexedDB, and the app then works on the document in hand and
 * says it keeps nothing.
 */
export async function openStore(base: string): Promise<Store | undefined> {
	let db: IDBDatabase;
	try {
		const request = indexedDB.open(`quillkit-app ${base}`, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(DOCUMENTS, { keyPath: 'id' });
			request.result.createObjectStore(STATE);
		};
		db = await done(request);
	} catch {
		return undefined;
	}

	const write = async (store: string, act: (s: IDBObjectStore) => void): Promise<void> => {
		const tx = db.transaction(store, 'readwrite');
		act(tx.objectStore(store));
		await committed(tx);
	};
	const read = <T>(store: string, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
		done(act(db.transaction(store, 'readonly').objectStore(store)));

	return {
		async list() {
			const raw = await read(DOCUMENTS, (s) => s.getAll());
			return raw
				.map(readRecord)
				.filter((r): r is DocRecord => r !== undefined)
				.sort((a, b) => b.edited - a.edited);
		},
		async get(id) {
			return readRecord(await read(DOCUMENTS, (s) => s.get(id)));
		},
		put: (record) => write(DOCUMENTS, (s) => s.put(toStored(record))),
		remove: (id) => write(DOCUMENTS, (s) => s.delete(id)),
		async clear() {
			await write(DOCUMENTS, (s) => s.clear());
			await write(STATE, (s) => s.delete(OPEN));
		},
		async opened() {
			const id = await read(STATE, (s) => s.get(OPEN));
			return typeof id === 'string' ? id : undefined;
		},
		setOpened: (id) => write(STATE, (s) => (id === undefined ? s.delete(OPEN) : s.put(id, OPEN)))
	};
}
