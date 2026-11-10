// A field's guidance: its schema `description`, as the DOM the label draws it from, and
// the key that raises it. `Mod-/` on a control raises the description that control
// carries, the keyboard's way in to a `FieldHint` whose glyph is out of the tab order.
import { core } from '../core/lifecycle.js';
import { renderContent, inlineSchema } from '../core/codec/index.js';

/**
 * A description's markdown as DOM, by the path a tip takes (`renderTip`): the body's
 * mark vocabulary under the inline schema, so any string is one paragraph and a
 * description is spelled as its quill's bodies are. A link is drawn as its words: the
 * surface is one a pointer cannot stay on and no reader lands in. A throw degrades to
 * the literal text.
 */
export function renderGuidance(markdown: string): Node {
	const { importMarkdown } = core();
	try {
		const dom = renderContent(importMarkdown(markdown).content, inlineSchema);
		if (dom instanceof DocumentFragment || dom instanceof Element)
			for (const a of dom.querySelectorAll('a')) a.replaceWith(...a.childNodes);
		return dom;
	} catch {
		return document.createTextNode(markdown);
	}
}

/** The longest description that stands under its label: about a line at the label rung
 *  across a card, two in a half-width field. Past it the text goes behind the marker,
 *  in flow under every field being the density a card avoids (`FieldHint`). */
const BRIEF_MAX = 72;

/** Whether a description stands in flow under its label, with no marker to raise. */
export const isBrief = (description: string): boolean => description.length <= BRIEF_MAX;

/** A description as the words alone, for the node that describes its control. */
export const guidanceText = (markdown: string): string =>
	renderGuidance(markdown).textContent ?? markdown;

/** `Mod-/`, read off `key` so a layout that shifts to reach `/` still matches; either
 *  modifier stands for `Mod`. */
function isGuidanceKey(e: KeyboardEvent): boolean {
	return e.key === '/' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.isComposing;
}

/**
 * The guidance trigger for the description nearest `from`: the innermost element
 * carrying `aria-describedby` whose ids name a parked description with a trigger
 * beside it. A trigger points at its own parked node through that same attribute,
 * which is the relation read here; ids that are not a description (an array's count,
 * a prose leaf's note) are skipped, and an undescribed property falls through to the
 * group around it.
 */
function guidanceTrigger(from: Element, root: Element): HTMLElement | undefined {
	for (let el = from.closest('[aria-describedby]'); el;) {
		for (const id of el.getAttribute('aria-describedby')!.split(/\s+/)) {
			const trigger = root.querySelector<HTMLElement>(`.qm-field-hint[aria-describedby="${id}"]`);
			if (trigger) return trigger;
			// A description under its label is on screen already, and the key is not the
			// container's to answer for it.
			if (document.getElementById(id)?.matches('.qm-field-brief')) return undefined;
		}
		el = el.parentElement?.closest('[aria-describedby]') ?? null;
	}
	return undefined;
}

/** Root keydown: the key raises (or lowers) the nearest guidance. A trigger's `click()`
 *  is an activation with no pointer behind it, which `FieldHint` toggles on. */
export function raiseGuidance(e: KeyboardEvent): void {
	if (!isGuidanceKey(e) || !(e.target instanceof Element)) return;
	const trigger = guidanceTrigger(e.target, e.currentTarget as Element);
	if (!trigger) return;
	e.preventDefault();
	trigger.click();
}
