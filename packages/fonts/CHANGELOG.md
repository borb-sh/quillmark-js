# Changelog

`@quillmark/fonts`. An entry is written into `## Unreleased` by the change that earns it; a release promotes that body to its own version section.

## Unreleased

**Breaking: Spectral SC leaves the suite, and JetBrains Mono and TeXGyreSchola join it.** JetBrains Mono is a code monospace beside Cousine's Courier metrics; TeXGyreSchola matches Century Schoolbook's metrics and shows as "Schola". A run set in Spectral SC falls back to the surrounding font with a `typst::unknown_font_family` warning; a quill that wants it bundles its own copy. A family now leaves the suite, and a face's bytes change, only in a breaking version: a minor while the major is 0, a major after.

## v0.1.0 - 2026-10-29

**The suite: TeXGyreTermes, Arimo, Cousine, Caladea, Gelasio, Libertinus Serif, Spectral SC, Cinzel, DejaVu Sans and Inter**, each in regular, italic, bold and bold italic (Cinzel in regular and bold), subset to Latin, under OFL 1.1, the GUST Font License or the Bitstream Vera licence. `loadSuite()` answers the thirty-eight files as `new Engine({ fonts })` takes them, fetched beside the module from the main entry and read off disk from `/node`. `FAMILIES` names the ten, `LABELS` the name a picker shows for one whose own reads badly (TeXGyreTermes as Termes), and `manifest.json` each face's file, hash, licence and upstream source.
