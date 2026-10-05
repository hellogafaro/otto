import sharp from 'sharp'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// bun scripts/generate-brand-assets.ts
// Rebuilds every raster icon from design/brand/otto-app-icon.svg (colored app
// icon) and design/brand/otto-mark.svg (monochrome mark). Files keep their
// names, sizes and formats; run it again after changing either SVG.

const root = join(import.meta.dir, '..')
const brand = join(root, 'design/brand')
const resources = join(root, 'apps/electron/resources')
const webPublic = join(root, 'apps/webui/src/public')

const appIconSvg = readFileSync(join(brand, 'otto-app-icon.svg'))
const markSvg = readFileSync(join(brand, 'otto-mark.svg'), 'utf8')

// Vector-render the app icon once at 2048 (the svg is 1024 wide, so double the
// density), then lanczos-downscale to each size so every size shares one look.
const master = await sharp(appIconSvg, { density: 144 }).resize(2048, 2048).png().toBuffer()
const appIcon = (size: number) =>
  sharp(master).resize(size, size, { kernel: 'lanczos3' }).ensureAlpha().withMetadata({ density: 72 }).png({ compressionLevel: 9 }).toBuffer()

const write = (path: string, data: Buffer | string) => writeFileSync(path, data)

// ICO: a directory of PNG-compressed images.
async function ico(sizes: number[], render: (size: number) => Promise<Buffer> = appIcon) {
  const images = await Promise.all(sizes.map(render))
  const header = Buffer.alloc(6 + 16 * sizes.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = header.length
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(size === 256 ? 0 : size, entry)
    header.writeUInt8(size === 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(images[i].length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += images[i].length
  })
  return Buffer.concat([header, ...images])
}

// ICNS: PNG-compressed entries; the 2x types hold the doubled pixel size.
async function icns() {
  const types: [string, number][] = [
    ['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128],
    ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024],
  ]
  const chunks = await Promise.all(
    types.map(async ([type, size]) => {
      const png = await appIcon(size)
      const head = Buffer.alloc(8)
      head.write(type, 0, 'ascii')
      head.writeUInt32BE(png.length + 8, 4)
      return Buffer.concat([head, png])
    }),
  )
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([head, body])
}

// Electron: window and dock icon (Linux, dev), Windows and macOS bundles.
write(join(resources, 'icon.png'), await appIcon(512))
write(join(resources, 'source.png'), await appIcon(2048))
write(join(resources, 'icon.ico'), await ico([16, 24, 32, 48, 64, 128, 256]))
write(join(resources, 'icon.icns'), await icns())
copyFileSync(join(brand, 'otto-app-icon.svg'), join(resources, 'icon.svg'))
copyFileSync(join(brand, 'otto-app-icon.svg'), join(resources, 'tool-icons/otto.svg'))

// macOS 26 icon source: the white mark as the layer over the icon's base blue.
const layer = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><title>Otto</title><g transform="translate(176.64128 201.4184) scale(.96)" fill="#fff">${[...markSvg.matchAll(/<path d="[^"]+"\/>/g)].map((m) => m[0]).join('')}</g></svg>
`
write(join(resources, 'icon.icon/Assets/icon.svg'), layer)

// Web app: tab icon (the mark, black or white by color scheme), the ICO
// fallback, home-screen and manifest icons. The ICO is the mark alone in a
// neutral gray on transparent, so it reads on light and dark tab strips (the
// browser picks the SVG when it supports it, and the ICO otherwise).
const faviconPaths = [...markSvg.matchAll(/<path d="[^"]+"\/>/g)].map((m) => m[0]).join('')
const FAVICON_VIEWBOX = '-24 -49.5 747 747'
write(
  join(webPublic, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${FAVICON_VIEWBOX}"><title>Otto</title><style>path{fill:#000}@media(prefers-color-scheme:dark){path{fill:#fff}}</style>${faviconPaths}</svg>\n`,
)
const grayMaster = await sharp(
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048" viewBox="-8 -33.5 715 715" fill="#8a8a8e">${faviconPaths}</svg>`),
)
  .png()
  .toBuffer()
const grayMark = (size: number) =>
  sharp(grayMaster).resize(size, size, { kernel: 'lanczos3' }).ensureAlpha().png({ compressionLevel: 9 }).toBuffer()
write(join(webPublic, 'favicon.ico'), await ico([16, 32, 48], grayMark))
write(join(webPublic, 'apple-touch-icon.png'), await appIcon(180))
write(join(webPublic, 'icon-192.png'), await appIcon(192))
write(join(webPublic, 'icon-512.png'), await appIcon(512))

console.log('Brand assets generated')
