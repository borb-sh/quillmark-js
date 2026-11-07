# @quillmark/fonts invariants

The rules a change to `@quillmark/fonts` must keep, the reason behind each, and the designs already weighed and rejected. What the package exports and how a client loads it is the [README](../README.md); the roster is `manifest.json`. A rule belongs here only if a capable reader of the code would plausibly break it, and a change that breaks one updates this page in the same commit, with the new reason.

## The promise

**The suite's promise is to stored documents.** A `font_family` mark saves a family name, and every host that loads the suite sets that name the same way, so a document written in studio prints the same in an app, in the gate and in a third-party client. Every rule below keeps an old document rendering the same.

**Family names are the engine's.** A family is listed under the name Typst reads from the face, which is the name a document saves and the name an upstream copy of the face answers to in any other client. Where that name reads badly, the manifest gives a `label`; a label is display only and can change in any version.

## The suite

**What earns a family a place** is metric compatibility with the Office fonts people paste from, so line breaks survive a move out of Word, plus Typst's default text face, a display face, a UI sans and a code monospace. A family ships each of regular, italic, bold and bold italic its design has.

**Subset to Latin, every layout feature and name record kept.** A character outside the subset falls back to the surrounding font. Rejected: full files, which multiply the suite's weight for scripts few documents use.

**Every licence must let a subset keep its name.** A subset is a modified version, so a family ships only under a licence that allows redistribution, PDF embedding and subsetting under the family's own name. The admitted licences are OFL 1.1, the GUST Font License and the Bitstream Vera licence; an OFL family that reserves the name it ships under is out.

Left out on purpose: Carlito and the Source families, whose licences reserve the names they ship under; Noto CJK, at tens of MB a weight; and New Computer Modern, whose academic look Libertinus already covers.

## Rules

- **Append-only within a line.** A family is removed or renamed only in a breaking version; adding one is not breaking.
- **Pinned bytes.** A face's file changes only in a breaking version, since new metrics or a new subset can reflow a stored document.
- **TTF/OTF only.** The engine refuses WOFF and WOFF2, so a host serves the files with brotli instead.
- **A literal per face.** `src/suite.ts` is written from the manifest, one `new URL(file, import.meta.url)` a face, since a bundler emits an asset only for a literal it can read.

`check:fonts` (`scripts/check-fonts.mjs`) holds every rule it can, and its header lists them.

## Where the library belongs

**The font library belongs to the client that builds the engine, never to the content it opens.** The engine embeds no suite, a quiver carries none, a quill's own fonts set its plate and travel in its bundle, and `App.yaml` names the app and nothing else. Studio, the app, the playground and `quillkit check` all build their engine over this suite, so the gate renders as the clients do.

**The suite sits on the path to the first page, never to the form.** The engine reads its whole library when it first loads a Typst backend, so a client starts `loadSuite()` at boot beside the core and the quiver, and the form mounts without waiting on it.

**Extras are each host's own.** A host appends files after the suite, but a third-party client opening the same quiver does not get them, and a document using them falls back with a warning. The suite is the only portable promise.
