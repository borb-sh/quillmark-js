# Fonts

> **Implementation**: `files/` · `manifest.json` · `src/`

## TL;DR

`@quillmark/fonts` is the default host font library for every Quillmark client: a fixed set of openly licensed families, and a loader that answers them as `new Engine({ fonts })` takes them. Its promise is to stored documents. A `font_family` mark saves a family name, and any host that loads the suite sets that name the same way, so a document written in studio prints the same in an app, in the gate and in a third-party client. The engine, `@quillmark/quiver` and `App.yaml` know nothing of it: the suite is the value a client passes to the engine, and the faces the engine lists from it are what the editor's `fonts` prop takes.

## The suite

Five families, each in regular, italic, bold and bold italic, every one under OFL 1.1, which allows redistribution in an app and embedding in a PDF. The first three match the metrics of the Office fonts people paste from, so line breaks survive a move out of Word.

| Family | Role |
| --- | --- |
| Tinos | Times New Roman metrics |
| Arimo | Arial and Helvetica metrics |
| Cousine | Courier New metrics |
| Caladea | Cambria metrics |
| Libertinus Serif | Typst's default text face |

**Subset to Latin.** Each file holds the Latin range Google Fonts serves as `latin`, every layout feature and every name record kept, which brings the suite to about 1 MB where the full files are near 8 MB. A character outside the subset falls back to the surrounding font.

**No reserved font names.** OFL counts a subset as a Modified Version, and a Modified Version may not use a Reserved Font Name. A family whose licence reserves its own name could ship only whole or renamed, and a renamed family breaks the promise, so the suite holds none: Carlito (Calibri metrics) reserves "Carlito", and Source Serif 4 and Source Sans 3 reserve "Source". Noto CJK is tens of MB a weight, and New Computer Modern is under the GUST licence, with Libertinus covering the academic look.

## Package shape

- **`files/`**: one subset TTF a face, named `<Family>-<Style>.<sha256:16>.ttf`, and each family's licence text as `<Family>-OFL.txt`, which OFL requires beside the files.
- **`manifest.json`**: per family, its name, licence id, licence file and upstream source at a commit; per face, its CSS weight and style, its file and sha256, and the upstream file and sha256 it was subset from. The list of family names is the package's public contract.
- **The main entry**: `loadSuite(): Promise<Uint8Array[]>` fetches every face through `new URL(file, import.meta.url)`, which Vite and webpack 5 emit as hashed static assets with no plugin. The hashed names make every visit after the first a cache hit.
- **`/node`**: the same loader reading the files off disk, for a test, a server render or a gate. It mirrors `@quillmark/quiver`'s split between a browser-pure entry and a `/node` one, and neither imports the other.
- **`FAMILIES`**: the family names, from both entries.

`src/suite.ts` is written from the manifest, one `new URL` literal a face, since a bundler emits an asset only for a literal it can read. A client writes `new Engine({ fonts: [...(await loadSuite()), ...extras] })` and hands the editor `engine.fontFaces(quill)`.

## Rules

A family name in the suite is a promise to every document that uses it, so the package changes only in ways that keep an old document rendering the same.

- **Append-only.** A family is never removed or renamed. Removing one sets every run that names it in the surrounding font, with a `typst::unknown_font_family` warning.
- **Pinned bytes.** A face's file changes only in a major version, since new metrics or a new subset can reflow a stored document. Adding a family is a minor version.
- **TTF/OTF only.** The engine's library refuses WOFF and WOFF2 (`engine::font_unsupported`), so the package never ships them.
- **A check enforces it.** `check:fonts` (`scripts/check-fonts.mjs`) holds every file to its manifest hash and its name, reads its format off its magic, holds each family's licence beside its files and `src/suite.ts` to the manifest. Run where a release is cut, with `--published`, it also holds the family list and every published face's bytes against the registry's latest release.

## Size and loading

The engine reads its whole library when it first loads a Typst backend and never grows it, so the suite sits on the path to the first page, and never to the form, which stands on the core alone. A client starts `loadSuite()` at boot, beside the core and the quiver, and builds its engine over it.

- **One download serves both sides.** `engine.fontFaces` hands the editor the same bytes for the browser's `FontFace`.
- **Served compressed.** With no WOFF2, a host serves the files with brotli, which roughly halves them; their immutable hashed names make a repeat visit free.
- **If first paint becomes the problem**, the follow-up is an engine change: take the family list up front and fetch a family's bytes when a document or the picker first names it.

## Boundaries

The font library belongs to the client that builds the engine, never to the content it opens.

| Piece | Role in fonts |
| --- | --- |
| quillmark engine | takes whatever library the host passes and embeds no suite |
| `@quillmark/quiver` | carries no `fonts/`, no `quiver.json` field, no format change |
| quill fonts | set the plate, ride inside each `.quill` bundle, never a writer's choice |
| `App.yaml` | names the app and nothing else |
| `@quillmark/svelte` | the editor's `fonts` prop takes the faces the engine lists |
| studio, the app, the playground | build the engine over `loadSuite()`; the playground under `?fonts` |
| `quillkit check` | renders over the `/node` suite, as the clients it gates do |
| quillmark CLI | renders with `--font`; parity with the browser is passing this package's files |

**Extras are each host's own.** A host appends files to the `fonts` array after the suite. A third-party client opening the same quiver does not get them, and a document using them falls back with a warning, so the suite is the only portable promise. A quillkit project-level `fonts/` folder, read as `app.css` is and served to studio and the app alike, waits for a request.

## Not

Not a font picker: the editor draws one over the faces it is handed. Not a quill's fonts: those set a plate and travel in its bundle. Not a CDN: the files ride with the client that bundles them.

## Links

- [`@quillmark/svelte` HOSTING.md](../../../svelte/prose/canon/HOSTING.md): the library arriving behind the editor.
- [quillkit QUILLKIT.md](../../../quillkit/prose/canon/QUILLKIT.md): the one pin the gate and the clients share.
