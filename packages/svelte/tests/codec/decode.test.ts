// Decode: idempotence up to normalization, overlapping-mark inline splits, island
// round-trip, the inline/plaintext constraints, and the href gate the link mark
// renders through (its DOM is asserted where a DOM exists, `visual/tips.test.ts`).
import { describe, it, expect } from 'vitest';
import {
	decode,
	fitsInline,
	pmToContent,
	rendersHref,
	blockSchema,
	inlineSchema,
	plaintextSchema
} from '$lib/core/codec';
import type { Content } from '@quillmark/wasm';
import type { Node as PMNode } from 'prosemirror-model';
import { pmMarkFromContent } from '$lib/core/codec/marks.js';
import { md, normalize, contentEqual, titleContent, bodyContent } from './_util.js';

/** decode → pmToContent, both sides normalized through the real content. */
function reContent(rt: Content): Content {
	return normalize(pmToContent(decode(rt, blockSchema)));
}

describe('decode idempotence (up to normalization)', () => {
	const cases: Record<string, Content> = {
		twoParas: md('First para.\n\nSecond para.'),
		heading: md('# Title\n\nBody text with a tail.'),
		bulletList: md('- one\n- two\n- three'),
		nestedList: md('- outer\n    - inner1\n    - inner2'),
		orderedList: md('1. first\n2. second\n3. third'),
		blockquote: md('> quoted line\n\nafter the quote'),
		nestedQuoteList: md('> - quoted bullet'),
		codeFence: md('```js\nconst x = 1;\nconst y = 2;\n```'),
		hardBreak: md('line one\\\nline two'),
		marks: md('normal **bold** *italic* `code` [link](http://x)'),
		overlap: md('**bold _both_ italic**'),
		strike: md('~~struck~~ and plain'),
		underline: md('<u>underlined</u> text'),
		astral: md('emoji 😀 and 漢字 **bold 🎉**'),
		realTitle: titleContent(),
		realBody: bodyContent()
	};
	for (const [name, rt] of Object.entries(cases)) {
		it(name, () => {
			expect(contentEqual(reContent(rt), normalize(rt)), name).toBe(true);
		});
	}
});

describe('overlapping formatting → correct inline node splits', () => {
	it('strong[0,4)+emph[2,6) yields {strong},{strong,emph},{emph}', () => {
		const rt: Content = {
			text: 'abcdef',
			lines: [{ containers: [], kind: 'para' }],
			marks: [
				{ start: 0, end: 4, type: 'strong' },
				{ start: 2, end: 6, type: 'emph' }
			],
			islands: []
		};
		const para = decode(rt, blockSchema).child(0);
		const runs = para.children.map((n) => ({
			text: n.text,
			marks: n.marks.map((m) => m.type.name).sort()
		}));
		expect(runs).toEqual([
			{ text: 'ab', marks: ['strong'] },
			{ text: 'cd', marks: ['em', 'strong'] },
			{ text: 'ef', marks: ['em'] }
		]);
	});
});

describe('island round-trip (id preserved)', () => {
	it('image (inline island) survives decode → pmToContent → normalize', () => {
		const rt = md('![alt text](img.png)');
		expect(rt.islands[0].type).toBe('image');
		// Alone on its line and still inline: the island's type, not the line, says block.
		const decoded = decode(rt, blockSchema);
		expect(decoded.child(0).type.name).toBe('paragraph');
		expect(decoded.child(0).child(0).type.name).toBe('island_inline');
		const back = pmToContent(decoded);
		expect(back.islands).toHaveLength(1);
		expect(back.islands[0].type).toBe('image');
		expect(back.islands[0].id).toBe(rt.islands[0].id);
		expect(back.text).toContain('￼');
		expect(contentEqual(normalize(back), normalize(rt))).toBe(true);
	});

	it('table (block island) survives with id preserved', () => {
		const rt = md('| a | b |\n|---|---|\n| 1 | 2 |');
		expect(rt.islands[0].type).toBe('table');
		const decoded = decode(rt, blockSchema);
		expect(rt.lines[0].kind).toBe('para');
		expect(decoded.child(0).type.name).toBe('island_block');
		const back = pmToContent(decoded);
		expect(back.islands[0].type).toBe('table');
		expect(back.islands[0].id).toBe(rt.islands[0].id);
		expect(contentEqual(normalize(back), normalize(rt))).toBe(true);
	});
});

describe('inline / plaintext constraints', () => {
	it('fitsInline admits one plain paragraph and refuses what the inline decode drops', () => {
		expect(fitsInline(md(''))).toBe(true);
		expect(fitsInline(md('plain **bold** end'))).toBe(true);
		for (const src of ['a\n\nb', 'one  \ntwo', '- one\n- two', '- one', '# Title', '> quoted']) {
			expect(fitsInline(md(src)), src).toBe(false);
		}
	});

	it('inline schema decodes to exactly one paragraph', () => {
		const doc = decode(md('a\n\nb\n\nc'), inlineSchema);
		expect(doc.childCount).toBe(1);
		expect(doc.child(0).type.name).toBe('paragraph');
	});

	it('inline keeps marks', () => {
		const doc = decode(md('plain **bold** end'), inlineSchema);
		const hasStrong = doc
			.child(0)
			.children.some((n) => n.marks.some((m) => m.type.name === 'strong'));
		expect(hasStrong).toBe(true);
	});

	// A content carrying marks under the mark-free schema: what an older build's
	// popover left on a plaintext field, and what has to open rather than throw.
	it('the plaintext schema strips marks', () => {
		const doc = decode(md('plain **bold** *em*'), plaintextSchema);
		const anyMark = doc.child(0).children.some((n) => n.marks.length > 0);
		expect(anyMark).toBe(false);
		expect(doc.child(0).textContent).toBe('plain bold em');
	});
});

// Contiguity plus an equal container path reads as one container, so a second
// adjacent run of one shape carries `instance`. It is the only thing that tells the
// two apart: the normalizer numbers a run's `ordinal`s gaplessly from 0, so a reset
// carries no boundary of its own.
describe('adjacent sibling containers (the `instance` boundary)', () => {
	const item = (ordinal: number, instance = 0) =>
		({ container: 'list_item', attrs: { ordered: false, start: 1, ordinal }, instance }) as never;
	const twoLists: Content = {
		text: 'a\nb\nc',
		lines: [
			{ containers: [item(0)], kind: 'para' },
			{ containers: [item(1)], kind: 'para' },
			{ containers: [item(0, 1)], kind: 'para' }
		],
		marks: [],
		islands: []
	};
	const twoQuotes: Content = {
		text: 'a\nb',
		lines: [
			{ containers: [{ container: 'quote', instance: 0 }], kind: 'para' },
			{ containers: [{ container: 'quote', instance: 1 }], kind: 'para' }
		],
		marks: [],
		islands: []
	};

	it('decodes a second list `instance` as a NEW list, not a merged one', () => {
		const doc = decode(twoLists, blockSchema);
		expect(doc.childCount).toBe(2);
		expect(doc.child(0).type.name).toBe('bullet_list');
		expect(doc.child(0).childCount).toBe(2);
		expect(doc.child(1).type.name).toBe('bullet_list');
		expect(doc.child(1).childCount).toBe(1);
	});

	it('decodes a second quote `instance` as a NEW blockquote', () => {
		const doc = decode(twoQuotes, blockSchema);
		expect(doc.childCount).toBe(2);
		expect(doc.children.map((n) => n.type.name)).toEqual(['blockquote', 'blockquote']);
	});

	it('round-trips through the content (the exit-criterion shape)', () => {
		// The normalizer keeps the discriminator, so a merged decode would re-encode
		// one run — ordinals [0,1,2], or one two-paragraph quote — and fail this equality.
		for (const rt of [twoLists, twoQuotes]) {
			const canon = normalize(rt);
			expect(contentEqual(normalize(pmToContent(decode(canon, blockSchema))), canon)).toBe(true);
		}
	});
});

describe('mark-set run keying', () => {
	it('does not alias a link url containing `|` with a mark set', () => {
		// url "a|strong" on [0,1) next to {link "a", strong} on [1,2): the two mark
		// sets must key differently, or the runs merge and the second set is dropped.
		const rt: Content = {
			text: 'ab',
			lines: [{ containers: [], kind: 'para' }],
			marks: [
				{ start: 0, end: 1, type: 'link', attrs: { url: 'a|strong' } } as never,
				{ start: 1, end: 2, type: 'link', attrs: { url: 'a' } } as never,
				{ start: 1, end: 2, type: 'strong' } as never
			],
			islands: []
		};
		const para = decode(rt, blockSchema).child(0);
		expect(para.childCount).toBe(2);
		expect(para.child(0).marks.map((m) => [m.type.name, m.attrs.href])).toEqual([
			['link', 'a|strong']
		]);
		const second = para
			.child(1)
			.marks.map((m) => m.type.name)
			.sort();
		expect(second).toEqual(['link', 'strong']);
		expect(para.child(1).marks.find((m) => m.type.name === 'link')?.attrs.href).toBe('a');
	});
});

describe('the href gate', () => {
	/** One paragraph, one linked run. */
	function linked(href: string): Content {
		return {
			text: 'here',
			lines: [{ containers: [], kind: 'para' }],
			marks: [{ start: 0, end: 4, type: 'link', attrs: { url: href } } as never],
			islands: []
		};
	}

	it('admits a relative value, which carries no scheme to refuse', () => {
		for (const href of ['/a/b', '#anchor', '?q=1', '//cdn.x.com/a', 'page.html', 'a/b:c'])
			expect(rendersHref(href)).toBe(true);
	});

	it('reads the scheme a browser would, not the one the string spells', () => {
		// Leading control characters and an embedded tab are dropped before a URL's
		// scheme is parsed, so the test runs on what the navigation resolves to.
		for (const href of [
			'java\tscript:alert(1)',
			'\u0001javascript:alert(1)',
			'JAVASCRIPT:alert(1)'
		])
			expect(rendersHref(href)).toBe(false);
	});

	it('keeps a refused href on the mark, so the document round-trips', () => {
		// The gate is the render's, not the model's: refusing at decode would drop the
		// value on the next commit, editing a document by opening it.
		const rt = linked('javascript:alert(1)');
		const mark = decode(rt, blockSchema).child(0).child(0).marks[0]!;
		expect(mark.attrs.href).toBe('javascript:alert(1)');
		expect(contentEqual(reContent(rt), normalize(rt))).toBe(true);
	});
});

describe('inline runs against the per-code-point definition', () => {
	// A run's marks are what a scan of every code point states. Overlaps, adjacency and
	// astral text are where an edge is miscounted, so the corpus is generated.

	/** Every code point's mark set, scanned: the definition the runs answer to. Lowered
	 *  through the shared converter, so the assertion is which code points carry which set
	 *  rather than how a mark spells itself in either vocabulary. */
	function scanned(rt: Content): string[][] {
		return [...rt.text].map((_, i) =>
			rt.marks
				.filter((m) => m.start <= i && i < m.end)
				.map((m) => pmMarkFromContent(blockSchema, m)?.type.name)
				.filter((name): name is string => !!name)
				.sort()
		);
	}

	/** The same, read off the decoded paragraph's inline runs. */
	function projected(doc: PMNode): string[][] {
		const out: string[][] = [];
		doc.child(0).forEach((node) => {
			const types = node.marks.map((m) => m.type.name).sort();
			for (const _ of node.text ?? '') out.push(types);
		});
		return out;
	}

	/** A deterministic body of overlapping, adjacent and nested marks over astral text. */
	function fuzz(seed: number): string {
		let s = seed;
		const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
		const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
		const atoms = ['a', 'bb', 'ccc', '😀', 'x😀y', 'é', 'word'];
		const wraps = [
			(t: string) => `**${t}**`,
			(t: string) => `*${t}*`,
			(t: string) => `[${t}](https://e.x/1)`,
			(t: string) => `***${t}***`,
			(t: string) => t
		];
		let line = '';
		for (let i = 0; i < 8; i++) line += pick(wraps)(pick(atoms) + pick(atoms));
		return line || 'fallback';
	}

	it('gives every code point the marks the content states', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const rt = md(fuzz(seed));
			// One line, so the paragraph's runs tile `text` with no `\n` between them.
			expect(rt.text.includes('\n'), `seed ${seed}`).toBe(false);
			expect(projected(decode(rt, blockSchema)), `seed ${seed}`).toEqual(scanned(rt));
		}
	});

	it('resolves the set again after an island slot, which carries no run of its own', () => {
		// The slot's position is skipped, so a mark edge landing on it is seen only by the
		// re-resolve the slot forces.
		const rt: Content = {
			text: 'ab￼cd',
			lines: [{ containers: [], kind: 'para' }],
			marks: [{ start: 2, end: 5, type: 'strong' } as never],
			islands: [{ id: 'i1', type: 'table', props: null } as never]
		};
		const para = decode(rt, blockSchema).child(0);
		const tail = para.child(para.childCount - 1);
		expect(tail.text).toBe('cd');
		expect(tail.marks.map((m) => m.type.name)).toEqual(['strong']);
	});
});
