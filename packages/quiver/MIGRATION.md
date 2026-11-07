# Migrating `@quillmark/quiver`

Upgrade notes for the latest breaking range. The [CHANGELOG](CHANGELOG.md) is the full record, earlier ranges included; this page is the subset that breaks a working consumer, ordered by how late you find out.

## 0.38 → 0.39

### Rebuild every artifact

A built quiver is `quiver.json` beside one `<name>@<x.y.z>.<digest>.quill` bundle per quill, each carrying its quill's fonts; `fonts/` is gone, and `quiver.json` and `latest.json` state format 3. A format-2 artifact under 0.39 is refused as `quiver_invalid` naming the rebuild; a 0.39 artifact under an older reader is refused with the upgrade named. Re-run `build`; nothing in the source layout changes.

`quillkit` packs and reads with the `@quillmark/quiver` it carries, so a quillkit deploy moves to format 3 with the quillkit release that carries 0.39, and nothing in the collection pins this package.

A host rule naming `fonts/*` or `*.zip` under a built quiver names `*.quill` now. A server whose static handler types files by extension serves `.quill` as `application/vnd.quillmark.quill+zip` or `application/octet-stream`; the loader reads the bytes whatever the type.

### Runtime, not build time

**A quill whose tree holds a file name the `.quill` format refuses fails `build`**: one that holds `\`, `:` or NUL, which a filesystem on Linux or macOS allows. Rename the file.

**A bundle the `.quill` format refuses fails `getQuill` with the `QuillmarkError` `Quill.fromBundle` throws**, its diagnostic a `quill::bundle_*` code, where an over-budget or misnamed entry was a `QuiverError` coded `quiver_invalid`. Code that sorts a `getQuill` failure by `QuiverError.code` reads `diagnostics` off the error `isQuillmarkError` narrows. The `@quillmark/wasm` peer floor is `>=0.133.0-0`.
