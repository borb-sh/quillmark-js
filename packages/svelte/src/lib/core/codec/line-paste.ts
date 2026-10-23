// A one-line leaf holds one paragraph, so a paste of several lines lands as that one line:
// the lines joined by a space, as a browser's single-line input joins them, where the
// schema would keep the first and drop the rest. An element of an array of them is the
// exception the array asks for (`visual/ProseValue.svelte`): there each line is a row.
import { Fragment, Slice, type Node as PMNode, type Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';

/** The lines a slice holds that hold anything, in order. */
export function pastedLines(slice: Slice): PMNode[] {
	const lines: PMNode[] = [];
	slice.content.descendants((node) => {
		if (node.isTextblock && node.content.size) lines.push(node);
		return !node.isTextblock;
	});
	return lines;
}

/** `lines` as the content of one line, a space between each two. */
export function joinLines(lines: readonly PMNode[], schema: Schema): Fragment {
	const parts: PMNode[] = [];
	for (const line of lines) {
		if (parts.length) parts.push(schema.text(' '));
		line.content.forEach((node) => parts.push(node));
	}
	return Fragment.from(parts);
}

export function linePastePlugin(): Plugin {
	return new Plugin({
		props: {
			transformPasted(slice, view) {
				const lines = pastedLines(slice);
				return lines.length > 1 ? new Slice(joinLines(lines, view.state.schema), 0, 0) : slice;
			}
		}
	});
}
