// What the app keeps of a document, and the readings it takes off one: the record a browser
// stores, where the pin it names stands in this build, the title it goes by and the file
// name it leaves as (APP §"Documents").
//
// Free of the browser and of the wasm, so the suite reads the records an earlier release
// wrote without either.

/** One quill the app opens, as `app.json` names it. */
export interface AppQuill {
	ref: string;
	title: string;
	description?: string;
}

/** `app.json`: what `quillkit build app` resolved `App.yaml` to. */
export interface AppConfig {
	title: string;
	description?: string;
	icon?: string;
	css?: string;
	quills: AppQuill[];
}

/** A document as the app stores it. */
export interface DocRecord {
	id: string;
	/** Read off the document at its last save (`titleOf`). */
	title: string;
	/** The canonical ref it was made on, which is the quill it reopens in. */
	quill: string;
	/** Milliseconds since the epoch, at its last save. */
	edited: number;
	/** Its canonical markdown, which is what the record is for: it reads as a file, and it
	 *  re-conforms on the way in. */
	markdown: string;
}

/** The shape a record is stored in. A later release reading an earlier one's records
 *  branches on `v`. */
export const RECORD_VERSION = 1;

export type Stored = DocRecord & { v: typeof RECORD_VERSION };

export function toStored(record: DocRecord): Stored {
	return { v: RECORD_VERSION, ...record };
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** A stored record as this release reads it, or undefined for one it cannot. */
export function readRecord(raw: unknown): DocRecord | undefined {
	if (raw === null || typeof raw !== 'object') return undefined;
	const r = raw as Record<string, unknown>;
	if (r.v !== RECORD_VERSION) return undefined;
	if (!isString(r.id) || !isString(r.quill) || !isString(r.markdown)) return undefined;
	if (typeof r.edited !== 'number' || !Number.isFinite(r.edited)) return undefined;
	return {
		id: r.id,
		title: isString(r.title) ? r.title : '',
		quill: r.quill,
		edited: r.edited,
		markdown: r.markdown
	};
}

/**
 * Where a document's pin stands in this build: one of the quills the app opens, an earlier
 * version the pack still holds, or neither.
 */
export type Standing = 'current' | 'retired' | 'missing';

/** What a pack says of the versions it holds, which is all `standing` asks of a quiver. */
export interface Holds {
	versionsOf(name: string): string[];
}

const nameOf = (ref: string): string => ref.slice(0, ref.indexOf('@'));
const versionOf = (ref: string): string => ref.slice(ref.indexOf('@') + 1);

export function standing(ref: string, app: AppConfig, pack: Holds): Standing {
	if (app.quills.some((q) => q.ref === ref)) return 'current';
	if (pack.versionsOf(nameOf(ref)).includes(versionOf(ref))) return 'retired';
	return 'missing';
}

/** The quill this build opens in a document's place: the same quill at its current pin. */
export function latestFor(ref: string, app: AppConfig): AppQuill | undefined {
	return app.quills.find((q) => nameOf(q.ref) === nameOf(ref));
}

/** The field types a title may be read off: text a writer typed, not a date or a choice. */
const TITLED = /^(text|richtext)\??$/;
/** The fields a document is most likely to be called by, read before any other. */
const FIRST = ['title', 'subject'];
const LONGEST = 80;

/** What a field's value reads as, where it is text. A `text` value arrives as its string
 *  or as content carrying one. */
function textOf(value: unknown): string | undefined {
	if (isString(value)) return value;
	if (value !== null && typeof value === 'object' && isString((value as { text?: unknown }).text))
		return (value as { text: string }).text;
	return undefined;
}

/**
 * A document's title: the first answered text field of its main card, a `title` or
 * `subject` field before the others and the rest in the schema's order, on one line and at
 * most 80 characters. Where none is answered, `fallback`, the quill's own title.
 */
export function titleOf(
	main: { payloadItems: readonly { type: string; key?: string; value?: unknown }[] },
	fields: Readonly<Record<string, { type: string }>>,
	fallback: string
): string {
	const values = new Map<string, unknown>();
	for (const item of main.payloadItems)
		if (item.type === 'field' && item.key !== undefined) values.set(item.key, item.value);
	const keys = Object.keys(fields).filter((key) => TITLED.test(fields[key]!.type));
	const order = [
		...keys.filter((k) => FIRST.includes(k)),
		...keys.filter((k) => !FIRST.includes(k))
	];
	for (const key of order) {
		const text = textOf(values.get(key))?.replace(/\s+/g, ' ').trim();
		if (text) return text.length > LONGEST ? `${text.slice(0, LONGEST - 1).trimEnd()}…` : text;
	}
	return fallback;
}

/** A title as a file name every platform takes, with `ext` after it. */
export function fileName(title: string, ext: string): string {
	const stem = title
		.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/, '');
	return `${stem || 'document'}.${ext}`;
}

/** A fresh record id. `randomUUID` is a secure context's alone, and an app served over
 *  plain http on a LAN address is not one. */
export function newId(): string {
	return (
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
	);
}
