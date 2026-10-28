// Written from `manifest.json` by `npm run check:fonts -- --write`, which fails while the two
// disagree.

/** The suite's families, in the manifest's order. */
export const FAMILIES = [
	'TeXGyreTermes',
	'Arimo',
	'Cousine',
	'Caladea',
	'Gelasio',
	'Libertinus Serif',
	'Spectral SC',
	'Cinzel',
	'DejaVu Sans',
	'Inter'
] as const;

/** Every face's file, in the manifest's order: one literal each, so a bundler emits each as
 *  an asset. */
export const FILES: readonly URL[] = [
	new URL('../files/TeXGyreTermes-Regular.bb30035ec45d518e.otf', import.meta.url),
	new URL('../files/TeXGyreTermes-Italic.7ddc0ba237c4ade9.otf', import.meta.url),
	new URL('../files/TeXGyreTermes-Bold.4b540f231f155b6a.otf', import.meta.url),
	new URL('../files/TeXGyreTermes-BoldItalic.0dd9cbf614b20345.otf', import.meta.url),
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
	new URL('../files/Gelasio-Regular.d9e3ce4a4e5bc9ad.ttf', import.meta.url),
	new URL('../files/Gelasio-Italic.9ebec19f1fe980d4.ttf', import.meta.url),
	new URL('../files/Gelasio-Bold.4ff30fe8a1e373a4.ttf', import.meta.url),
	new URL('../files/Gelasio-BoldItalic.ce0ae207c41fb7c9.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-Regular.441c8e6ec20b46bb.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-Italic.ecd29061b8cb8e80.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-Bold.0f044667fa361be1.ttf', import.meta.url),
	new URL('../files/LibertinusSerif-BoldItalic.3fad1372216d19f2.ttf', import.meta.url),
	new URL('../files/SpectralSC-Regular.3ed045c7bfd712c5.ttf', import.meta.url),
	new URL('../files/SpectralSC-Italic.eae9c1c2b9644e15.ttf', import.meta.url),
	new URL('../files/SpectralSC-Bold.80ed8968332130bf.ttf', import.meta.url),
	new URL('../files/SpectralSC-BoldItalic.a0ab6e65964776ea.ttf', import.meta.url),
	new URL('../files/Cinzel-Regular.28b8df13a36735ea.ttf', import.meta.url),
	new URL('../files/Cinzel-Bold.0adc5e4ce481a8f7.ttf', import.meta.url),
	new URL('../files/DejaVuSans-Regular.c03d708cf15633b1.ttf', import.meta.url),
	new URL('../files/DejaVuSans-Italic.a894321c7636222e.ttf', import.meta.url),
	new URL('../files/DejaVuSans-Bold.97da797b1e619add.ttf', import.meta.url),
	new URL('../files/DejaVuSans-BoldItalic.eed68fec0687e70a.ttf', import.meta.url),
	new URL('../files/Inter-Regular.8dca5fc38e6dfa08.ttf', import.meta.url),
	new URL('../files/Inter-Italic.009a3b40d13a3847.ttf', import.meta.url),
	new URL('../files/Inter-Bold.c987a8bb69f6dff3.ttf', import.meta.url),
	new URL('../files/Inter-BoldItalic.1370c12fb1e5d2d9.ttf', import.meta.url)
];
