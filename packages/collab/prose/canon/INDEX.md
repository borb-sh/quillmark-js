# Quillmark Collab Canon Index

`@quillmark/collab` keeps one content field of a WASM `Document` equal to a shared Yjs state, so several Documents edited at once merge to one. It is a spike: one body field, no server, no presence. The transport is the host's: anything that carries Y updates between `Y.Doc`s.

## The Y shape

A field is one `Y.Text` and one `Y.Map` (`shape.ts`). The text holds the field's characters, each island slot as an embedded `Y.Map` of `id`, `type` and `props`. A formatting mark is an attribute on the characters it covers; an anchor has no Y form. Line `i ≥ 1` keeps its kind, containers and `continues` as separate attributes on the `\n` that opens it, so a concurrent kind change and container change both land; line 0's sit in the map.

Containers are stored by identity, never by position. A list item is `{ list, item, ordered, start, checked }` and a quote `{ id }`, each id minted by the client that opened it. The projection derives `ordinal` and `instance` from runs of ids, which is what keeps two items inserted into one list at once two items.

Island ids are client-unique. An island the store minted positionally (`isl-0`) takes a minted id when it is written, and the Document takes it back.

## The two directions

**Y → Document** (`project.ts`) is a pure function of the Y state, and a remote transaction lands as `doc.reviseContent` with its result, which carries the Document's own anchors through the change since the projection holds none; an engine without `reviseContent` takes `overwrite`, which drops them. The host's `onRemote` gets the Y change's own delta in USV, which places a character typed into a run of the same character where it was typed, where a diff of the two values cannot. A table slot that a merge left sharing its line is the one state no `Content` holds; the projection splits the line around it and the binding writes the split back. The fuzz suite counts how often that happens.

**Document → Y** (`write.ts`) diffs: after a local commit `push` writes one text splice and then only the attributes that differ. Containers are reassigned their old identities wherever their run survived the edit (`assignIds`), so the codec restating every line's containers with renumbered ordinals writes nothing for the lines that did not move.

`seedUpdate` writes a starting `Content` from a fixed client id with deterministic ids, so clients that each seed one document apply identical bytes and hold one copy.

## Not yet

Anchors are kept on the client that made them and are not shared. The writer still diffs, so a local edit inside a run of one character can land in Y at the other end of the run. Fields other than the main body, cards, scalars, arrays and `$ext` have no Y form. A table's props are one last-writer-wins value. There is no persistence, no server, and no remote caret.
