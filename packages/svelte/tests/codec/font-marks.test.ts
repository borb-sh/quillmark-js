// @vitest-environment jsdom
// Font runs (`codec/fonts.ts`): one `font_family` mark per character as the store keeps
// them, the popover's commands set a family over the selection in place of the one it
// was set in and take it off, a run set in a family the registry lacks is marked, and a
// paste keeps a family the registry holds and nothing else of a run's face
// (`font-paste.ts`).
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
		const win = node.marks.find((m) => m.type.name === 'font_family');
		for (const ch of node.text ?? '') out.push(`${ch}:${win?.attrs.name ?? '-'}`);
	});
	return out.join(' ');
}

describe('font runs through the codec', () => {
	it('decode → pmToContent is the identity over nested pairs, which import flat', () => {
		const rt = normalize(
			md('<qm-span family="Arimo">ab<qm-span family="Carlito">cd</qm-span>ef</qm-span>')
		);
		expect(fontMarks(rt)).toEqual([
			family('Arimo', 0, 2),
			family('Carlito', 2, 4),
			family('Arimo', 4, 6)
		]);
		const pm = decode(rt, blockSchema);
		pm.firstChild!.forEach((node) =>
			expect(node.marks.filter((m) => m.type.name === 'font_family')).toHaveLength(1)
		);
		expect(contentEqual(normalize(pmToContent(pm)), rt)).toBe(true);
	});

	it('draws one family per character', () => {
		const { field, view } = leaf(
			'<qm-span family="Arimo">ab<qm-span family="Carlito">cd</qm-span></qm-span>e'
		);
		expect(drawn(view)).toBe('a:Arimo b:Arimo c:Carlito d:Carlito e:-');
		field.destroy();
	});

	it('sets a family over part of a run, replacing the run’s family there', () => {
		const { field, view, stored } = leaf('<qm-span family="Carlito">abcdef</qm-span>');
		selectText(view, 2, 4);
		expect(setFontFamily('Roboto')(view.state, view.dispatch)).toBe(true);
		const flat =
			'<qm-span family="Carlito">ab</qm-span><qm-span family="Roboto">cd</qm-span><qm-span family="Carlito">ef</qm-span>';
		expect(contentEqual(stored(), normalize(md(flat)))).toBe(true);
		expect(drawn(view)).toBe('a:Carlito b:Carlito c:Roboto d:Roboto e:Carlito f:Carlito');
		field.destroy();
	});

	it('joins a run a selection extends into one', () => {
		const { field, view, stored } = leaf(
			'ab<qm-span family="Carlito">cd</qm-span><qm-span family="Arimo">ef</qm-span>'
		);
		selectText(view, 0, 3);
		setFontFamily('Carlito')(view.state, view.dispatch);
		expect(fontMarks(stored())).toEqual([family('Carlito', 0, 4), family('Arimo', 4, 6)]);
		field.destroy();
	});

	it('takes every family off a selection, leaving it in none', () => {
		const { field, view, stored } = leaf(
			'<qm-span family="Carlito">ab</qm-span><qm-span family="Roboto">cd</qm-span><qm-span family="Carlito">ef</qm-span>'
		);
		selectText(view, 1, 5);
		expect(removeFontFamily(view.state, view.dispatch)).toBe(true);
		expect(fontMarks(stored())).toEqual([family('Carlito', 0, 1), family('Carlito', 5, 6)]);
		field.destroy();
	});

	it('reads the selection as one family, none, or more than one', () => {
		const { field, view } = leaf(
			'<qm-span family="Carlito">a</qm-span><qm-span family="Roboto">b</qm-span>cd'
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
	const DOC = '<qm-span family="carlito">ab</qm-span> <qm-span family="Gone">cd</qm-span>';

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

	it('keeps runs copied out of a leaf, whatever the registry holds, one family a character', () => {
		const rt = paste(
			`<p><span data-qm-font-family="Gone">a<span data-qm-font-family="Lost">b</span></span></p>`,
			[]
		);
		expect(fontMarks(rt)).toEqual([family('Gone', 0, 1), family('Lost', 1, 2)]);
	});
});
