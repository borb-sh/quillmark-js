// @vitest-environment jsdom
// Font runs (`codec/fonts.ts`): `font_family` marks overlap as the store's do and the
// leaf draws the family the render sets on each character, the popover's commands set a
// family as the winner over the selection and take the winner off, a run set in a family
// the registry lacks is marked, and a paste keeps a family the registry holds and
// nothing else of a run's face (`font-paste.ts`).
import { describe, it, expect } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Content, ContentMark } from '@quillmark/wasm';
import {
	blockSchema,
	createField,
	decode,
	pmToContent,
	removeFontFamily,
	selectionFamily,
	setFontFamily,
	type FontRegistry
} from '$lib/core/codec';
import { cssFamilies, fontSpans } from '$lib/core/codec/font-paste.js';
import { contentEqual, md, mount, normalize, quill, viewOf } from './_util.js';

const fontMarks = (rt: Content): ContentMark[] => rt.marks.filter((m) => m.type === 'font_family');

const family = (name: string, start: number, end: number): ContentMark => ({
	type: 'font_family',
	attrs: { name },
	start,
	end
});

/** A registry holding `families`, which `set` replaces. */
function registry(families: readonly string[] | undefined) {
	const watchers = new Set<() => void>();
	const fonts: FontRegistry = {
		families: () => families,
		watch(fn) {
			watchers.add(fn);
			return () => watchers.delete(fn);
		}
	};
	const set = (next: readonly string[]) => {
		families = next;
		watchers.forEach((fn) => fn());
	};
	return { fonts, set };
}

function leaf(content: Content | string, fonts?: FontRegistry) {
	const doc = quill().seedDocument();
	doc.overwrite({}, typeof content === 'string' ? md(content) : content);
	const field = createField({ doc, quill: quill(), addr: {}, container: mount(), fonts });
	const view = viewOf(field);
	const stored = () => doc.main.body;
	return { field, view, stored };
}

/** Select `[from, to)` of the first paragraph's text, in USV offsets from its start. */
function selectText(view: ReturnType<typeof leaf>['view'], from: number, to: number): void {
	view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1 + from, 1 + to)));
}

/** Each character of the first paragraph with the family the leaf draws it in. */
function drawn(view: ReturnType<typeof leaf>['view']): string {
	const out: string[] = [];
	view.state.doc.firstChild!.forEach((node) => {
		const win = node.marks.findLast((m) => m.type.name === 'font_family');
		for (const ch of node.text ?? '') out.push(`${ch}:${win?.attrs.name ?? '-'}`);
	});
	return out.join(' ');
}

describe('font runs through the codec', () => {
	it('decode → pmToContent is the identity over nested families, the inner one last', () => {
		const rt = normalize(
			md('<qm-font family="Arimo">ab<qm-font family="Carlito">cd</qm-font>ef</qm-font>')
		);
		const pm = decode(rt, blockSchema);
		const inner = pm.firstChild!.child(1).marks.map((m) => m.attrs.name);
		expect(inner).toEqual(['Arimo', 'Carlito']);
		expect(contentEqual(normalize(pmToContent(pm)), rt)).toBe(true);
	});

	it('draws the family that ranks first: the later start, then the shorter mark', () => {
		const crossing = { ...md('abcdef'), marks: [family('Arimo', 0, 4), family('Carlito', 2, 6)] };
		const { field, view } = leaf(crossing);
		expect(drawn(view)).toBe('a:Arimo b:Arimo c:Carlito d:Carlito e:Carlito f:Carlito');
		field.destroy();
		const sameStart = leaf(
			'<qm-font family="Arimo"><qm-font family="Carlito">abc</qm-font>def</qm-font>'
		);
		expect(drawn(sameStart.view)).toBe('a:Carlito b:Carlito c:Carlito d:Arimo e:Arimo f:Arimo');
		sameStart.field.destroy();
	});

	it('follows the render when an edit moves the winner outside the edit', () => {
		const { field, view, stored } = leaf(
			'<qm-font family="Arimo">ab<qm-font family="Carlito">cde</qm-font></qm-font><qm-font family="Carlito">fgh</qm-font>'
		);
		view.dispatch(view.state.tr.delete(1, 3));
		expect(fontMarks(stored())).toEqual([family('Arimo', 0, 3), family('Carlito', 0, 6)]);
		expect(drawn(view)).toBe('c:Arimo d:Arimo e:Arimo f:Carlito g:Carlito h:Carlito');
		field.destroy();
	});

	it('sets a family over part of a run inside it, leaving the run whole', () => {
		const { field, view, stored } = leaf('<qm-font family="Carlito">abcdef</qm-font>');
		selectText(view, 2, 4);
		expect(setFontFamily('Roboto')(view.state, view.dispatch)).toBe(true);
		const nested = '<qm-font family="Carlito">ab<qm-font family="Roboto">cd</qm-font>ef</qm-font>';
		expect(contentEqual(stored(), normalize(md(nested)))).toBe(true);
		field.destroy();
	});

	it('takes a family outranking the new one off the selection', () => {
		const { field, view, stored } = leaf(
			'<qm-font family="Carlito">ab<qm-font family="Roboto">cd</qm-font>ef</qm-font>'
		);
		selectText(view, 1, 3);
		setFontFamily('Arimo')(view.state, view.dispatch);
		expect(fontMarks(stored())).toEqual([
			family('Carlito', 0, 6),
			family('Arimo', 1, 3),
			family('Roboto', 3, 4)
		]);
		expect(drawn(view)).toBe('a:Carlito b:Arimo c:Arimo d:Roboto e:Carlito f:Carlito');
		field.destroy();
	});

	it('keeps the run a selection extends in its family, and a family set inside it', () => {
		const extended = leaf(
			'ab<qm-font family="Carlito">cd<qm-font family="Arimo">ef</qm-font>gh</qm-font>'
		);
		selectText(extended.view, 0, 4);
		setFontFamily('Arimo')(extended.view.state, extended.view.dispatch);
		expect(drawn(extended.view)).toBe(
			'a:Arimo b:Arimo c:Arimo d:Arimo e:Arimo f:Arimo g:Carlito h:Carlito'
		);
		extended.field.destroy();
		const inner = leaf(
			'ab<qm-font family="Arimo">c<qm-font family="Carlito">d</qm-font>ef</qm-font>'
		);
		selectText(inner.view, 0, 2);
		setFontFamily('Arimo')(inner.view.state, inner.view.dispatch);
		expect(fontMarks(inner.stored())).toEqual([family('Arimo', 0, 6), family('Carlito', 3, 4)]);
		inner.field.destroy();
	});

	it('takes the families a selection draws in off it, so one they sat in shows again', () => {
		const NESTED = '<qm-font family="Carlito">ab<qm-font family="Roboto">cd</qm-font>ef</qm-font>';
		const inner = leaf(NESTED);
		selectText(inner.view, 2, 4);
		expect(removeFontFamily(inner.view.state, inner.view.dispatch)).toBe(true);
		expect(fontMarks(inner.stored())).toEqual([family('Carlito', 0, 6)]);
		inner.field.destroy();
		const whole = leaf(NESTED);
		selectText(whole.view, 1, 5);
		removeFontFamily(whole.view.state, whole.view.dispatch);
		expect(fontMarks(whole.stored())).toEqual([family('Carlito', 0, 1), family('Carlito', 5, 6)]);
		whole.field.destroy();
	});

	it('reads the selection as one family, none, or more than one', () => {
		const { field, view } = leaf(
			'<qm-font family="Carlito">a<qm-font family="Roboto">b</qm-font></qm-font>cd'
		);
		selectText(view, 1, 2);
		expect(selectionFamily(view.state)).toBe('Roboto');
		selectText(view, 2, 4);
		expect(selectionFamily(view.state)).toBe(null);
		selectText(view, 0, 2);
		expect(selectionFamily(view.state)).toBe(undefined);
		field.destroy();
	});

	it('refuses a command over an empty selection', () => {
		const { field, view } = leaf('abc');
		selectText(view, 1, 1);
		expect(setFontFamily('Carlito')(view.state)).toBe(false);
		expect(removeFontFamily(view.state)).toBe(false);
		field.destroy();
	});
});

describe('a run in a family the registry lacks', () => {
	const marked = (view: ReturnType<typeof leaf>['view']) =>
		[...view.dom.querySelectorAll('.qm-font-missing')].map((el) => el.textContent);
	const DOC = '<qm-font family="carlito">ab</qm-font> <qm-font family="Gone">cd</qm-font>';

	it('is marked, a family matching lowercased being held', () => {
		const { field, view } = leaf(DOC, registry(['Carlito']).fonts);
		expect(marked(view)).toEqual(['cd']);
		field.destroy();
	});

	it('is marked again when the registry changes', () => {
		const { fonts, set } = registry(['Carlito']);
		const { field, view } = leaf(DOC, fonts);
		set(['Gone']);
		expect(marked(view)).toEqual(['ab']);
		field.destroy();
	});

	it('is not marked while no registry is handed over', () => {
		const { field, view } = leaf(DOC, registry(undefined).fonts);
		expect(marked(view)).toEqual([]);
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
		const { field, view, stored } = leaf('', registry(families).fonts);
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
		expect(fontMarks(rt)).toEqual([family('Carlito', 2, 3)]);
	});

	it('keeps no family where the registry is empty', () => {
		const rt = paste(`<p><span style="font-family: Carlito">b</span></p>`, []);
		expect(fontMarks(rt)).toEqual([]);
	});

	it('keeps nested runs copied out of a leaf, whatever the registry holds', () => {
		const rt = paste(
			`<p><span data-qm-font-family="Gone">a<span data-qm-font-family="Lost">b</span></span></p>`,
			[]
		);
		expect(fontMarks(rt)).toEqual([family('Gone', 0, 2), family('Lost', 1, 2)]);
	});
});
