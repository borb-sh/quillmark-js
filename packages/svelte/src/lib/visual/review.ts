// Review, as a host hands it to the editor: a plain list of what someone other than the reader
// changed and what one proposes, drawn in the editor's own flow. Data in, events out: the editor
// holds no opinion on where an item came from, and the host lays the anchors and takes an
// answered item off the list.
//
// Who writes follows who holds the words. A proposal carries what it would write, so taking it
// is the editor's own edit, down the lane a reader's edit takes: what lands is what was drawn,
// `onChange` reports it, and the reader's undo takes it back. A change carries at most what it
// replaced as words to show, so taking one back is the host's write, which alone knows the
// inverse of what it wrote.
import type { DocPath } from '../core/address.js';
import type { ReviewAction } from '../core/codec/index.js';

/**
 * One item of review. `id` is the host's, unique in the list, and is what every event names.
 *
 * An item names its place one of two ways:
 *
 * - `anchor`: the id of an anchor in a rich text field or a body, which the host lays with the
 *   document's own `apply` (a transient one, id prefixed `~`, never reaches the stored value). A
 *   `changed` item marks the anchor's range as written, `before` the text it replaced; over a
 *   point anchor it marks where text was only removed. A `proposed` item reads every paragraph the
 *   anchor touches as rewritten to `after`, Markdown, drawn as a word-level edit of those
 *   paragraphs; `''` proposes their removal, and a point anchor proposes new paragraphs after the
 *   one holding it. A paragraph takes one proposal that rewrites it and one that adds after it.
 * - `field`: the path of a field, for a value with no text to anchor in. A `changed` item marks
 *   the field's control, `before` the value it held; a `proposed` item sets `after` under the
 *   control, the value the field's writer would take, an absent one proposing the field cleared.
 *   A path into a container names its field.
 *
 * An item whose anchor or field the editor does not hold draws nothing, and an answered one is
 * drawn no more.
 */
export type ReviewItem =
	| { id: string; state: 'changed'; anchor: string; before?: string }
	| { id: string; state: 'proposed'; anchor: string; after: string }
	| { id: string; state: 'changed'; field: DocPath; before?: unknown }
	| { id: string; state: 'proposed'; field: DocPath; after?: unknown };

/**
 * A reader's answer to an item.
 *
 * - `accept`: a proposal taken. The editor has written it by now, as an edit of the reader's.
 * - `dismiss`: a proposal turned down. Nothing is written.
 * - `undo`: a change to take back. Nothing is written here: the write is the host's.
 */
export interface ReviewEvent {
	id: string;
	action: ReviewAction;
}

/** A `changed` item over a field's control. */
export type FieldChange = Extract<ReviewItem, { state: 'changed'; field: DocPath }>;
/** A `proposed` item under a field's control. */
export type FieldProposal = Extract<ReviewItem, { state: 'proposed'; field: DocPath }>;

/** A reviewed value as the words a reader is shown for it: a string as written, a rich text
 *  value by its text, a list by its members, a subform by its named cells. `''` for nothing. */
export function reviewText(value: unknown, words: { on: string; off: string }): string {
	if (value == null) return '';
	if (typeof value === 'boolean') return value ? words.on : words.off;
	if (typeof value !== 'object') return String(value);
	if (Array.isArray(value))
		return value
			.map((v) => reviewText(v, words))
			.filter(Boolean)
			.join(', ');
	const text = (value as { text?: unknown }).text;
	if (typeof text === 'string' && Array.isArray((value as { blocks?: unknown }).blocks))
		return text;
	return Object.entries(value)
		.map(([key, v]) => [key, reviewText(v, words)])
		.filter(([, v]) => v)
		.map(([key, v]) => `${key}: ${v}`)
		.join('; ');
}
