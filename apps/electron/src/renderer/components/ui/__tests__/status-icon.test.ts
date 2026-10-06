import { describe, expect, it } from 'bun:test'
import { resolveDataUrlIcon } from '@/lib/icon-cache'

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`
const base64 = (s: string) => `data:image/svg+xml;base64,${btoa(s)}`

describe('resolveDataUrlIcon', () => {
  it('an SVG that uses currentColor is colorable and keeps sanitized raw SVG', () => {
    const icon = resolveDataUrlIcon(base64(svg('<circle r="4" fill="currentColor" onclick="x()"/>')))
    expect(icon.kind).toBe('file')
    expect(icon.colorable).toBe(true)
    expect(icon.rawSvg).toContain('currentColor')
    expect(icon.rawSvg).not.toContain('onclick')
  })

  it('decodes a percent-encoded SVG', () => {
    const icon = resolveDataUrlIcon(`data:image/svg+xml,${encodeURIComponent(svg('<path stroke="currentColor"/>'))}`)
    expect(icon.colorable).toBe(true)
  })

  it('an SVG with fixed colors is not colorable', () => {
    const icon = resolveDataUrlIcon(base64(svg('<circle r="4" fill="#f00"/>')))
    expect(icon.colorable).toBe(false)
    expect(icon.rawSvg).toBeUndefined()
  })

  it('a raster image data URL is a plain file icon', () => {
    expect(resolveDataUrlIcon('data:image/png;base64,iVBORw0KGgo=')).toEqual({
      kind: 'file',
      value: 'data:image/png;base64,iVBORw0KGgo=',
      colorable: false,
    })
  })
})
