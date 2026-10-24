// @vitest-environment jsdom
// Font runs (`codec/fonts.ts`): a `font_family` and a `font_size` mark decode from the
// store and lower back to it, the popover's commands set and take off a value over the
// selection, each mark excluding its own type as the store's keyed marks do, and a paste
// keeps a family the registry holds and nothing else of a run's face (`font-paste.ts`).
import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Content, ContentMark } from '@quillmark/wasm';
import {
	blockSchema,
	createField,
	decode,
	pmToContent,
	selectionFamily,
	selectionStep,
	setFontFamily,
	setFontStep
} from '$lib/core/codec';
import { cssFamilies } from '$lib/core/codec/fonts.js';
import { fontSpans } from '$lib/core/codec/font-paste.js';
import { contentEqual, md, mount, normalize, quill, viewOf } from './_util.js';

const fontMarks = (rt: Content): ContentMark[] =>
	rt.marks.filter((m) => m.type === 'font_family' || m.type === 'font_size');

function leaf(markdown: string, fontFamilies?: () => readonly string[]) {
	const doc = quill().seedDocument();
	doc.overwrite({}, md(markdown));
	const field = createField({ doc, quill: quill(), addr: {}, container: mount(), fontFamilies });
	const view = viewOf(field);
	const stored = () => doc.main.body;
	return { field, view, stored };
}

/** Select `[from, to)` of the first paragraph's text, in USV offsets from its start. */
function selectText(view: ReturnType<typeof leaf>['view'], from: number, to: number): void {
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + from, 1 + to)));
}

describe('font runs through the codec', () => {
	it('decode → pmToContent is the identity over a run in a family and a step', () => {
		const rt = normalize(md('a <qm-font family="Carlito" size="large">big</qm-font> b'));
		expect(fontMarks(rt).map((m) => m.type)).toEqual(['font_family', 'font_size']);
		const pm = decode(rt, blockSchema);
		const marks = pm.firstChild!.child(1).marks.map((m) => [m.type.name, m.attrs]);
		expect(marks).toEqual([
			['font_family', { name: 'Carlito' }],
			['font_size', { step: 'large' }]
		]);
		expect(contentEqual(normalize(pmToContent(pm)), rt)).toBe(true);
	});

	it('sets a family and a step over the selection, and the store reads them back', () => {
		const { field, view, stored } = leaf('one two three');
		selectText(view, 4, 7);
		expect(setFontFamily('Carlito')(view.state, view.dispatch)).toBe(true);
		expect(setFontStep('small')(view.state, view.dispatch)).toBe(true);
		expect(
			contentEqual(
				stored(),
				normalize(md('one <qm-font family="Carlito" size="small">two</qm-font> three'))
			)
		).toBe(true);
		field.destroy();
	});

	it('replaces a family over part of a run rather than stacking a second', () => {
		const { field, view, stored } = leaf('<qm-font family="Carlito">abcdef</qm-font>');
		selectText(view, 2, 4);
		setFontFamily('Roboto')(view.state, view.dispatch);
		expect(
			contentEqual(
				stored(),
				normalize(
					md(
						'<qm-font family="Carlito">ab</qm-font><qm-font family="Roboto">cd</qm-font><qm-font family="Carlito">ef</qm-font>'
					)
				)
			)
		).toBe(true);
		field.destroy();
	});

	it('takes a step off with `null`, leaving the family', () => {
		const { field, view, stored } = leaf('<qm-font family="Carlito" size="large">abc</qm-font>');
		selectText(view, 0, 3);
		setFontStep(null)(view.state, view.dispatch);
		expect(contentEqual(stored(), normalize(md('<qm-font family="Carlito">abc</qm-font>')))).toBe(
			true
		);
		field.destroy();
	});

	it('reads the selection as one value, none, or more than one', () => {
		const { field, view } = leaf('<qm-font family="Carlito" size="large">ab</qm-font>cd');
		selectText(view, 0, 2);
		expect([selectionFamily(view.state), selectionStep(view.state)]).toEqual(['Carlito', 'large']);
		selectText(view, 2, 4);
		expect([selectionFamily(view.state), selectionStep(view.state)]).toEqual([null, null]);
		selectText(view, 1, 3);
		expect([selectionFamily(view.state), selectionStep(view.state)]).toEqual([
			undefined,
			undefined
		]);
		field.destroy();
	});

	it('refuses a command over an empty selection', () => {
		const { field, view } = leaf('abc');
		selectText(view, 1, 1);
		expect(setFontFamily('Carlito')(view.state)).toBe(false);
		field.destroy();
	});
});

describe('a pasted run’s face', () => {
	const FAMILIES = ['Carlito', 'Roboto'];

	it('reads the families of a CSS value in order, quoted or bare', () => {
		expect(cssFamilies(`"Open \\"Sans\\"", 'Carlito' , serif`)).toEqual([
			'Open "Sans"',
			'Carlito',
			'serif'
		]);
	});

	it('states a span’s first registry family as the schema reads it, in the registry’s spelling', () => {
		const html = fontSpans(
			`<span style="font-family: Calibri, carlito, sans-serif">x</span>`,
			FAMILIES
		);
		const span = new DOMParser().parseFromString(html, 'text/html').querySelector('span')!;
		expect(span.getAttribute('data-qm-font-family')).toBe('Carlito');
	});

	it('leaves a span whose families the registry does not hold', () => {
		const html = `<span style="font-family: Calibri">x</span>`;
		expect(fontSpans(html, FAMILIES)).toBe(html);
	});

	function paste(html: string, families: readonly string[]): Content {
		const { field, view, stored } = leaf('', () => families);
		view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)));
		const event = new Event('paste', { bubbles: true, cancelable: true });
		Object.defineProperty(event, 'clipboardData', {
			value: { getData: (type: string) => (type === 'text/html' ? html : ''), setData: () => {} }
		});
		view.dom.dispatchEvent(event);
		const rt = stored();
		field.destroy();
		return rt;
	}

	it('keeps a registry family into the leaf and drops an absolute size', () => {
		const rt = paste(
			`<p>a <span style="font-family: 'Carlito'; font-size: 18pt">b</span> c</p>`,
			FAMILIES
		);
		expect(rt.text).toBe('a b c');
		expect(fontMarks(rt)).toEqual([
			{ type: 'font_family', attrs: { name: 'Carlito' }, start: 2, end: 3 }
		]);
	});

	it('keeps no family where the registry is empty', () => {
		const rt = paste(`<p><span style="font-family: Carlito">b</span></p>`, []);
		expect(fontMarks(rt)).toEqual([]);
	});

	it('keeps a run copied out of a leaf, whatever the registry holds', () => {
		const rt = paste(
			`<p><span data-qm-font-family="Gone" style="--_qm-run-font: &quot;qm gone&quot;"><span data-qm-font-size="large">b</span></span></p>`,
			[]
		);
		expect(fontMarks(rt).map((m) => [m.type, m.attrs])).toEqual([
			['font_family', { name: 'Gone' }],
			['font_size', { step: 'large' }]
		]);
	});
});
