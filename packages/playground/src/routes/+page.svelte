<!--
  The front page, one scroll in two parts: a first screen carrying the thesis and
  its two actions, and the quickstart under it, in two columns — the steps down the
  reading column, the surfaces they reach standing beside them
  (PLAYGROUND §"The routes").

  Two documents off one quill: one the preview's session paints, one the editor
  holds. No apply loop runs here, so a shared document would let typing in the
  editor desynchronize the page the band above it paints. `/playground` is where
  the two are wired together.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { Preview } from '@quillmark/svelte/preview';
	import type { Document, LiveSession, Quill } from '@quillmark/wasm';
	import type { Landing } from '@quillmark/svelte/core';
	import { loadFixtureTree, loadTemplate } from './fixture';
	import { INSTALL, OPEN_SESSION, PREVIEW, VISUAL } from './samples';

	type Status = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready' };
	type VisualEditorComponent = typeof import('@quillmark/svelte/visual').VisualEditor;

	let status = $state<Status>({ phase: 'loading' });
	let VisualEditor = $state<VisualEditorComponent | undefined>();
	let session = $state<LiveSession | undefined>();
	let quillHandle = $state<Quill | undefined>();
	let editDoc = $state<Document | undefined>();
	let lastHit = $state<Landing | undefined>();
	let toFree: Array<{ free(): void }> = [];

	onMount(() => {
		let cancelled = false;
		(async () => {
			// Handles created so far, newest first; freed in reverse creation order on
			// unmount-during-open and on a mid-chain failure (`engine.open` throwing
			// after `quill`/`doc` already exist).
			const created: Array<{ free(): void }> = [];
			try {
				// Dynamic: the WASM binary and VisualEditor's ProseMirror stack are the
				// route's heaviest payload and nothing before paint needs them. `init`
				// instantiates the core and resolves to `Quill`, which the artifact exports
				// nowhere statically; the fixture load awaits the same memoized gate to
				// materialize its quill.
				const [{ Engine }, { init }, visual] = await Promise.all([
					import('@quillmark/wasm'),
					import('@quillmark/svelte/core'),
					import('@quillmark/svelte/visual')
				]);
				const { Quill } = await init();
				const [tree, md] = await Promise.all([loadFixtureTree(), loadTemplate()]);
				const quill = Quill.fromTree(tree);
				created.unshift(quill);
				const open = (): Document => (md == null ? quill.seedDocument() : quill.parse(md));
				const previewDoc = open();
				created.unshift(previewDoc);
				const engine = new Engine();
				const openedSession = await engine.open(quill, previewDoc);
				created.unshift(openedSession);
				const doc = open();
				created.unshift(doc);
				if (cancelled) {
					for (const h of created) h.free();
					return;
				}
				toFree = created;
				VisualEditor = visual.VisualEditor;
				session = openedSession;
				quillHandle = quill;
				editDoc = doc;
				status = { phase: 'ready' };
			} catch (e) {
				for (const h of created) h.free();
				if (!cancelled)
					status = { phase: 'error', message: e instanceof Error ? e.message : String(e) };
			}
		})();
		return () => {
			cancelled = true;
			for (const h of toFree) h.free();
			toFree = [];
			VisualEditor = undefined;
			session = undefined;
			quillHandle = undefined;
			editDoc = undefined;
		};
	});
</script>

<svelte:head><title>quillmark — editor and live preview</title></svelte:head>

<main class="pg-width landing">
	<section class="hero">
		<h1>Editor + live preview for Quillmark</h1>
		<p class="lede">
			A visual editor for the document and a canvas preview of the compiled page, sharing one
			session. An edit repaints the page; a click on the page moves the caret.
		</p>
		<div class="actions">
			<a class="pg-cta" href="{base}/playground">Open the playground</a>
			<a class="pg-cta-quiet" href="#get-started">Get started</a>
			<a class="pg-link" href="https://github.com/borb-sh/quillmark-js">Source</a>
		</div>
	</section>

	<section id="get-started" class="tutorial band">
		<div class="split">
			<div class="col">
				<article class="step">
					<h2 class="qm-label">01 · Install</h2>
					<p>
						<code>@quillmark/svelte</code> provides the surfaces;
						<code>@quillmark/wasm</code> is the engine they read.
					</p>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre
						class="qm-readout sample"
						role="region"
						tabindex="0"
						aria-label="Code sample: Install">{INSTALL}</pre>
				</article>

				<article class="step">
					<h2 class="qm-label">02 · Session</h2>
					<p>
						A quill is a template's file tree; a document is the content in it. Opening the two
						compiles the first page and returns the session handle both surfaces read.
					</p>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre
						class="qm-readout sample"
						role="region"
						tabindex="0"
						aria-label="Code sample: Session">{OPEN_SESSION}</pre>
				</article>

				<article class="step">
					<h2 class="qm-label">03 · Preview</h2>
					<p>
						<code>&lt;Preview&gt;</code> paints the session's pages to canvas and resolves a click to
						the content under it, so the compiled page is addressable and not just displayed.
					</p>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre
						class="qm-readout sample"
						role="region"
						tabindex="0"
						aria-label="Code sample: Preview">{PREVIEW}</pre>
				</article>
			</div>

			<figure class="art">
				<!-- The boundary's phase, and only while there is one: at rest the painted page
				     says the session is open, and the step beside it says which surface painted
				     it. -->
				{#if status.phase === 'loading'}
					<p data-testid="status" class="qm-status phase">Opening the reference quill…</p>
				{:else if status.phase === 'error'}
					<p data-testid="status" class="qm-status qm-status-error phase">
						Error: {status.message}
					</p>
				{/if}
				<div class="qm-frame demo-frame">
					{#if session}
						<Preview {session} margin={0} onPick={(at) => (lastHit = at)} />
					{/if}
				</div>
				<!-- The click round-trip: the one claim in the column beside this that no sample
				     can show. -->
				<figcaption class="caption">
					<span class="qm-label">Pick</span>
					<span class="qm-readout" data-testid="demo-hit">
						{lastHit
							? `${lastHit.field}${lastHit.pos == null ? '' : ` @ ${lastHit.pos}`}`
							: 'click anywhere on the page'}
					</span>
				</figcaption>
			</figure>
		</div>

		<div class="split band">
			<div class="col">
				<article class="step">
					<h2 class="qm-label">04 · Edit</h2>
					<p>
						<code>&lt;VisualEditor&gt;</code> builds its controls from the quill's schema: a prose
						editor for a prose field, a control for a value field, a card per block.
						<code>onChange</code> fires when an edit lands; applying it to the session returns the pages
						the preview repaints.
					</p>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<pre
						class="qm-readout sample"
						role="region"
						tabindex="0"
						aria-label="Code sample: Edit">{VISUAL}</pre>
				</article>
			</div>

			<div class="art">
				<div class="qm-frame demo-frame">
					{#if VisualEditor && editDoc && quillHandle}
						<VisualEditor class="qm-pane" doc={editDoc} quill={quillHandle} />
					{/if}
				</div>
			</div>
		</div>

		<article class="step closing band">
			<h2 class="qm-label">Next</h2>
			<p>
				Both surfaces on one session, with the caret bridged in both directions:
				<a class="pg-link" href="{base}/playground">the playground</a>.
			</p>
		</article>
	</section>
</main>

<style>
	/* Nothing above the first screen: it centres in what the head leaves, and a pad over
	   it would push that centring down. */
	.landing {
		display: flex;
		flex-direction: column;
		gap: var(--pg-space-8);
		padding-block-end: var(--pg-space-16);
	}

	/* The first screen: a thesis, two actions, no mount (PLAYGROUND §"Two jobs on one
	   page"). It takes the small viewport less the running head, so everything else is
	   under the fold and mobile chrome expanding cannot push the actions off the screen
	   they are the point of. Centred there and held to the
	   measure at the page's start edge, which is the column every step below reads down:
	   the scroll to the quickstart runs down one column rather than across the page. */
	.hero {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: var(--qmh-space-4);
		min-height: calc(100svh - var(--pg-head));
		max-width: var(--qmh-measure);
	}

	/* The site's one display run, and the only route that draws one: the thesis a
	   stranger lands on. Fluid, off the rung minted in `playground.css`, because it is
	   the one size on the page big enough for the viewport to matter to it. */
	h1 {
		margin: 0;
		font-size: var(--pg-text-display);
		font-weight: var(--qmh-weight-strong);
		line-height: var(--qmh-leading-tight);
		letter-spacing: var(--pg-track-display);
		text-wrap: balance;
	}

	.lede {
		margin: 0;
		color: var(--qmh-ink-meta);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--qmh-space-4);
		margin-top: var(--qmh-space-2);
	}

	/* ── The quickstart ─────────────────────────────────────────────────────── */
	/* What the first screen's second action scrolls to: bands down the page, each a
	   reading column and the surface its steps mount. The margin clears the running
	   head, which sits over whatever a jump lands on; the motion is the document's
	   (`chrome.css`). */
	.tutorial {
		display: flex;
		flex-direction: column;
		gap: var(--pg-space-8);
		scroll-margin-top: var(--pg-head);
	}

	/* The two columns: the reading column at its measure, and what is left of the page
	   for the surface those steps mount. What stands beside a surface is every step that
	   reaches it (install, session and preview in one band, edit in the next), so the
	   split runs per band rather than per step, and a step with no output of its own
	   spends no width on one. */
	.split {
		display: grid;
		grid-template-columns: minmax(0, var(--qmh-measure)) minmax(0, 1fr);
		column-gap: var(--pg-space-8);
		align-items: start;
	}

	/* A hairline over each band marks a handover: the quickstart's says the first screen
	   has ended, an inner band's that one surface has given way to the next. Nothing
	   under the last, so the page ends at the final band rather than at a closing rule. */
	.band {
		border-top: var(--qmh-border-width) solid var(--qmh-border);
		padding-top: var(--pg-space-8);
	}

	/* The step that mounts nothing: it closes the page under both columns rather than
	   under one, which is also where a stacked split puts it. The rule runs the page's
	   width like the bands' above; the passage wraps at the measure. */
	.closing > p {
		max-width: var(--qmh-measure);
	}

	.col {
		display: flex;
		flex-direction: column;
		gap: var(--pg-space-8);
		min-width: 0;
	}

	.step {
		display: flex;
		flex-direction: column;
		gap: var(--qmh-space-3);
	}

	.step p {
		margin: 0;
	}

	code {
		font-family: var(--qmh-font-mono);
		font-size: var(--qmh-text-label);
	}

	/* Code keeps its own line breaks and scrolls sideways rather than wrapping: a
	   wrapped line reads as two statements, and the column it sits in is the measure,
	   which is the width the samples are cut to. Stacked, the column is narrower than the
	   cut, so each block is a scroller a keyboard reaches only through the `tabindex` and
	   name it carries. */
	.sample {
		white-space: pre;
		word-break: normal;
		overflow-x: auto;
	}

	/* A mounted surface, and nothing named over it: the step beside it sets the
	   component in the same run, and a caption would be that name a second time.
	   `figure`'s margins go, since the column places it.

	   Sticky inside its band, because the steps beside it outrun it: the reading column
	   is half again the surface's height, so a step describing the preview would be read
	   with the preview already scrolled off. The offset is the head's band, the rung the
	   scroll margin above reads too. */
	.art {
		position: sticky;
		top: var(--pg-head);
		display: flex;
		flex-direction: column;
		gap: var(--qmh-space-2);
		margin: 0;
		min-width: 0;
	}

	/* `.art` spaces its own children, so the paragraph's margin would double the gap. */
	.phase {
		margin: 0;
	}

	/* A demo frame states a height and nothing else. The gutter, the tone and the desk
	   are the surface's own (THEMING §"Drop it in"), so a frame stating them would
	   duplicate the package. */
	.demo-frame {
		height: var(--pg-demo);
		min-width: 0;
	}

	.caption {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--qmh-space-2);
		margin: 0;
	}

	.caption .qm-readout {
		color: var(--qmh-ink-meta);
	}

	/* Below the width that holds a measure and a surface beside it, the split stacks
	   and a surface follows the steps that mount it, which is the order the columns
	   already read in. */
	@media (width < 60rem) {
		.split {
			grid-template-columns: minmax(0, 1fr);
			row-gap: var(--pg-space-8);
		}

		/* Stacked, the surface already follows the steps that mount it, so there is
		   nothing for it to keep up with. */
		.art {
			position: static;
		}
	}
</style>
