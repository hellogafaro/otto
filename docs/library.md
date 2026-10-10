# Library

`@otto/library` is the single backend owner of Files, Documents, Collections and
Folders. Editable documents and immutable saved file bytes remain distinct item
types, not separate domains. Existing SQL tables, identifiers, API resource paths,
native actions, accepted Run snapshots and saved bytes do not change.

The `/library` page replaces separate Files and Documents navigation. Compact
tabs select All, Documents, Images, Video, Audio or Other; Documents contains
editable documents and document-format uploads. Filtering happens before bounded
pagination and preserves each item's existing authorization. Folders remain
navigable within type views. Root browsing covers authorized top-level items
across Projects unless explicitly filtered; a folder fixes its Project scope.
The list remains grouped by kind, with sorting within each kind.

Creation, editing, uploads, downloads, folder placement, collection membership,
archive rules and frozen public shares retain their existing guarantees. See
[File and Folder semantics](files.md) for byte limits and storage boundaries.
Old page links redirect to the canonical Library routes rather than leaving a
second list implementation.
