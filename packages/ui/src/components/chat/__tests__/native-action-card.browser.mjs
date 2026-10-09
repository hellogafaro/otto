import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const fixtures = fileURLToPath(new URL('./', import.meta.url))
const out = process.env.NATIVE_CARD_PROOF_DIR
if (out) mkdirSync(out, { recursive: true })
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const server = await createServer({
  configFile: false, root: fixtures,
  plugins: [
    { name: 'native-action-card-fixture', configureServer(instance) {
      instance.middlewares.use(async (req, res, next) => {
        if (req.url !== '/') return next()
        res.setHeader('Content-Type', 'text/html')
        res.end(await instance.transformIndexHtml('/', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native action card controlled fixture</title></head><body><div id="root"></div><script type="module" src="/native-action-card.fixture.tsx"></script></body></html>'))
      })
    } }, react(), tailwind(),
  ],
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  const errors = []
  page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGE_ERROR', error.message) })
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const card = page.getByRole('group', { name: 'Update the project brief' })
  const status = page.getByRole('status')
  const approve = page.getByRole('button', { name: 'Approve', exact: true })
  const deny = page.getByRole('button', { name: 'Deny', exact: true })
  const reset = async (data = {}, canResolve = true) => {
    const id = await page.evaluate(({ data, canResolve }) => proof.reset(data, canResolve), { data, canResolve })
    await page.waitForFunction((id) => proof.renderedId === id, id)
  }
  const update = async (data) => {
    await page.evaluate((data) => proof.update(data), data)
    await page.waitForFunction((state) => proof.renderedStatus === state, data.status)
  }
  await approve.waitFor()
  assert.equal(await status.innerText(), 'Awaiting approval')
  assert.equal(await card.locator('strong').innerText(), 'Goals')
  assert.equal(await page.getByText('Keep the existing document ID.', { exact: true }).count(), 0)
  const details = page.getByRole('button', { name: 'Details' })
  await details.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('heading', { name: 'Change preview' }).waitFor()
  assert.equal(await details.getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('Tab')
  assert.equal(await approve.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press('Tab')
  assert.equal(await deny.evaluate((node) => node === document.activeElement), true)
  if (out) await page.screenshot({ path: resolve(out, 'pending-preview-light.png') })
  console.log('PASS actual Markdown operation/preview, collapsed details, Enter, and Tab order')

  await approve.focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => proof.calls.length === 1)
  assert.equal(await approve.isDisabled(), true)
  assert.equal(await deny.isDisabled(), true)
  await approve.dispatchEvent('click')
  await deny.dispatchEvent('click')
  assert.equal(await page.evaluate(() => proof.calls.length), 1)
  assert.equal(await status.innerText(), 'Awaiting approval')
  await page.evaluate(() => proof.resolve())
  await page.waitForTimeout(50)
  assert.equal(await approve.isDisabled(), true)
  await update({ status: 'approved', actorName: 'Fixture reviewer', resolvedAt: 1791465600000 })
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'status')
  assert.match(await status.innerText(), /Approved · Fixture reviewer/)
  assert.equal(await approve.count(), 0)
  assert.equal(await status.locator('time').getAttribute('datetime'), new Date(1791465600000).toISOString())
  console.log('PASS submitting fence, no optimistic approval, authoritative actor/time, and focus recovery')

  await reset()
  await approve.click()
  await page.evaluate(() => proof.reject())
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /Could not submit your response/)
  assert.equal(await page.getByText(/RAW_PRIVATE_ERROR_BODY|fixture-secret/).count(), 0)
  assert.equal(await approve.isEnabled(), true)
  await approve.click()
  await update({ status: 'denied', actorName: 'Another reviewer' })
  await page.evaluate(() => proof.reject())
  await page.waitForTimeout(50)
  assert.match(await status.innerText(), /Denied · Another reviewer/)
  assert.equal(await page.getByRole('alert').count(), 0)
  console.log('PASS constant safe error/retry and stale rejection cannot overwrite another authoritative decision')

  await reset({}, false)
  assert.equal(await approve.count(), 0)
  assert.equal(await deny.count(), 0)
  for (const state of ['resolving', 'approved', 'denied', 'canceled', 'expired', 'failed']) {
    await update({ status: state })
    assert.equal(await approve.count(), 0)
    assert.equal(await deny.count(), 0)
    assert.equal(await page.getByRole('textbox').count(), 0)
  }
  await reset({ kind: 'question' }, false)
  assert.equal(await page.getByRole('textbox').count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Send answer' }).count(), 0)
  for (const state of ['resolving', 'approved', 'denied', 'canceled', 'expired', 'failed']) {
    await reset({ kind: 'question', status: state })
    assert.equal(await page.getByRole('textbox').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Send answer' }).count(), 0)
  }
  await reset()
  await approve.focus()
  await update({ status: 'resolving' })
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'status')
  await reset()
  await approve.focus()
  await page.evaluate(() => proof.setCanResolve(false))
  await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'status')
  assert.equal(await approve.count(), 0)
  await reset()
  await approve.focus()
  await page.mouse.click(1050, 800)
  await update({ status: 'approved' })
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true)
  console.log('PASS server-scope read-only and every terminal/resolving state is nonactionable')

  await reset({ kind: 'question' })
  await page.getByRole('textbox', { name: 'Your answer' }).fill('  Reviewed answer  ')
  await page.getByRole('button', { name: 'Send answer' }).click()
  assert.deepEqual(await page.evaluate(() => proof.calls), ['Reviewed answer'])
  assert.equal(await status.innerText(), 'Awaiting answer')
  const choices = [{ label: 'Tests', description: 'Run focused verification.' }, { label: 'Docs', description: 'Update the existing document.' }]
  await reset({ kind: 'question', choices })
  await page.getByRole('radio', { name: 'Tests Run focused verification.' }).focus()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.getByRole('radio', { name: 'Docs Update the existing document.' }).getAttribute('aria-checked'), 'true')
  await page.getByRole('button', { name: 'Send answer' }).click()
  assert.deepEqual(await page.evaluate(() => proof.calls), ['Docs'])
  await reset({ kind: 'question', choices, selectionMode: 'multi_select' })
  for (const option of ['Tests Run focused verification.', 'Docs Update the existing document.']) {
    await page.getByRole('checkbox', { name: option }).focus()
    await page.keyboard.press('Space')
  }
  await page.getByRole('button', { name: 'Send answer' }).click()
  assert.deepEqual(await page.evaluate(() => proof.calls), [['Tests', 'Docs']])
  console.log('PASS labeled free text, native-compatible single/multiple choices, and keyboard selection')

  for (const type of ['library', 'project', 'task']) {
    const reference = { type, id: `existing-${type}-fixture-id`, title: `Existing ${type} fixture` }
    await reset({ kind: 'artifact', status: 'approved', artifact: reference })
    await page.getByRole('button', { name: reference.title }).click()
    assert.deepEqual(await page.evaluate(() => proof.opened), [reference])
    for (const state of ['pending', 'resolving', 'denied', 'canceled', 'expired', 'failed']) {
      await update({ status: state })
      assert.equal(await page.getByRole('button', { name: reference.title }).count(), 0)
    }
  }
  await reset({ status: 'approved', resolvedAt: Number.MAX_VALUE })
  assert.equal(await status.locator('time').count(), 0)
  const artifact = { type: 'library', id: 'existing-library-fixture-id', title: 'Reviewed launch brief' }
  await reset({ kind: 'artifact', status: 'approved', title: 'Project brief ready', summary: 'The reviewed document is ready in Library.', artifact, actorName: 'Fixture agent', resolvedAt: 1791465600000 })
  await page.getByRole('button', { name: artifact.title }).click()
  assert.deepEqual(await page.evaluate(() => proof.opened), [artifact])
  assert.equal(await page.getByRole('button', { name: /copy|create/i }).count(), 0)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.waitForTimeout(600)
  if (out) await page.screenshot({ path: resolve(out, 'artifact-dark.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await reset({ title: 'A long operation title that remains readable on a narrow chat viewport', summary: 'Replace **Goals** in the reviewed brief without changing the original Library document ID.' })
  await details.click()
  if (out) await page.screenshot({ path: resolve(out, 'pending-preview-mobile-dark.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  for (const button of [approve, deny, details]) {
    const rect = await button.boundingBox()
    assert(rect && rect.x >= 0 && rect.x + rect.width <= 390)
  }
  assert.deepEqual(errors, [])
  console.log('PASS original artifact identity callback, no copy/create, light/dark/narrow rendering, zero page errors')
} finally {
  await browser?.close()
  await server.close()
}
