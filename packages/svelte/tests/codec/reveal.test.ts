// @vitest-environment jsdom
// A flagged reveal keeps the caret clear of the block-axis `scroll-padding` a host declares on a
// scrollport, on top of the leaf's own clearance, since PM's reveal walks the ancestors by hand.
import { describe, it, expect } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { revealProps } from '$lib/core/codec/reveal.js';

function nest(): { pane: HTMLElement; dom: HTMLElement } {
	const pane = document.createElement('div');
	const dom = document.createElement('div');
	pane.append(dom);
	document.body.append(pane);
	return { pane, dom };
}

describe('revealProps', () => {
	it('adds the scrollport padding to the clearance on each reveal', () => {
		const { pane, dom } = nest();
		const props = revealProps(20);
		const reveal = (): boolean => props.handleScrollToSelection({ dom } as unknown as EditorView);
		expect(reveal()).toBe(false);
		expect(props.scrollMargin.bottom).toBe(20);

		pane.style.scrollPaddingBottom = '240px';
		pane.style.scrollPaddingTop = '12px';
		reveal();
		expect(props.scrollMargin.bottom).toBe(260);
		expect(props.scrollThreshold.bottom).toBe(260);
		expect(props.scrollMargin.top).toBe(32);
		expect(props.scrollMargin.left).toBe(20);

		pane.style.scrollPaddingBottom = '';
		reveal();
		expect(props.scrollMargin.bottom).toBe(20);
		pane.remove();
	});

	it("keeps PM's defaults where the clearance is unmeasured", () => {
		const { pane, dom } = nest();
		const props = revealProps(undefined);
		props.handleScrollToSelection({ dom } as unknown as EditorView);
		expect(props.scrollMargin.bottom).toBe(5);
		expect(props.scrollThreshold.bottom).toBe(0);
		pane.remove();
	});
});
