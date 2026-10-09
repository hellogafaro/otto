import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const fixtures = fileURLToPath(new URL('./', import.meta.url))
const out = process.env.TYPESET_PROOF_DIR
const baseline = process.env.TYPESET_BASELINE === '1'
if (out) mkdirSync(out, { recursive: true })
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({
  configFile: false, root: fixtures,
  cacheDir: resolve(out || resolve(process.env.HOME || root, '.capy/work/typeset-prose-proof'), 'vite-cache'),
  plugins: [{ name: 'typeset-prose-fixture', configureServer(instance) {
    instance.middlewares.use(async (req, res, next) => {
      if (req.url !== '/') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await instance.transformIndexHtml('/', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual Markdown Typeset fixture</title></head><body><div id="root"></div><script type="module" src="/typeset-prose.fixture.tsx"></script></body></html>'))
    })
  } }, react(), tailwind()],
  resolve: { alias: [
    { find: '@', replacement: resolve(root, 'apps/electron/src/renderer') },
    { find: 'react', replacement: resolve(root, 'node_modules/react') },
    { find: 'react-dom', replacement: resolve(root, 'node_modules/react-dom') },
  ], dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1100, height: 1050 } })
  const errors = []
  const failedRequests = []
  page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGE_ERROR', error.message) })
  page.on('requestfailed', (request) => failedRequests.push(request.url()))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const reply = page.getByRole('region', { name: 'Reply prose' })
  const document = page.getByRole('region', { name: 'Document prose' })
  const card = page.getByRole('region', { name: 'Request card' })
  await reply.getByRole('heading', { name: 'Readable project guidance' }).waitFor()
  await page.waitForFunction(() => document.querySelector('[aria-label="Reply prose"] .shiki') !== null)
  await page.evaluate(() => document.fonts.ready)
  const metrics = await page.evaluate(() => {
    const pick = (selector) => {
      const node = document.querySelector(selector)
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      return { family: style.fontFamily, size: style.fontSize, lineHeight: style.lineHeight, weight: style.fontWeight, marginTop: style.marginTop, width: rect.width }
    }
    return {
      paragraph: pick('[aria-label="Reply prose"] p'), heading: pick('[aria-label="Reply prose"] h1'),
      inlineCode: pick('[aria-label="Reply prose"] p code'),
      code: pick('[aria-label="Reply prose"] .shiki'),
      cardTitle: pick('[aria-label="Request card"] [data-slot="card-title"]'),
      cardStatus: pick('[aria-label="Request card"] [role="status"]'),
      button: pick('[aria-label="Request card"] button'),
      fonts: Array.from(document.fonts, (font) => ({ family: font.family, status: font.status })),
    }
  })
  if (out) {
    writeFileSync(resolve(out, `${baseline ? 'baseline' : 'final'}-metrics.json`), JSON.stringify(metrics, null, 2))
    await page.screenshot({ path: resolve(out, `${baseline ? 'baseline' : 'final'}-light-top.png`) })
  }
  console.log('METRICS', JSON.stringify(metrics))
  if (!baseline) {
    assert.equal(await reply.locator('.typeset.typeset-docs').count(), 1)
    assert.equal(metrics.paragraph.size, '15px')
    assert.equal(metrics.paragraph.lineHeight, '26.25px')
    assert.match(metrics.paragraph.family, /Geist Variable/)
    assert.equal(metrics.heading.size, '26.25px')
    assert.equal(metrics.heading.weight, '600')
    assert.equal(metrics.inlineCode.size, '12.75px')
    assert.match(metrics.inlineCode.family, /Geist Mono Variable/)
    assert(metrics.fonts.some((font) => font.family === 'Geist Variable' && font.status === 'loaded'))
    assert(metrics.fonts.some((font) => font.family === 'Geist Mono Variable' && font.status === 'loaded'))
    assert.equal(await reply.locator('h2, h3, h4, h5, h6').count(), 7)
    assert.equal(await reply.locator('ul.contains-task-list input[disabled]').count(), 2)
    assert.equal(await reply.locator('blockquote p').count(), 2)
    assert.equal(await reply.locator('.katex').count(), 2)
    assert(await reply.locator('.markdown-content').evaluate((node) => node.getBoundingClientRect().width) > 37 * 15)
    assert(await document.locator('.markdown-content').evaluate((node) => node.getBoundingClientRect().width) <= 37 * 15)
    assert.equal(metrics.cardTitle.size, '13px')
    assert.equal(metrics.cardStatus.size, '13px')
    assert.equal(metrics.button.size, '13px')
    assert.equal(await card.locator('[data-slot="card-header"].typeset, [data-slot="card"].typeset, button.typeset').count(), 0)
    assert.equal(await page.getByRole('region', { name: 'Terminal output' }).locator('.typeset').count(), 0)
    assert.equal(await reply.locator('[data-ca-block-type="datatable"] [data-not-typeset] table').count(), 1)
    assert.equal(await reply.locator('[data-ca-block-type="code"] [data-not-typeset] .shiki').count(), 1)
    const embedded = page.getByRole('region', { name: 'Embedded document' })
    await embedded.getByRole('heading', { name: 'Embedded readonly guidance' }).waitFor()
    assert.equal(await embedded.locator('.typeset .typeset p').evaluate((node) => getComputedStyle(node).fontSize), '15px')
    assert.equal(await embedded.locator('.typeset .typeset').evaluate((node) => node.getBoundingClientRect().width <= 37 * 15), true)
    assert.equal(await embedded.locator('[data-ca-block-type="markdown-preview"]').evaluate((node) => node.getBoundingClientRect().width > 37 * 15), true)
    assert.equal(await embedded.locator('[data-not-typeset] .typeset').count(), 0)
    const comment = page.getByRole('region', { name: 'Comment prose' })
    const entity = comment.locator('button[data-entity]')
    assert.equal(await comment.locator('p').evaluate((node) => getComputedStyle(node).fontSize), '15px')
    assert.equal(await entity.evaluate((node) => getComputedStyle(node).fontSize), '13px')
    assert.match(await entity.evaluate((node) => getComputedStyle(node).fontFamily), /Inter Variable/)
    assert.equal(await entity.locator('xpath=..').getAttribute('data-not-typeset'), 'true')
    await entity.click()
    assert.deepEqual(await page.evaluate(() => proof.routes), ['projects/project/2d94ad10-b63e-4dcf-80fb-1cc5fbfcd889'])
    if (out) {
      await embedded.screenshot({ path: resolve(out, 'final-embedded-document-light.png') })
      await comment.screenshot({ path: resolve(out, 'final-comment-entity-light.png') })
      await card.screenshot({ path: resolve(out, 'final-request-card-light.png') })
    }
    console.log('PASS official profile fonts/scale/semantics, chat width, document measure, terminal and real card/embed exclusions')

    await reply.getByRole('link', { name: 'external reference' }).click()
    await reply.getByRole('link', { name: 'local reference' }).click()
    assert.deepEqual(await page.evaluate(() => proof.links), ['https://example.com/guide'])
    assert.deepEqual(await page.evaluate(() => proof.files), ['/fixture/guide.md'])
    for (const label of ['Unsafe scheme', 'Unsafe raw scheme']) {
      assert.equal(await page.getByRole('region', { name: 'Safe routing' }).getByText(label, { exact: true }).getAttribute('href'), null)
    }
    const interactive = reply.locator('[data-ca-block-type="datatable"]')
    await interactive.getByRole('columnheader', { name: 'Count', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="Reply prose"] [data-ca-block-type="datatable"] tbody tr td')?.textContent === 'Pending')
    await page.evaluate(() => {
      const root = document.querySelector('[aria-label="Reply prose"]')
      window.retained = { heading: root.querySelector('h1'), paragraph: root.querySelector('p'), code: root.querySelector('[data-ca-block-type="code"]'), table: root.querySelector('[data-ca-block-type="datatable"]'), top: root.querySelector('h1').getBoundingClientRect().top }
      proof.append()
    })
    await reply.getByText('An appended streaming paragraph keeps completed blocks in place.').waitFor()
    assert.equal(await page.evaluate(() => {
      const root = document.querySelector('[aria-label="Reply prose"]')
      return retained.heading === root.querySelector('h1') && retained.paragraph === root.querySelector('p') && retained.code === root.querySelector('[data-ca-block-type="code"]') && retained.table === root.querySelector('[data-ca-block-type="datatable"]') && retained.top === root.querySelector('h1').getBoundingClientRect().top
    }), true)
    assert.match(await interactive.locator('tbody tr').first().innerText(), /Pending/)
    console.log('PASS native link routing and completed block/control DOM identity while the tail streams')
  }
  await reply.locator('[data-ca-block-type="code"]').scrollIntoViewIfNeeded()
  if (out) await page.screenshot({ path: resolve(out, `${baseline ? 'baseline' : 'final'}-light-code-math.png`) })
  await page.evaluate(() => proof.setDark(true))
  await page.waitForFunction(() => document.querySelector('[aria-label="Reply prose"] .shiki.github-dark') !== null)
  await page.waitForTimeout(600)
  if (out) await page.screenshot({ path: resolve(out, `${baseline ? 'baseline' : 'final'}-dark-code-math.png`) })
  await page.setViewportSize({ width: 390, height: 1050 })
  await reply.getByRole('heading', { name: 'Readable project guidance' }).evaluate((node) => node.scrollIntoView({ block: 'start' }))
  await page.waitForTimeout(100)
  if (out) await page.screenshot({ path: resolve(out, `${baseline ? 'baseline' : 'final'}-narrow-dark.png`) })
  if (!baseline) {
    const narrow = await reply.locator('p').first().evaluate((node) => ({ size: getComputedStyle(node).fontSize, height: getComputedStyle(node).lineHeight }))
    assert.equal(narrow.size, '16.875px')
    assert.equal(narrow.height, '29.5312px')
    const wide = page.getByRole('region', { name: 'Wide semantic table' }).locator('.typeset-scroll')
    assert.equal(await wide.evaluate((node) => node.scrollWidth > node.clientWidth), true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    assert.equal(await reply.locator('.markdown-content').evaluate((node) => node.getBoundingClientRect().right <= window.innerWidth), true)
    assert.equal(await reply.locator('table').first().getAttribute('role'), null)
    assert.deepEqual(errors, [])
    assert.deepEqual(failedRequests, [])
    console.log('PASS official narrow-screen type scale, semantic horizontal table overflow, light/dark rendering, zero page/request errors')
  }
  await reply.locator('[data-ca-block-type="code"]').evaluate((node) => node.scrollIntoView({ block: 'start' }))
  if (out) await page.screenshot({ path: resolve(out, `${baseline ? 'baseline' : 'final'}-narrow-dark-code-math.png`) })
} finally {
  await browser?.close()
  await server.close()
}
