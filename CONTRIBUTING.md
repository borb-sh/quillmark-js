# Contributing

## Questions, bugs, and ideas

- A bug: an issue naming the package and its version, with the smallest steps that reproduce it.
- A change larger than a fix: open an issue before the pull request, so its shape is agreed before it is built. Quillmark's [stability statement](https://github.com/borb-sh/quillmark#status) says what a release can change.
- A bug in rendering, parsing or a `Quill.yaml` rule: an issue on [borb-sh/quillmark](https://github.com/borb-sh/quillmark/issues/new/choose), which owns the engine these packages wrap.

## Pull requests

The [development commands](README.md#development) are in the README. A pull request passes `npm run gate`, which CI runs with `check:pack`. A change to a published package keeps the rules in its `prose/INVARIANTS.md` and adds an entry under `## Unreleased` in its `CHANGELOG.md`. [`CLAUDE.md`](CLAUDE.md) binds human contributors and AI agents alike. An AI-assisted pull request is welcome on the same terms as any other: its author has run the gate, can explain each change, and answers review.

## License

A contribution is licensed under the Apache License 2.0 in [`LICENSE`](LICENSE), as its section 5 provides, with no further terms and no separate agreement to sign. The font files `@quillmark/fonts` bundles keep their upstream licenses, and a font file contributed to it comes under its own.
