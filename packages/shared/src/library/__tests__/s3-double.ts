/**
 * A minimal in-process S3 server for tests: path-style `/<bucket>/<key>` with PUT, GET (and Range),
 * HEAD, DELETE and ListObjectsV2 (Bun's client writes a Uint8Array with one PUT, so no multipart).
 * Signatures are not verified; the access key id in the Authorization header is checked so a
 * test can tell that the configured credentials reach the server.
 */
export type S3Double = {
  url: string
  bucket: string
  accessKeyId: string
  objects: Map<string, { bytes: Uint8Array; etag: string }>
  /** Every request seen, as `METHOD key` (key empty for a bucket listing). */
  requests: string[]
  /** Return true to answer a request with a 500 instead of handling it. */
  fail: ((method: string, key: string) => boolean) | undefined
  stop(): void
}

const md5 = (bytes: Uint8Array) => new Bun.CryptoHasher('md5').update(bytes).digest('hex')
const xml = (body: string, status = 200) => new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { status, headers: { 'content-type': 'application/xml' } })
const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function startS3Double(options: { bucket?: string; accessKeyId?: string; pageSize?: number } = {}): S3Double {
  const bucket = options.bucket ?? 'otto-test'
  const accessKeyId = options.accessKeyId ?? 'test-access-key'
  const pageSize = options.pageSize ?? 1000
  const objects: S3Double['objects'] = new Map()
  const double: S3Double = { url: '', bucket, accessKeyId, objects, requests: [], fail: undefined, stop: () => server.stop(true) }

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const [, requestBucket, ...rest] = url.pathname.split('/')
      const key = decodeURIComponent(rest.join('/'))
      double.requests.push(`${req.method} ${key}`)
      if (requestBucket !== bucket) return xml('<Error><Code>NoSuchBucket</Code></Error>', 404)
      if (!req.headers.get('authorization')?.includes(`Credential=${accessKeyId}/`)) return xml('<Error><Code>InvalidAccessKeyId</Code></Error>', 403)
      if (double.fail?.(req.method, key)) return xml('<Error><Code>InternalError</Code></Error>', 500)

      const query = url.searchParams
      if (!key && req.method === 'GET') {
        const prefix = query.get('prefix') ?? ''
        const after = query.get('continuation-token') ?? query.get('start-after') ?? ''
        const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && k > after).sort()
        const page = keys.slice(0, Math.min(Number(query.get('max-keys') ?? 1000), pageSize))
        const truncated = page.length < keys.length
        const contents = page
          .map((k) => `<Contents><Key>${escapeXml(k)}</Key><Size>${objects.get(k)!.bytes.length}</Size><ETag>"${objects.get(k)!.etag}"</ETag><LastModified>2026-01-01T00:00:00.000Z</LastModified></Contents>`)
          .join('')
        const next = truncated ? `<NextContinuationToken>${escapeXml(page.at(-1)!)}</NextContinuationToken>` : ''
        return xml(`<ListBucketResult><Name>${bucket}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><IsTruncated>${truncated}</IsTruncated>${next}${contents}</ListBucketResult>`)
      }

      if (req.method === 'PUT') {
        const bytes = new Uint8Array(await req.arrayBuffer())
        const etag = md5(bytes)
        objects.set(key, { bytes, etag })
        return new Response(null, { headers: { etag: `"${etag}"` } })
      }
      if (req.method === 'DELETE') {
        objects.delete(key)
        return new Response(null, { status: 204 })
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const object = objects.get(key)
        if (!object) return xml('<Error><Code>NoSuchKey</Code></Error>', 404)
        const headers = { etag: `"${object.etag}"`, 'last-modified': 'Thu, 01 Jan 2026 00:00:00 GMT', 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream' }
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get('range') ?? '')
        if (range && req.method === 'GET') {
          const start = Number(range[1])
          const end = Math.min(range[2] ? Number(range[2]) : object.bytes.length - 1, object.bytes.length - 1)
          return new Response(object.bytes.slice(start, end + 1), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${object.bytes.length}` } })
        }
        // Bun.serve sets content-length for HEAD from the body it is given, so HEAD sends the size header explicitly.
        return req.method === 'HEAD'
          ? new Response(null, { headers: { ...headers, 'content-length': String(object.bytes.length) } })
          : new Response(object.bytes, { headers })
      }
      return new Response(null, { status: 405 })
    },
  })
  double.url = `http://127.0.0.1:${server.port}`
  return double
}
