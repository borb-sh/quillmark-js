import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// A library, not an app: `svelte-package` reads this for the preprocessor and the
// `src/lib` root, and there is no kit config because there are no routes. The
// playground is the app, one package over.
/** @type {import('@sveltejs/package').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	}
};

export default config;
