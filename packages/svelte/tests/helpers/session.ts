// jsdom stand-ins for what the preview reads off a compile and off the page: a session
// answering only geometry, an observer a test reports through, and a canvas context.
import type { ChangeSet, LiveSession } from '@quillmark/wasm';

/** A session stub answering the verbs the paint loop and the bridge call at build. */
export function mockSession(pageCount = 1): LiveSession {
	return {
		pageCount,
		pageSize: () => ({ widthPt: 612, heightPt: 792 }),
		paint: () => {},
		regions: () => [],
		fieldBoxes: () => [],
		positionAt: () => undefined,
		locate: () => undefined
	} as unknown as LiveSession;
}

/** A recompile that moved the page count and dirtied nothing. */
export const change = (pageCount: number): ChangeSet => ({ pageCount, dirtyPages: [] });

/** The paint loop learns visibility from its observer alone, so the last one built can
 *  play "scrolled into view" and "hidden" in turn. */
export class FakeIO {
	static last: FakeIO | undefined;
	targets: Element[] = [];
	constructor(private cb: IntersectionObserverCallback) {
		FakeIO.last = this;
	}
	observe(el: Element): void {
		this.targets.push(el);
	}
	unobserve(el: Element): void {
		this.targets = this.targets.filter((t) => t !== el);
	}
	disconnect(): void {
		this.targets = [];
	}
	/** Report every observed page at once, which is what a short document does. */
	report(isIntersecting: boolean): void {
		this.cb(
			this.targets.map((target) => ({ target, isIntersecting })) as IntersectionObserverEntry[],
			this as unknown as IntersectionObserver
		);
	}
}

/** Installs `FakeIO`, and a stub 2d context: jsdom's canvas has none, which the loop
 *  reads as a page it must not register, and the pixels are the mocked session's. */
export function stubPaintGlobals(): void {
	(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO;
	HTMLCanvasElement.prototype.getContext =
		(() => ({})) as unknown as HTMLCanvasElement['getContext'];
}
