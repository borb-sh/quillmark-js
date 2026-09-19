// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, unmount, flushSync, tick } from 'svelte';
import { init, type Document, type Quill } from '@quillmark/wasm';
import VisualEditor from '$lib/visual/VisualEditor.svelte';
import { quill, loadFixtureTree } from '../helpers/fixtures.js';
import { appendFileSync } from 'node:fs';
const LOG='/tmp/claude-0/-home-user/db2599d8-995c-5342-b395-0e3966efe6bc/scratchpad/probe.log';
const log=(...a:unknown[])=>appendFileSync(LOG, a.map((x)=>typeof x==='string'?x:JSON.stringify(x)).join(' ')+'\n');

const core = await init();

Element.prototype.scrollIntoView ??= () => {};
Element.prototype.getAnimations ??= () => [];
Element.prototype.animate ??= () => ({}) as Animation;
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function mountEditor(q: Quill, doc: Document) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const app = mount(VisualEditor, { target, props: { doc, quill: q } });
	flushSync();
	cleanup = () => {
		void unmount(app);
		target.remove();
	};
	return target;
}

const matrix = (target: HTMLElement): HTMLElement =>
	target.querySelector<HTMLElement>('.qm-matrix')!;
function member(target: HTMLElement, title: string): HTMLElement {
	const match = [...matrix(target).querySelectorAll<HTMLElement>('.qm-matrix-member')].find(
		(m) => m.querySelector('.qm-matrix-title')?.textContent?.trim() === title
	);
	if (!match) throw new Error(`no member ${title}`);
	return match;
}
const box = (target: HTMLElement, title: string): HTMLInputElement =>
	member(target, title).querySelector<HTMLInputElement>('input[type=checkbox]')!;
function toggle(el: HTMLInputElement, on: boolean): void {
	el.checked = on;
	el.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}
function column(target: HTMLElement, title: string, label: string): HTMLInputElement {
	const prop = [...member(target, title).querySelectorAll<HTMLElement>('.qm-object-prop')].find(
		(p) => p.querySelector('.qm-field-label span')?.textContent === label
	);
	const input = prop?.querySelector('input');
	if (!input) throw new Error(`no column ${label} under ${title}`);
	return input;
}
const stored = (doc: Document) => doc.getStored('qualifications') as Record<string, unknown>;
const count = (target: HTMLElement) =>
	matrix(target).querySelector('.qm-matrix-count')?.textContent;

describe('probe: rest forms', () => {
	it('resolve() shape for a matrix', () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('qualifications', { cyber_200: true, flight_cc: { year: 2001 } });
		const r = q.reader(doc).resolve();
		const row = r.main.fields.find((f: any) => f.field === 'qualifications');
		log('RESOLVED ROW', JSON.stringify(row, null, 1));
		log('STORED', JSON.stringify(doc.getStored('qualifications')));
	});

	it('stored false / string / array', async () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('qualifications', {
			flight_cc: false,
			dodin_ops: 'yes',
			cyber_200: ['a', 'b']
		});
		const target = mountEditor(q, doc);
		log('COUNT', count(target));
		log(
			'CHECKED',
			['Flight CC', 'DODIN Ops', 'Cyber 200', 'Cyber 300', 'Instructor'].map(
				(t) => `${t}=${box(target, t).checked}`
			)
		);
		// untick the string one
		toggle(box(target, 'DODIN Ops'), false);
		await tick();
		log('AFTER UNTICK dodin', JSON.stringify(stored(doc)));
		// edit a column under the array one
		type(column(target, 'Cyber 200', 'Year'), '2024');
		await tick();
		log('AFTER COLUMN EDIT cyber_200', JSON.stringify(stored(doc)));
	});

	it('stale member id in the document', async () => {
		const q = quill();
		const doc = q.seedDocument();
		q.writer(doc).set('qualifications', { ghost_x: { held: true, year: 1999 } });
		const target = mountEditor(q, doc);
		log('COUNT (stale)', count(target));
		toggle(box(target, 'Instructor'), true);
		await tick();
		log('AFTER TICK', JSON.stringify(stored(doc)));
		toggle(box(target, 'Instructor'), false);
		await tick();
		log('AFTER UNTICK', JSON.stringify(doc.getStored('qualifications')));
	});

	it('focus survives a tick commit', async () => {
		const q = quill();
		const doc = q.seedDocument();
		const target = mountEditor(q, doc);
		const b = box(target, 'Cyber 300');
		b.focus();
		expect(document.activeElement).toBe(b);
		toggle(b, true);
		await tick();
		flushSync();
		log(
			'ACTIVE AFTER TICK',
			(document.activeElement as HTMLElement)?.className,
			document.activeElement === box(target, 'Cyber 300')
		);
	});
});
