/**
 * The dithered photo, adapted from BB's photo wallpaper (MIT), itself from Aura's renderer (MIT); see NOTICE.
 * Aura's look as BB ships it: an 8x8 Bayer pattern, four brightness steps, the photo's own colors, 2 CSS px
 * cells, a half-resolution framebuffer capped at 1920 x 1080 worth of pixels, 30 fps, a slow threshold wave.
 * Otto draws straight into the one canvas (BB keeps a 2D copy for its cross-fade between wallpapers; Otto has
 * one photo per theme). Paused while the tab is hidden; one still frame under `prefers-reduced-motion`. Without
 * WebGL2, or when the context is lost, the canvas stays empty and the plain photo under it shows.
 */

import { ANIMATED_PHOTO_SHADER, VERTEX_SHADER } from './photo-shaders'

export function animatePhoto(canvas: HTMLCanvasElement, image: HTMLImageElement): () => void {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
  })
  if (!gl) return () => {}
  let disposed = false
  let lost = false
  let raf = 0
  let previous = 0
  let lastDraw = 0
  let time = 40
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const shaders: WebGLShader[] = []
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let texture: WebGLTexture | null = null
  const uniforms = new Map<string, WebGLUniformLocation | null>()
  const uniform = (name: string) => {
    if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(program!, name))
    return uniforms.get(name)!
  }

  function release() {
    if (texture) gl!.deleteTexture(texture)
    if (buffer) gl!.deleteBuffer(buffer)
    if (program) gl!.deleteProgram(program)
    shaders.forEach((shader) => gl!.deleteShader(shader))
    gl!.getExtension('WEBGL_lose_context')?.loseContext()
  }

  try {
    program = gl.createProgram()
    buffer = gl.createBuffer()
    texture = gl.createTexture()
    if (!program || !buffer || !texture) throw new Error('WebGL allocation failed')
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX_SHADER],
      [gl.FRAGMENT_SHADER, ANIMATED_PHOTO_SHADER],
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Shader allocation failed')
      shaders.push(shader)
      gl.shaderSource(
        shader,
        precision && precision.precision < 23 ? source.replace(/precision mediump float/g, 'precision highp float') : source,
      )
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Photo shader compilation failed')
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Photo shader link failed')
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    for (const [key, value] of Object.entries({
      u_originX: 0.5,
      u_originY: 0.5,
      u_worldWidth: 0,
      u_worldHeight: 0,
      u_fit: 2,
      u_scale: 1,
      u_rotation: 0,
      u_offsetX: 0,
      u_offsetY: 0,
      u_type: 4,
      u_pxSize: 2,
      u_colorSteps: 4,
    }))
      gl.uniform1f(uniform(key), value)
    gl.uniform1i(uniform('u_originalColors'), 1)
    gl.uniform1i(uniform('u_inverted'), 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.uniform1i(uniform('u_image'), 0)
    gl.uniform1f(uniform('u_imageAspectRatio'), image.naturalWidth / image.naturalHeight)
  } catch {
    release()
    return () => {}
  }

  function draw() {
    if (disposed || lost) return
    gl!.uniform1f(uniform('u_time'), time)
    gl!.clear(gl!.COLOR_BUFFER_BIT)
    gl!.drawArrays(gl!.TRIANGLES, 0, 6)
  }

  function resize() {
    if (disposed || lost) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return
    // Half the CSS size, and never more than 1920 x 1080 worth of pixels (whatever the device pixel ratio).
    const scale = Math.min(0.5, Math.sqrt(2073600 / (width * height)))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    gl!.viewport(0, 0, w, h)
    gl!.uniform2f(uniform('u_resolution'), w, h)
    gl!.uniform1f(uniform('u_pixelRatio'), w / width)
    draw()
  }

  function tick(now: number) {
    raf = 0
    if (disposed || lost || document.hidden || reduced.matches) return
    if (previous) time += Math.min(now - previous, 1000 / 15) * 0.0005
    previous = now
    if (now - lastDraw >= 1000 / 30) {
      draw()
      lastDraw = now
    }
    raf = requestAnimationFrame(tick)
  }

  function schedule() {
    cancelAnimationFrame(raf)
    raf = 0
    previous = 0
    if (disposed || lost || document.hidden) return
    draw()
    if (!reduced.matches) raf = requestAnimationFrame(tick)
  }

  function onLost(event: Event) {
    event.preventDefault()
    lost = true
    cancelAnimationFrame(raf)
    raf = 0
  }

  canvas.addEventListener('webglcontextlost', onLost)
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  document.addEventListener('visibilitychange', schedule)
  reduced.addEventListener('change', schedule)
  resize()
  schedule()
  return () => {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(raf)
    observer.disconnect()
    document.removeEventListener('visibilitychange', schedule)
    reduced.removeEventListener('change', schedule)
    canvas.removeEventListener('webglcontextlost', onLost)
    release()
  }
}
