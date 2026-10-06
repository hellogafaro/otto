# Library (plan, not built)

One domain, `library`, for everything saved: uploads, chat attachments, what agents make, and markdown documents. A document is a file with a markdown mime type; the editor is a UI on top of it. Nothing else about documents differs.

## Data

`library_items`: `id` (`createId()`), `title`, `type` (`file`, `document`, `folder`), `parentId`, `mime`, `size`, `origin` (`upload`, `chat`, `agent`), `createdBy`, `createdAt`, `updatedAt`.

- Folders are rows in the same table (nested, depth-limited as in Otto v1).
- Chat attachments become items with `origin = chat`, shown under "From chats", not in the root.
- Deleting a chat does not delete its items; deleting an item removes its bytes.

## Bytes

A small `FileStore` (put, get as a stream, delete, signed URL) keyed by the item id. Default driver writes to disk under the workspace. An S3 or Garage driver can follow later without touching the domain. Agents read and edit files by path through their normal tools (disk driver).

## Upload and edit

- Streamed, authenticated HTTP upload; no base64 over the WebSocket. 50 MB per file.
- Images are resized for the model APIs; PDF and Office files get a markdown copy and a thumbnail (post-upload steps).
- Saving a document replaces the file (temp file, then rename) and bumps `updatedAt`. A save made against an older `updatedAt` is refused.

## Later: enrichment

A cheaper model adds a short description and extracted text (OCR, transcript) to each item so search finds files by what they contain. It runs as a background job after an upload and again after every update, overwrites the previous result, and feeds the same full-text index as the file's own text. Off by default per workspace, because it sends file content to a model provider; each item shows pending, done or skipped.
