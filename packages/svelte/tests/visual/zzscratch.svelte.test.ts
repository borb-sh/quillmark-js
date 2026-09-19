// @vitest-environment jsdom
import { describe, it, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { mount, unmount, flushSync } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill } from '../helpers/fixtures.js';

await init();

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];
Element.prototype.animate ??= () => ({}) as Animation;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
Element.prototype.hasPointerCapture ??= () => false;

const OUT = '/tmp/claude-0/-home-user/db2599d8-995c-5342-b395-0e3966efe6bc/scratchpad/probe.json';
const log: unknown[] = [];

interface EditorRef {
	focusField(field: string): Promise<void>;
	setCaret(at: { field: string; pos?: number }): Promise<void>;
}

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
	writeFileSync(OUT, JSON.stringify(log, null, 1));
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const errors: { code: string; path?: string }[] = [];
	const app = mount(VisualEditor, {
		target,
		props: { doc, quill: q, onError: (e: { code: string; path?: string }) => errors.push(e) }
	}) as unknown as EditorRef;
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return { target, editor: app, errors };
}

const where = () => {
	const a = document.activeElement as HTMLElement | null;
	return a ? `${a.tagName}#${a.id || '-'}` : 'null';
};

const realFocus = HTMLElement.prototype.focus;
function traceFocus(): string[] {
	const trace: string[] = [];
	HTMLElement.prototype.focus = function (this: HTMLElement, ...args: unknown[]) {
		const stack = (new Error().stack ?? '')
			.split('\n')
			.slice(1, 8)
			.map((l) => l.trim().replace(/.*\/src\/lib\//, 'lib/').replace(/\?.*$/, ''))
			.join(' | ');
		trace.push(`${this.tagName}#${this.id || '-'} <= ${stack}`);
		return realFocus.apply(this, args as []);
	};
	return trace;
}
function untrace(): void {
	HTMLElement.prototype.focus = realFocus;
}

describe('scratch', () => {
	it('A undrawn variant world cell', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const { target, editor, errors } = mountEditor(q, doc);
		await editor.focusField('main.tracking_id');
		const before = where();
		const trace = traceFocus();
		await editor.focusField('main.distribution.license');
		untrace();
		log.push({
			tag: 'A main.distribution.license (world=internal, no cells drawn)',
			before,
			after: where(),
			errors,
			trace,
			drawnCells: [...target.querySelectorAll('[data-qm-prop]')]
				.map((n) => (n as HTMLElement).dataset.qmProp)
				.filter((k) => k === 'license' || k === 'lift_on')
		});
	});

	it('B undeclared step reports', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const { editor, errors } = mountEditor(q, doc);
		await editor.focusField('main.distribution.zzz');
		log.push({ tag: 'B main.distribution.zzz', after: where(), errors });
	});

	it('C handling world cell, handling unset', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const { editor, errors } = mountEditor(q, doc);
		await editor.focusField('main.tracking_id');
		const before = where();
		const trace = traceFocus();
		await editor.setCaret({ field: 'main.handling.reviews[0].finding', pos: 2 });
		untrace();
		log.push({
			tag: 'C main.handling.reviews[0].finding',
			before,
			after: where(),
			errors,
			trace
		});
	});
});
