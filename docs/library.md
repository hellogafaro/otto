# Library

One domain, `library`, for everything saved: uploads, chat attachments, what agents make, and markdown documents. A document is a file with a markdown mime type; the editor is a UI on top of it. Nothing else about documents differs.

## Built

- The domain (`packages/shared/src/library`): plain functions that take the workspace id, `createLibraryItem`, `createLibraryFolder`, `getLibraryItem(s)`, `getLibraryFolderPath`, `readLibraryContent` / `readLibraryText`, `updateLibraryItem`, `deleteLibraryItem`, and failures thrown with `domainError(code, message)` from `@otto/shared/utils` (`not_found`, `conflict`, `invalid`, `too_large`, `not_empty`), so the `code` reaches RPC callers (below).
- The disk `FileStore` (`<workspaceRoot>/library/<id>`, atomic writes, keys are ids only).
- RPCs `library:create`, `createFolder`, `list`, `get`, `read`, `update`, `delete` (content travels as `{ encoding, data }`: base64 for files, text for documents; 50 MB cap enforced on the decoded size). A handler that throws a `domainError` answers with its `code` (`conflict`, `not_found`, ...) as the response error code, so a client branches on `error.code === 'conflict'`; any other error is still `HANDLER_ERROR`.
- Chat attachments: `file:storeAttachment` saves the file (and an Office file's markdown copy) as ordinary library items in the root folder titled `CHAT_ATTACHMENTS_FOLDER_TITLE` ("Chat attachments", found or created per workspace on first use; a plain folder, no special column or type), and returns the item's path. The library does not know which chat an item came from, so deleting a chat keeps its items. Attachments of sessions made before this change stay where they are.
- The Library page and the document editor (`apps/electron/src/renderer/pages/library/`, DESIGN.md "Library"): one gallery with tabs, folders in `?folder=`, folder paths derived from the whole list, upload as base64, previews read through `library:read`, documents autosaved with `expectedUpdatedAt`.

Not built yet: streamed HTTP upload, enrichment, an S3 or Garage `FileStore` driver.

## Data

`library` (singular, the one exception to plural table names): `id` (`createId()`), `workspaceId`, `folderId`, `type` (`file`, `document`, `folder`), `title`, `mime`, `size`, `createdBy`, `createdAt`, `updatedAt`. Index on (`workspaceId`, `folderId`).

- Folders are rows in the same table (nested, at most 8 levels; a folder cannot move into itself or its own tree). `folderId` is null at the root.
- `type` is `document` when the mime is `text/markdown` or the name ends in `.md`, and is fixed when the item is created.
- `createdBy` is `'user:<userId>'` or `'agent:<id>'` (`'agent:default'` until agents are modeled), filled by the server from the connection; the bare `'user'` is refused. Chat attachments live in the Chat attachments folder.
- Deleting an item removes its bytes; a folder can only be deleted when empty.
- The bytes are not in the table.

## Bytes

A small `FileStore` (put, stage, get, open as a stream, delete) keyed by the item id. The default driver writes to disk under the workspace. An S3 or Garage driver can follow later without touching the domain. Agents read and edit files by path through their normal tools (disk driver); the prompt names the file by its title, the path is only the id.

## Upload and edit

- Today the renderer sends the file as base64 over the RPC, as chat attachments always did. Later: a streamed, authenticated HTTP upload, no base64 over the WebSocket. 50 MB per file.
- Images are resized for the model APIs and Office files get a markdown copy and a thumbnail when they are attached to a chat.
- Saving a document is two-phase and bumps `updatedAt`. A save that does not carry the current `updatedAt` as `expectedUpdatedAt` is refused with `conflict` and changes nothing. Otherwise: (1) `FileStore.stage` writes the new bytes beside the file (`<id>.tmp-<random>`); (2) the guarded row update (`WHERE id, workspaceId, updatedAt = expected`) runs, and exactly one of two racing saves gets through it; (3) only the winner commits (atomic rename over `<id>`). A lost guard or any failure discards the temp file, and the existing bytes are never touched; if the rename itself fails the row is put back, so the row and the bytes always come from the same save.

## Later: enrichment

A cheaper model adds a short description and extracted text (OCR, transcript) to each item so search finds files by what they contain. It runs as a background job after an upload and again after every update, overwrites the previous result, and feeds the same full-text index as the file's own text. Off by default per workspace, because it sends file content to a model provider; each item shows pending, done or skipped.
