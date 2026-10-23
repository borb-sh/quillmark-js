// A list copied out of Word or Outlook lands as a list. Desktop Word writes no `<ol>` or
// `<li>`: each item is a paragraph styled `mso-list:l0 level2 lfo1`, its marker drawn by a
// `mso-list:Ignore` span ahead of the text. Each run of those paragraphs is rebuilt here as
// the nested lists it draws, the marker span dropped, so the paste rules after this one
// (`list-paste.ts`) see a list as any other source writes one.
import { Plugin } from 'prosemirror-state';

/** A Word list paragraph's style: the list it is in, and its level from 1. */
const MSO_LIST = /mso-list:\s*(l\d+)\s+level(\d+)\s+(lfo\d+)/i;

/** A numbered marker: digits, or letters, closed by `.` or `)`, or in parentheses. Every
 *  other marker is a bullet, Word's `·`, `o` and `§` among them. */
const ORDINAL = /^\(?(\d+|[a-z]+)[.)]$/i;

interface Open {
	level: number;
	list: HTMLElement;
}

/** The marker text of a list paragraph, its span taken out. */
function takeMarker(p: Element): string {
	const span = [...p.querySelectorAll('span')].find((s) =>
		/mso-list:\s*Ignore/i.test(s.getAttribute('style') ?? '')
	);
	if (!span) return '';
	const marker = (span.textContent ?? '').replace(/\s+/g, '');
	span.remove();
	return marker;
}

/** `run`'s paragraphs as nested lists, one level of the stack a level of Word's. */
function rebuild(doc: Document, run: { p: Element; level: number }[]): HTMLElement {
	const stack: Open[] = [];
	let root: HTMLElement | null = null;
	for (const { p, level } of run) {
		const marker = takeMarker(p);
		while (stack.length && stack[stack.length - 1].level > level) stack.pop();
		const top = stack[stack.length - 1];
		if (!top || top.level < level) {
			const ordinal = ORDINAL.exec(marker);
			const list = doc.createElement(ordinal ? 'ol' : 'ul');
			if (ordinal && /^\d+$/.test(ordinal[1]) && ordinal[1] !== '1')
				list.setAttribute('start', ordinal[1]);
			if (top) top.list.lastElementChild!.append(list);
			else root = list;
			stack.push({ level, list });
		}
		const item = doc.createElement('li');
		p.removeAttribute('style');
		p.removeAttribute('class');
		item.append(p);
		stack[stack.length - 1].list.append(item);
	}
	return root!;
}

/** `html` with every run of Word list paragraphs made a list; `html` itself where there
 *  are none. */
export function wordLists(html: string): string {
	if (!/mso-list/i.test(html)) return html;
	const doc = new DOMParser().parseFromString(html, 'text/html');
	const runs: { p: Element; level: number }[][] = [];
	let id: string | null = null;
	for (const p of doc.body.querySelectorAll('p')) {
		const match = MSO_LIST.exec(p.getAttribute('style') ?? '');
		if (!match) continue;
		const prev = runs[runs.length - 1]?.at(-1)?.p;
		let sibling = p.previousSibling;
		while (
			sibling &&
			sibling.nodeType !== 1 &&
			!(sibling.nodeType === 3 && sibling.textContent!.trim())
		)
			sibling = sibling.previousSibling;
		const list = match[1] + match[3];
		const entry = { p, level: Number(match[2]) };
		if (prev && sibling === prev && list === id) runs[runs.length - 1].push(entry);
		else runs.push([entry]);
		id = list;
	}
	if (!runs.length) return html;
	for (const run of runs) {
		const anchor = doc.createComment('');
		run[0].p.before(anchor);
		anchor.replaceWith(rebuild(doc, run));
	}
	return doc.body.innerHTML;
}

export function wordPastePlugin(): Plugin {
	return new Plugin({ props: { transformPastedHTML: (html) => wordLists(html) } });
}
