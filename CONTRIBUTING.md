# Contributing

## Questions, bugs, and ideas

- A bug: an issue naming the package and its version, with the smallest steps that reproduce it.
- A change larger than a fix: open an issue before the pull request. Before 1.0 most releases change the API, so agree on the shape before building it.
- A bug in rendering, parsing or a `Quill.yaml` rule: an issue on [borb-sh/quillmark](https://github.com/borb-sh/quillmark/issues/new/choose), which owns the engine these packages wrap.

## Pull requests

The [development commands](README.md#development) are in the README. `npm run gate` passes before a pull request is reviewed, and CI runs it with `check:pack`. A change to a package keeps the rules in its `prose/INVARIANTS.md`, and [`CLAUDE.md`](CLAUDE.md) binds human contributors as it binds the AI agents that write most of this repository: you ran the gate, you can explain each change, and you answer review yourself.

## License

A contribution is licensed under the Apache License 2.0 in [`LICENSE`](LICENSE), as its section 5 provides, with no further terms and no separate agreement to sign.
