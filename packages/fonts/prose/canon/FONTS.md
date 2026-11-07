# Fonts

> **Implementation**: `files/` · `manifest.json` · `src/`

## TL;DR

`@quillmark/fonts` is the default host font library for every Quillmark client: a fixed set of openly licensed families, and a loader that answers them as `new Engine({ fonts })` takes them. Its promise is to stored documents. A `font_family` mark saves a family name, and any host that loads the suite sets that name the same way, so a document written in studio prints the same in an app, in the gate and in a third-party client. The engine, `@quillmark/quiver` and `App.yaml` know nothing of it.

## The suite

The roster is `manifest.json`: each family's name, optional label, licence, upstream source, and per face its weight, style, file and hashes. Its family names are the package's public contract.

What earns a family a place: metric compatibility with the Office fonts people paste from, so line breaks survive a move out of Word (Times New Roman, Arial, Courier New, Cambria, Georgia, Century Schoolbook), plus Typst's default text face, a display face, a UI sans and a code monospace. Each ships regular, italic, bold and bold italic where the design has them.

**Family names are the engine's.** A family is listed under the name Typst reads from the face, which is the name a document saves and the name an upstream copy of the face is found by in any other client. Where that name reads badly, the manifest gives a `label` for pickers; a label is display only and can change in any version.

**Subset to Latin.** Each file holds the Latin range Google Fonts serves as `latin`, with every layout feature and name record kept, which cuts the suite to a fraction of the full files. A character outside the subset falls back to the surrounding font.

**Every licence must let a subset keep its name.** A subset is a modified version, so a family ships only under a licence that allows redistribution, PDF embedding and subsetting under the family's own name. An OFL family that reserves the name it ships under is therefore out. The admitted licences are OFL 1.1, the GUST Font License and the Bitstream Vera licence, and `check:fonts` holds each family to one.

Left out on purpose: Carlito and the Source families, whose licences reserve the names they ship under; Noto CJK, at tens of MB a weight; and New Computer Modern, whose academic look Libertinus already covers.

## Package shape

- **`files/`**: one subset TTF or OTF a face, named after a hash of its outlines, and each family's licence text beside its files.
- **The main entry**: `loadSuite(): Promise<Uint8Array[]>` fetches every face through `new URL(file, import.meta.url)`, which Vite and webpack emit as hashed static assets with no plugin. `src/suite.ts` is written from the manifest, one literal a face, since a bundler emits an asset only for a literal it can read.
- **`/node`**: the same loader reading the files off disk, for a test, a server render or a gate, mirroring `@quillmark/quiver`'s browser and `/node` split.
- **`FAMILIES`** and **`LABELS`** from both entries.

A client writes `new Engine({ fonts: [...(await loadSuite()), ...extras] })` and hands the editor `engine.fontFaces(quill)` and `LABELS`.

## Rules

A family name in the suite is a promise to every document that uses it, so the package changes only in ways that keep an old document rendering the same.

- **Append-only within a line.** A family is removed or renamed only in a breaking version. Adding one is not breaking.
- **Pinned bytes.** A face's file changes only in a breaking version, since new metrics or a new subset can reflow a stored document.
- **TTF/OTF only.** The engine refuses WOFF and WOFF2.
- **A check enforces it.** `check:fonts` (`scripts/check-fonts.mjs`) holds every file to its manifest hash, name and format, each family to an admitted licence with its text beside it, and `src/suite.ts` to the manifest. With `--published` at release, it also holds the family list and every face's bytes against the latest release unless the version breaks from it.

## Size and loading

The engine reads its whole library when it first loads a Typst backend, so the suite sits on the path to the first page and never to the form. A client starts `loadSuite()` at boot, beside the core and the quiver. One download serves both sides, since `engine.fontFaces` hands the editor the same bytes. With no WOFF2, a host serves the files with brotli; the immutable hashed names make a repeat visit free.

## Boundaries

The font library belongs to the client that builds the engine, never to the content it opens. The engine embeds no suite; a quiver carries none; a quill's own fonts set its plate and travel in its bundle; `App.yaml` names the app and nothing else. Studio, the app, the playground and `quillkit check` all build their engine over this suite, so the gate renders as the clients do.

**Extras are each host's own.** A host appends files after the suite, but a third-party client opening the same quiver does not get them, and a document using them falls back with a warning. The suite is the only portable promise.
