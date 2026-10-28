// The teardown order every surface holds: unregister, cancel, then free. An order rather than a
// list, because work is deferred: freeing first leaves a scheduled continuation holding what nobody
// owns, and cancelling while still registered still takes the next event.
//
// A surface builds a `Lifespan`, registers its cancellers in the order they must run, and ends the
// span once; continuations that cross an await ask `resumes()` rather than a flag captured before
// it.

/** A surface's lifespan: alive from construction until {@link Lifespan.end}. */
export interface Lifespan {
	/** False once the span has ended. */
	readonly alive: boolean;
	/**
	 * Register work to undo at the end (a registry entry, a timer, a handle), run in registration
	 * order. On an ended span the canceller runs at once.
	 */
	onEnd(cancel: () => void): void;
	/**
	 * Await `pending`, then report whether the surface survived the window; `false` is a
	 * continuation to drop.
	 */
	resumes(pending: Promise<unknown>): Promise<boolean>;
	/** Run the cancellers once and end the span. Idempotent. */
	end(): void;
}

export function createLifespan(): Lifespan {
	let alive = true;
	const cancels: (() => void)[] = [];
	return {
		get alive() {
			return alive;
		},
		onEnd(cancel) {
			if (!alive) return void cancel();
			cancels.push(cancel);
		},
		async resumes(pending) {
			await pending;
			return alive;
		},
		end() {
			if (!alive) return;
			// Dead before the cancellers run: one may synchronously ask.
			alive = false;
			for (const cancel of cancels) cancel();
			cancels.length = 0;
		}
	};
}
