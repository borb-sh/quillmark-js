# Changelog

`@quillmark/comments`. An entry is written into `## Unreleased` by the change that earns it; a release promotes that body to its own version section.

## Unreleased

**Comment threads over a document's anchors.** A `CommentThread` is the thread's messages, status and selector, keyed by the anchor's id, with `anchored` derived against the live document and never trusted from a store. `CommentStore` is the shape a host's persistence takes, and `MemoryCommentStore` the one a host with no database runs on, with a versioned `export` envelope. `createComments` keeps a synchronous index over the store, writes through it optimistically, and runs the reconcile flow every markdown write takes: `reviseDocument` reads the anchor contexts, writes, hands what the receipt dropped to `reattach` with the write's delta, and records what came back; `reconcile` is the flow over any receipt, a collab `RemoteChange` among them; `sync` derives attachment with no write, `refresh` stores a drifted quote, and `recover` places every stored selector on a document reopened from markdown.
