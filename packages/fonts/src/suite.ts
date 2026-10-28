// Written from `manifest.json` by `npm run check:fonts -- --write`, which fails while the two
// disagree.

/** The suite's families, in the manifest's order. */
export const FAMILIES = ['Tinos', 'Arimo', 'Cousine', 'Caladea', 'Libertinus Serif'] as const;

/** Every face's file, in the manifest's order: one literal each, so a bundler emits each as
 *  an asset. */
export const FILES: readonly URL[] = [
	new URL('../files/Tinos-Regular.ed6a7e887c55c70c.ttf', import.meta.url),
	new URL('../files/Tinos-Italic.f8149c62e5e63f8e.ttf', import.meta.url),
	new URL('../files/Tinos-Bold.79806bc27f1d34c4.ttf', import.meta.url),
	new URL('../files/Tinos-BoldItalic.554796f371159c0c.ttf', import.meta.url),
	new URL('../files/Arimo-Regular.34a961de9f3789b9.ttf', import.meta.url),
	new URL('../files/Arimo-Italic.33d051fe4b0c4440.ttf', import.meta.url),
	new URL('../files/Arimo-Bold.18743596edea4da2.ttf', import.meta.url),
	new URL('../files/Arimo-BoldItalic.c38d12f284cc360d.ttf', import.meta.url),
	new URL('../files/Cousine-Regular.550ad969668e3be8.ttf', import.meta.url),
	new URL('../files/Cousine-Italic.b6716e135f85f4df.ttf', import.meta.url),
	new URL('../files/Cousine-Bold.094a6e10f6f5e4c8.ttf', import.meta.url),
	new URL('../files/Cousine-BoldItalic.7899671373af94fe.ttf', import.meta.url),
	new URL('../files/Caladea-Regular.055303caa316a701.ttf', import.meta.url),
	new URL('../files/Caladea-Italic.3b23d582fecfe1c4.ttf', import.meta.url),
	new URL('../files/Caladea-Bold.999d49902c9c6080.ttf', import.meta.url),
	new URL('../files/Caladea-BoldItalic.fcf50540430660d6.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-Regular.441c8e6ec20b46bb.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-Italic.ecd29061b8cb8e80.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-Bold.0f044667fa361be1.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-BoldItalic.3fad1372216d19f2.ttf', import.meta.url)
];
