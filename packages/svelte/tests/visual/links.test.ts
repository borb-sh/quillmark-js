// The link prompt's logic, off the popover.
//
// The replace case is the one with teeth: a link written over a range that already
// holds one must replace it, since the `toggleMark` spelling of the same intent
// removes it instead (`visual/links.ts`) — on exactly the selection a writer
// reached the prompt from.
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { blockSchema } from '$lib/core/codec';
import { clearLink, hrefInSelection, normalizeHref, setLink } from '$lib/visual/links';

const n = blockSchema.nodes;
const link = (href: string) => blockSchema.marks.link.create({ href });

/** A one-paragraph doc from `[text, href?]` runs, and a selection over all of it. */
function para(...runs: [string, string?][]): EditorState {
	const doc: PMNode = n.doc.create(
		null,
		n.paragraph.create(
			null,
			runs.map(([text, href]) => blockSchema.text(text, href ? [link(href)] : undefined))
		)
	);
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, 1, doc.content.size - 1)
	});
}

/** Run `cmd`; the new state, or null when it declined. */
function run(state: EditorState, cmd: Command): EditorState | null {
	let out: EditorState | null = null;
	const handled = cmd(state, (tr) => {
		out = state.apply(tr);
	});
	return handled ? out : null;
}

/** The paragraph's runs as `[text, href]`, `undefined` where the run is unlinked. */
function runsOf(state: EditorState): [string, string | undefined][] {
	const out: [string, string | undefined][] = [];
	state.doc.child(0).forEach((child) => {
		const mark = child.marks.find((m) => m.type.name === 'link');
		out.push([child.text ?? '', mark?.attrs.href as string | undefined]);
	});
	return out;
}

describe('normalizeHref', () => {
	it('makes a bare host absolute, which is what it means', () => {
		expect(normalizeHref('example.com')).toBe('https://example.com');
		expect(normalizeHref('example.com/a/b?q=1#f')).toBe('https://example.com/a/b?q=1#f');
	});

	it('leaves a scheme the link mark renders', () => {
		for (const href of ['https://x.com', 'http://x.com', 'mailto:a@x.com', 'tel:+1', 'ftp://x'])
			expect(normalizeHref(href)).toBe(href);
	});

	it('refuses a scheme the mark would draw inert, which is nothing to apply', () => {
		// `setLink` declines an empty href, so the refusal lands at the prompt's own
		// exit rather than storing a link that renders as plain text.
		for (const href of [
			'javascript:alert(1)',
			'JavaScript:alert(1)',
			'  javascript:alert(1)  ',
			'java\tscript:alert(1)',
			'data:text/html,<script>alert(1)</script>',
			'vbscript:msgbox(1)',
			'blob:https://x.com/uuid'
		])
			expect(normalizeHref(href)).toBe('');
	});

	it('leaves the spellings that ask for the embedding page', () => {
		for (const href of ['/a/b', '#anchor', '?q=1', '//cdn.x.com/a']) {
			expect(normalizeHref(href)).toBe(href);
		}
	});

	it('keeps a host that carries a port, which spells a scheme and is not one', () => {
		// `localhost:5173` is the likeliest link anyone writes against this editor, and
		// `SCHEME` reads its host as the scheme: what follows the colon is a port.
		expect(normalizeHref('localhost:5173')).toBe('https://localhost:5173');
		expect(normalizeHref('example.com:8080/x?q=1')).toBe('https://example.com:8080/x?q=1');
		// The same host without a port, and as a bare IP, take the same prefix.
		expect(normalizeHref('example.com')).toBe('https://example.com');
		expect(normalizeHref('127.0.0.1:8000')).toBe('https://127.0.0.1:8000');
	});

	it('reads a bare address as mail, not as a host with userinfo', () => {
		expect(normalizeHref('jane@example.com')).toBe('mailto:jane@example.com');
	});

	it('trims, and a blank value is nothing to apply', () => {
		expect(normalizeHref('  example.com  ')).toBe('https://example.com');
		expect(normalizeHref('   ')).toBe('');
	});
});

describe('hrefInSelection', () => {
	it('reports the href the selection carries', () => {
		expect(hrefInSelection(para(['linked', 'https://x.com']))).toBe('https://x.com');
	});

	it('takes the FIRST of several, which is the one value the prompt holds', () => {
		expect(hrefInSelection(para(['a', 'https://one.com'], ['b', 'https://two.com']))).toBe(
			'https://one.com'
		);
	});
});

describe('setLink', () => {
	it('adds a link over an unlinked selection, and REPLACES the href one already carries', () => {
		expect(runsOf(run(para(['text']), setLink('https://x.com'))!)).toEqual([
			['text', 'https://x.com']
		]);
		const next = run(para(['text', 'https://old.com']), setLink('https://new.com'));
		expect(runsOf(next!)).toEqual([['text', 'https://new.com']]);
	});

	it('writes one href over a selection spanning several', () => {
		const next = run(
			para(['a', 'https://one.com'], ['b', 'https://two.com']),
			setLink('https://both.com')
		);
		expect(runsOf(next!)).toEqual([['ab', 'https://both.com']]);
	});

	it('declines a blank href and an empty selection', () => {
		expect(run(para(['text']), setLink(''))).toBe(null);
		const collapsed = EditorState.create({
			doc: para(['text']).doc,
			selection: TextSelection.create(para(['text']).doc, 2)
		});
		expect(run(collapsed, setLink('https://x.com'))).toBe(null);
	});
});

describe('clearLink', () => {
	it('drops the link and keeps the text', () => {
		const next = run(para(['text', 'https://x.com']), clearLink);
		expect(runsOf(next!)).toEqual([['text', undefined]]);
	});

	it('declines where there is no link to drop', () => {
		expect(run(para(['text']), clearLink)).toBe(null);
	});
});
