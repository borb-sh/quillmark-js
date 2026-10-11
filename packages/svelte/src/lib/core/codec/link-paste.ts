// A URL pasted over a selection links it (CODEC §"Markdown at the edges"). Selecting words
// and pasting an address is how a writer links them in every editor they have used, and
// the words are what they meant to keep.
import type { MarkType } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import { rendersHref } from './urls.js';

/** One URL and nothing else: a scheme, then no whitespace. */
const URL_ALONE = /^[a-z][a-z0-9+.-]*:\S+$/i;

/**
 * Links a selection within one block where the clipboard's text is one URL naming a
 * scheme the mark renders. A selection crossing blocks, or held in one taking no link
 * (a code block), keeps the default paste, and so does a URL nothing would follow.
 *
 * The ops are `setLink`'s pair (`visual/links.ts`), so the mark diff lowers the paste
 * as one link exchanged for another.
 */
export function linkPastePlugin(link: MarkType): Plugin {
	return new Plugin({
		props: {
			handlePaste(view, event) {
				const { selection } = view.state;
				if (!(selection instanceof TextSelection) || selection.empty) return false;
				const { $from, $to } = selection;
				if (!$from.sameParent($to) || !$from.parent.type.allowsMarkType(link)) return false;
				const href = event.clipboardData?.getData('text/plain').trim() ?? '';
				if (!URL_ALONE.test(href) || !rendersHref(href)) return false;
				const { from, to } = selection;
				view.dispatch(
					view.state.tr.removeMark(from, to, link).addMark(from, to, link.create({ href }))
				);
				return true;
			}
		}
	});
}
