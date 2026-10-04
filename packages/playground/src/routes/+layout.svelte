<!--
  The playground shell: the host-side stylesheets and the running head every route
  is reached from. All three are global imports, so the shared chrome reaches every
  route's markup rather than being scoped out of it. `@quillmark/svelte/preset` is
  the endorsed look, and the same import a third-party consumer makes, so the
  playground draws with the endorsed version by construction; `playground.css` is
  the front page's own rungs on top of it, and `chrome.css` the recipes that read
  both. Nothing here mounts, loads, or frees a session: the routes own that.
-->
<script lang="ts">
	import '@quillmark/svelte/preset';
	import './playground.css';
	import './chrome.css';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const ROUTES = [
		{ path: '/', label: 'Overview' },
		{ path: '/playground', label: 'Playground' }
	];

	// The path with the deploy's base prefix removed: a project-subpath host
	// (`/quillmark-js`) leaves the root as the bare base, so the empty
	// remainder is `/`.
	const here = $derived(page.url.pathname.slice(base.length) || '/');
	// The tool route is a workspace, not a page: it takes the viewport less the
	// head and scrolls inside itself, so the shell holds the head and hands it the
	// rest. At every width: a narrow viewport stacks the panes into a column that
	// scrolls where it sits, and the document still has nowhere to go.
	const fills = $derived(here === '/playground');
</script>

<div class={['app', { 'qm-workspace': fills }]}>
	<header class="head">
		<div class="pg-width qm-bar head-row">
			<a class="mark" href="{base}/">quillmark<span class="slash">/</span>playground</a>
			<nav class="nav" aria-label="Playground">
				{#each ROUTES as route (route.path)}
					<a
						href="{base}{route.path}"
						class="nav-link"
						aria-current={here === route.path ? 'page' : undefined}>{route.label}</a
					>
				{/each}
			</nav>
		</div>
	</header>

	{@render children()}
</div>

<style>
	/* No box of its own on a page route: a page's bands sit in the document's flow, so
	   the sticky head sticks to the viewport rather than to a wrapper. The tool route
	   takes `.qm-workspace` instead, at every width and not only the ones that fit two
	   panes: a narrow viewport is where a document scroll is easiest to reach, and the
	   room the stacked panes want comes from a scroller inside the route. */
	.app:not(.qm-workspace) {
		display: contents;
	}

	/* A running head, sticky so the switch between surfaces is always one click
	   away; one hairline under it, no fill. */
	.head {
		position: sticky;
		top: 0;
		z-index: 1;
		background: var(--qmh-page);
		border-bottom: var(--qmh-border-width) solid var(--qmh-border);
	}

	/* How deep the band stands is the site's, not the shell's: this is a page's running
	   head above a reading column, so it takes the page's rhythm rather than a tool's. */
	.head-row {
		padding-block: var(--qmh-space-3);
	}

	/* The site's name, in the chrome face so it takes no more room than the nav beside
	   it, and holding the head's start so the nav reads off the end. Lowercase: it is a
	   link into a site, and the run reads as the path it is. */
	.mark {
		font-family: var(--qmh-font-mono);
		font-size: var(--qmh-text-label);
		font-weight: var(--qmh-weight-mid);
		line-height: var(--qmh-leading-tight);
		color: var(--qmh-ink);
		text-decoration: none;
		margin-inline-end: auto;
	}

	.slash {
		color: var(--qmh-ink-meta);
	}

	.nav {
		display: flex;
		gap: var(--qmh-space-4);
	}

	/* The current route takes a rule under it, not a fill. */
	.nav-link {
		font-family: var(--qmh-font-mono);
		font-size: var(--qmh-text-label);
		line-height: var(--qmh-leading-tight);
		color: var(--qmh-ink-meta);
		text-decoration: none;
		padding-block: var(--qmh-space-half);
		border-bottom: var(--qmh-ring-width) solid transparent;
		transition: color var(--qmh-duration) var(--qmh-ease-reverse);
	}

	.nav-link:hover {
		color: var(--qmh-ink);
	}

	.nav-link[aria-current='page'] {
		color: var(--qmh-ink);
		border-bottom-color: var(--qmh-ink);
	}
</style>
