import sharp from 'sharp'

// bun scripts/compress-wallpaper.ts <photo.jpg> <out.avif>
// Dev only: turns an original photo into a Home wallpaper asset
// (apps/electron/src/renderer/assets/wallpaper/). 1920px wide is enough: the
// shader renders at half the window's CSS size, capped at 1920 x 1080. AVIF
// quality 50 keeps the grain and the stars, and the dither quantizes to four
// steps anyway. The originals are not committed.

const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('usage: bun scripts/compress-wallpaper.ts <photo> <out.avif>')
const info = await sharp(input)
  .rotate()
  .resize({ width: 1920, withoutEnlargement: true })
  .avif({ quality: 50, effort: 6 })
  .toFile(output)
console.log(`${output}: ${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB`)
