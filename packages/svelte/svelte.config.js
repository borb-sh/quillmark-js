// A library, not an app: there are no routes, so there is no kit config, and the
// playground is the app one package over. `svelte-check` and the Vitest `svelte()`
// plugin read the compiler options here.
/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
const config = {
	compilerOptions: {
		runes: true
	}
};

export default config;
