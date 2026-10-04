import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		// A static SPA: `+layout.ts` already sets ssr=false/prerender=false, so the
		// fallback below is the whole app — no per-route prerender, no server.
		adapter: adapter({ fallback: 'index.html' }),
		// Root-relative by default (empty base). A project-subpath host — the
		// GitHub Pages project site at `borb-sh.github.io/quillmark-js` — sets
		// BASE_PATH=/quillmark-js at build time (the Pages workflow feeds it
		// from `configure-pages`) so assets and links resolve under the subpath.
		// Dev and `preview` leave it unset and stay at root.
		paths: {
			base: process.env.BASE_PATH ?? ''
		}
	}
};

export default config;
