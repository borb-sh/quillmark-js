# @quillmark/fonts

The font suite every Quillmark client hands its engine: openly licensed families a stored document can name and find again in any client that loads the suite.

| Family           | Role                                          |
| ---------------- | --------------------------------------------- |
| TeXGyreTermes    | Times New Roman metrics, shown as "Termes"    |
| Arimo            | Arial and Helvetica metrics                   |
| Cousine          | Courier New metrics                           |
| Caladea          | Cambria metrics                               |
| Gelasio          | Georgia metrics                               |
| Libertinus Serif | Typst's default text face                     |
| Cinzel           | inscriptional capitals                        |
| DejaVu Sans      | wide humanist sans                            |
| Inter            | screen-first UI sans                          |
| JetBrains Mono   | code monospace                                |
| TeXGyreSchola    | Century Schoolbook metrics, shown as "Schola" |

Each in regular, italic, bold and bold italic (Cinzel, drawn in capitals, in regular and bold), subset to Latin, about 2.6 MB in all. A character outside the subset falls back to the surrounding font.

## Install

```bash
npm install @quillmark/fonts @quillmark/wasm
```

## Building an engine over the suite

```ts
import { loadSuite } from '@quillmark/fonts';
import { Engine } from '@quillmark/wasm';

const engine = new Engine({ fonts: await loadSuite() });
```

`loadSuite()` answers every face's file, as `fonts` takes them. The main entry fetches each one beside the module through `new URL(file, import.meta.url)`, which Vite and webpack 5 emit as a hashed asset with no plugin; under Node, import it from `@quillmark/fonts/node`, which reads the same files off disk. Vite's dev server pre-bundles dependencies away from the files beside them, so exclude the package there, as `@quillmark/wasm` is excluded:

```ts
export default defineConfig({ optimizeDeps: { exclude: ['@quillmark/wasm', '@quillmark/fonts'] } });
```

The engine reads its library when it first loads a Typst backend, so the suite is on the path to the first page. Start `loadSuite()` at boot, beside `init()` and the quiver, rather than when the first page is asked for. Serve the files with brotli: the engine reads TTF and OTF only, so there is no WOFF2 to fall back on.

A host's own fonts go after the suite:

```ts
const engine = new Engine({ fonts: [...(await loadSuite()), ...extras] });
```

A third-party client opening the same documents does not have those, and a run set in one falls back with a warning there. The suite is the only portable promise.

## The editor

`@quillmark/svelte`'s `VisualEditor` takes the faces the engine lists, which are the suite's bytes, so one download serves both sides. `LABELS` is the name its picker shows for a family whose own name reads badly; the mark saves the family:

```svelte
<script lang="ts">
	import { LABELS } from '@quillmark/fonts';

	let fonts = $state<FontFace[]>([]);
	engine.fontFaces(quill).then((faces) => (fonts = faces));
</script>

<VisualEditor {doc} {quill} {fonts} fontLabels={LABELS} />
```

## Rendering with the CLI

`quillmark render` takes the same library through `--font`, once a file. Pass this package's files to render a document as a browser client does:

```bash
quillmark render ./my-quill doc.md $(for f in node_modules/@quillmark/fonts/files/*.[ot]tf; do echo --font "$f"; done)
```

## What a version promises

A family name is a promise to every document that sets text in it, so the suite only grows. A family is never removed or renamed. A face's file changes only in a major version, since new metrics can reflow a stored document; a new family is a minor one. `FAMILIES` names the suite's families, `LABELS` the display names, which can change in any version, and `manifest.json` (importable as `@quillmark/fonts/manifest.json`) each face's weight, style, file and sha256.

## Licences and provenance

The package's code is Apache-2.0. Every font file is a subset of an upstream release, its licence text beside it as `files/<Family>-<Licence>.txt`: the SIL Open Font License 1.1 for eight families, the GUST Font License (LPPL 1.3c) for TeXGyreTermes and TeXGyreSchola, and the Bitstream Vera licence for DejaVu Sans. Each lets a subset keep its family's name. The names are trademarks of their holders, used here to name their fonts.

`manifest.json` records each family's upstream source, a repository at a commit or a release archive, and each face's upstream file and its sha256. Each file was cut from that upstream file with fontTools 4.68.0, DejaVu Sans's regular face with `--drop-tables+=MATH` as well:

```bash
pyftsubset <upstream file> \
  --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" \
  --layout-features='*' --name-IDs='*' --name-languages='*' --notdef-outline
```

The design, the rules and what was left out are in [FONTS.md](prose/canon/FONTS.md).
