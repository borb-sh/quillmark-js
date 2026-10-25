# App

> **Implementation**: `app/`

## TL;DR

The client a quiver's readers reach: someone with a form to fill in, who has never heard of a quill. One form beside the page it prints, a Download PDF press, and the documents they have started kept in their browser. `quillkit build app` lays it over a packed quiver with the `app.json` that says which quills it opens (QUILLKIT §"The app target"); this doc is the client itself.

Studio is for the quiver's authors and shows the quiver; the app is for its readers and shows a form ([STUDIO.md](STUDIO.md)). Both are one session under two surfaces in the preset's shell, and the bridge between the surfaces is the same, so the difference is everything around it: **nothing on the app names a quill, a ref, a version, a file or a line.** A reader can act on none of them.

## Boot

`app.json` is fetched `no-cache` against `document.baseURI`, so an app serves from wherever it is put, and it says three things about the page before anything mounts: the tab's title, its icon, and the author's `app.css`, linked after the client's own sheets so a rule of equal rank is the author's. The mount waits on that sheet, so the first paint is the author's look rather than the client's with the author's arriving over it; a sheet that will not load settles the wait anyway, and the app stands in its own look.

Then the core wasm, the quiver (`fromBuiltUrl` on `quiver/`), and the store. The form mounts on the core alone; the render wasm is the engine's, loaded by the first `engine.open`, so the page follows the form rather than holding it back. A boot that fails says "This app can't load right now." and puts what failed in the console, where whoever can fix it looks.

## The first screen

**One quill opens its form; several open a choice.** A reader with one form to fill in is owed that form, so an app pinning one quill opens a blank document on it. Over several, the landing is one card per quill: its title, which is the main card's `title` in the schema or else its name made readable, and its `description`, under the app's own description. A press starts a blank document on that quill.

**A reload reopens what was open.** The store records which document was on screen, so a reader who closes the tab mid-form comes back to it rather than to the landing. "New" in My documents is the way back to the first screen.

**The head is the app's name and two presses.** My documents opens the drawer; Download PDF, drawn as `.qm-app-primary`, is the one primary action. The footer names the Quillmark release the client bundles, linking to Quillmark, which is the one place the app says what it is made of.

**On a phone, one track at a time.** Under the preset's threshold the split shows one track and the switch above it says which, Form or Page. A press on the page lands the caret in the form and brings the form up, which is the bridge's reveal (STUDIO §"A client, and what serves it").

## Documents

**A document is kept from its first edit.** A blank form a reader looked at and left leaves nothing behind. From the first edit it is saved after each settled burst of keystrokes, and when the tab is hidden or closed mid-burst, so nothing typed is lost to a debounce.

**What is kept is markdown.** A record is `{ v, id, title, quill, edited, markdown }`: the canonical markdown, the canonical ref it was made on, and when. Markdown for the reason studio's import door takes it (STUDIO §"The document has doors"): it reads as a file, it re-conforms on the way in, and it rides no coupling to the wasm's storage DTO. `v` is the record's shape, and a later release reading an earlier one's records branches on it; the suite holds records as a shipped release wrote them (`app/__tests__/fixtures/`), and each must still open.

**IndexedDB, one database per app.** Keyed by the app's base URL, so two apps on one origin, a project page and its branch preview, never read each other's documents. A private window may refuse the store, and the app then works on the document in hand and says it keeps nothing.

**My documents is a drawer.** Each document is a row: its title and when it was last edited, a press to open it, its markdown as a download, and delete, which asks first. "New" and "Clear all" stand beside the list, and the drawer says "Saved in this browser only.", since a reader who expects an account is owed being told there is none.

**A document's title is read off its answers.** The first answered text field of the main card, a `title` or `subject` field before the others and the rest in the schema's order, on one line and at most 80 characters; where none is answered, the quill's own title. The title is what the drawer lists and what a download is named: the title with what no platform takes in a file name left out, then `.pdf` or `.md`.

## Download

**The file is the document in hand.** A press applies a keystroke still settling and waits on an open still in flight, then writes the PDF from the session the page is painted from (`session.render({ format: 'pdf' })`). A document that does not render is refused rather than written from the last good page, and the refusal says which: "Some answers need fixing before the page can update." where a diagnostic names a field, else "This form can't render right now." The same two lines stand over the page while it does not answer the form.

## Retired pins

A document records the ref it was made on and reopens on it, so a quiver that moved a quill to a new version does not move a reader's half-filled form under them. Each document's pin stands one of three ways against the build:

- **current**: the app opens it, and the document opens as it was left.
- **retired**: an earlier build shipped it and the pack still holds it (`app.json`'s `retired`, out of `app-lock.json`). The document opens on that version, with "This document uses an earlier version of this form." over it and an Update to the latest form press.
- **missing**: the pack no longer holds it. The document cannot open, so it stands as its record: Download .md, and Update to the latest form where the app opens that quill at all.

**An update offers the markdown first.** The move lands the document's markdown in the latest version, conforming as it does, and a schema that stopped asking for a field strands its answer. So the press opens a dialog whose first action is Download .md, and only then Update; the record keeps its id and takes the new pin, and what the move stranded is named on the fields it is about until the first edit.

## The chrome

The app is drawn with `@quillmark/svelte/preset`, the import a third-party consumer makes: the preset's shell (`.qm-workspace`, `.qm-bar`, `.qm-split`, `.qm-switch`) and its app chrome (`.qm-app-header`, `.qm-app-title`, `.qm-app-footer`, `.qm-app-primary`; THEMING §"The app chrome"). `chrome.css` adds two widths the preset does not carry, the drawer's and the narrowest a landing card reads at. Everything an author's `app.css` may aim at is THEMING §"What a stylesheet may aim at"; the client's own classes are not in it.

## Not

Not studio: no picker, no source panel, no examples toggle, nothing about the quill. Not an account: documents live in one browser, and leave it as files. Not offline: there is no service worker, and an app reached without a network does not load; what outlives the tab is the documents. Not promised over acroform quills: Typst plates are what it is built and checked over.

## Links

[QUILLKIT.md](QUILLKIT.md) · [STUDIO.md](STUDIO.md) · [`THEMING.md`](../../../svelte/THEMING.md) · [QUIVER.md](../../../quiver/prose/canon/QUIVER.md)
