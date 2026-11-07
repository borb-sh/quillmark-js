# Architecture

> **Implementation**: `src/lib/`

## TL;DR

`@quillmark/svelte` is two surfaces, the VisualEditor and the Preview, over a shared substrate: the `@quillmark/wasm` boundary, the content codec and the paint loop. `src/lib/` → `svelte-package` → `dist/` is the published tarball; the app that mounts it is a sibling package.

## Core vs chrome

Two layers, TS-first with no `.js`:

- **A vanilla TS core** with no UI framework: the WASM boundary, the codec and its ProseMirror integration, and the preview's paint loop. Its `.d.ts` depend on no framework.
- **Svelte chrome**: components for the card tree, the schema-driven controls and the floating surfaces, and `.svelte.ts` modules for shared reactive logic.

ProseMirror and canvas paint are framework-agnostic, so the core carries the substance and the chrome stays thin. A second binding would be a re-export of `/core`, not a rewrite.

The chrome is Svelte 5 throughout: every component compiles in runes mode, and where Svelte 5 names a successor to a Svelte 4 idiom, the code writes the successor. The compiler refuses half of the old forms; `check:svelte` refuses the rest as text, and its header lists them. The framework-free core is outside the rule and keeps its own listeners.

## Packaging

One package with subpath exports: `/core`, `/preview` and `/visual` ship, and `/preset` is the opt-in stylesheet. Subpaths rather than separate packages, because the one thing a split would buy (a preview-only consumer not pulling ProseMirror) is what separate module roots already give, and the surfaces share a substrate that co-evolves, so independent versions would be cost with no payer.

**A subpath is a promise**, so it carries a surface a consumer builds with, not a wrapper over one public call.

**`/core` declares what more than one surface speaks, and nothing more**: the address vocabulary (`DocPath`, `Place`, `Landing`) and the error channel (`EditorError`, `onError`). Declaring either per subpath would force an import across a boundary the package keeps closed, or a structural copy that drifts. The `@quillmark/wasm` API is not re-exported: package code and consumers import it from the peer directly, so every symbol has one import path (`check:deps`).

**`/preview` imports nothing editor-side.** Its audience (a viewer, a share page, a CI screenshot) is not editing, and bundle weight is what makes the subpath claim true. `check:deps` holds the edge. `publint` gates the exports map.

## Playground

`packages/playground` is the reference wiring for the glue the primitives push outward (the caret bridge, session open, diagnostics routing) and the manual harness for what unit tests cannot reach (canvas paint, DPR, the click round-trip). It consumes only the published subpaths, so a needed internal is an API gap to fix, and it stays a harness rather than a product. Its routes are [PLAYGROUND.md](../../../playground/prose/canon/PLAYGROUND.md).

Its `/playground` route is the reference split-pane shell. The bridge between the panes is consumer-layer glue: the editor emits places, the preview emits hits, and the shell joins them, so neither surface imports the other. Both hops are pass-throughs because the two surfaces share one address vocabulary from `/core`. The split, the frames and the bands are the preset's ([`THEMING.md`](../../THEMING.md) §"The shell").

## Styling

The package ships dense behaviour over a plain skin: monochrome and typographic, with hierarchy from size, tone and whitespace, so a consumer's override is the design rather than a fight with a decorated one. The chrome names everything at one weight and lets the size ramp rank; a second weight is reserved for a run where weight is the only signal it has.

Style lives in four places, and the split is what keeps each value single-sourced:

- **The derivation** (`core/theme.css`) is the only file that mints a value for the surfaces: the public `--qm-*` dials in, a closed private `--_qm-*` scale out. Every surface barrel imports it as a side effect and it applies to each `data-qm-root`. Every selector is wrapped in `:where()` with no layer, so consumer CSS outranks it without `!important` whatever order a bundler emits the sheets in.
- **The shared recipes** (`visual/controls.css`, `codec/prose.css`) are the rules more than one component draws, as classes a component opts into.
- **The preset** (`preset/`) is the same shape one level up and the only part a consumer imports by name: a `--qmh-*` scale for the host page derived from the same dials, recipes a host draws its own page with, the shell a host mounts surfaces in, and an app's chrome. The shell is CSS on the host's own elements, never a component, so the wiring stays the consumer's.
- **A component's scoped `<style>`** is everything else. The promised root classes (`.qm-editor`, `.qm-preview`, `.qm-pane`) are drawn `:global(:where(…))` so a consumer's bare class outranks them.

The rule across all of it: **a component reads a rung, it does not mint a value.** `check:style` holds it over the package and each app, and holds the zero rank on every class [`THEMING.md`](../../THEMING.md) promises. Which rung an element reads is the stylesheet's to state.

Light and dark is the host's declared `color-scheme`, read through `light-dark()`, so a colour pole states both arms. Motion durations are rungs too, so `prefers-reduced-motion` collapses the scale rather than a roster of selectors. A surface hidden by geometry is `inert`, not merely unpainted.

### A plane is a tone, not an outline

A surface in the flow is lifted off what it sits on by its fill, never by a line around it, and the raised plane is the brighter one in both schemes. A card is an island because the ground between cards is a tone step away, so where that reads too faint the fix is the derivation's, never a border.

Three kinds of stroke survive, each saying something a fill cannot:

- **A stroke that structures**: a section's vertical, a table's rules, an `hr`. Depth is a ladder of verticals one `--_qm-nest` apart, never a rule across the block, and a stroke is earned only by a block a reader can name.
- **A stroke on something floating**: a menu, a popover, the table island's alignment cluster, which have no plane under them to step off.
- **A stroke that is a state**: the dashed edge on a card the schema cannot project.

The public contract is [`THEMING.md`](../../THEMING.md): the dials and the mounted root classes. The interior DOM is deliberately not contract, so the surfaces can re-cut it.
