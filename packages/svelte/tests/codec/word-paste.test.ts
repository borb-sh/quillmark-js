// @vitest-environment jsdom
// A list copied out of desktop Word or Outlook (`codec/word-paste.ts`): paragraphs styled
// `mso-list`, each with its marker in a `mso-list:Ignore` span, pasted into a mounted leaf.
import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { createField } from '$lib/core/codec';
import { wordLists } from '$lib/core/codec/word-paste.js';
import { md, mount, quill, representable, viewOf } from './_util.js';

/** A Word list paragraph, as the clipboard carries one. */
function item(text: string, marker: string, level = 1, list = 'l0', lfo = 'lfo1'): string {
	return (
		`<p class=MsoListParagraphCxSpMiddle style='text-indent:-.25in;mso-list:${list} level${level} ${lfo}'>` +
		`<!--[if !supportLists]--><span style='mso-list:Ignore'>${marker}` +
		`<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp; </span></span><!--[endif]-->` +
		`${text}<o:p></o:p></p>\n`
	);
}

const para = (text: string) => `<p class=MsoNormal>${text}<o:p></o:p></p>\n`;

/** The page Word writes around a fragment. */
const page = (body: string) =>
	`<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0}</style></head>` +
	`<body lang=EN-US><div class=WordSection1><!--StartFragment-->${body}<!--EndFragment--></div></body></html>`;

function pasted(html: string) {
	const doc = quill().seedDocument();
	doc.overwrite({}, md(''));
	const field = createField({ doc, quill: quill(), addr: {}, container: mount() });
	const view = viewOf(field);
	view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
	const event = new Event('paste', { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'clipboardData', {
		value: { getData: (type: string) => (type === 'text/html' ? html : ''), setData: () => {} }
	});
	view.dom.dispatchEvent(event);
	const state = view.state;
	field.destroy();
	return state;
}

describe('a Word list pastes as a list', () => {
	it('numbers the items and drops the drawn markers', () => {
		const state = pasted(page(item('Alpha', '1.') + item('Bravo', '2.')));
		expect(state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("Alpha")), list_item(paragraph("Bravo"))))'
		);
		expect(representable(state)).toBe(true);
	});

	it('nests by level, the memo outline’s markers read as numbered', () => {
		const state = pasted(
			page(
				item('Alpha', '1.') +
					item('Bravo', 'a.', 2) +
					item('Charlie', '(1)', 3) +
					item('Delta', '2.')
			)
		);
		expect(state.doc.toString()).toBe(
			'doc(ordered_list(list_item(paragraph("Alpha"), ordered_list(list_item(paragraph("Bravo"), ordered_list(list_item(paragraph("Charlie")))))), list_item(paragraph("Delta"))))'
		);
		expect(representable(state)).toBe(true);
	});

	it('reads Word’s bullet glyphs as bullets', () => {
		const state = pasted(
			page(item('Alpha', '·') + item('Bravo', 'o', 2) + item('Charlie', '§', 3))
		);
		expect(state.doc.toString()).toBe(
			'doc(bullet_list(list_item(paragraph("Alpha"), bullet_list(list_item(paragraph("Bravo"), bullet_list(list_item(paragraph("Charlie"))))))))'
		);
	});

	it('keeps the paragraphs around a list, and a paragraph between two lists splits them', () => {
		const state = pasted(
			page(
				para('Intro') + item('Alpha', '1.') + para('Between') + item('Bravo', '1.', 1, 'l1', 'lfo2')
			)
		);
		expect(state.doc.toString()).toBe(
			'doc(paragraph("Intro"), ordered_list(list_item(paragraph("Alpha"))), paragraph("Between"), ordered_list(list_item(paragraph("Bravo"))))'
		);
	});
});

describe('wordLists', () => {
	it('keeps the number a list starts from', () => {
		expect(wordLists(item('Alpha', '3.'))).toContain('<ol start="3">');
	});

	it('reads a legal outline’s marker by its last part', () => {
		const html = wordLists(item('Alpha', '2.') + item('Bravo', '2.3.', 2));
		expect(html).toContain('<ol start="2">');
		expect(html).toContain('<ol start="3">');
	});

	it('leaves HTML with no Word list as it came', () => {
		const html = '<p>Alpha</p><ol><li>Bravo</li></ol>';
		expect(wordLists(html)).toBe(html);
	});
});
