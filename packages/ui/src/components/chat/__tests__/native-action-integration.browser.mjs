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
  plugins: [{ name: 'canonical-turn-fixture', configureServer(instance) {
    instance.middlewares.use(async (req, res, next) => {
      if (req.url !== '/') return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await instance.transformIndexHtml('/', '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated canonical action integration</title></head><body><div id="root"></div><script type="module" src="/native-action-integration.fixture.tsx"></script></body></html>'))
    })
  } }, react(), tailwind()],
  resolve: { alias: [
    { find: '@', replacement: resolve(root, 'apps/electron/src/renderer') },
    { find: 'react', replacement: resolve(root, 'node_modules/react') },
    { find: 'react-dom', replacement: resolve(root, 'node_modules/react-dom') },
  ], dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, ...(process.env.NATIVE_CARD_SOURCE_ROOT ? [process.env.NATIVE_CARD_SOURCE_ROOT] : [])] } },
})
let browser
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) })
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`)
  const first = page.locator('[data-viewer="user:viewer-1"]')
  const second = page.locator('[data-viewer="user:viewer-2"]')
  await first.getByRole('button', { name: 'Approve', exact: true }).waitFor()
  const update = async (data, enabled = true) => {
    const revision = await page.evaluate(() => proof.revision)
    await page.evaluate(({ data, enabled }) => proof.update(data, enabled), { data, enabled })
    await page.waitForFunction(revision => proof.revision > revision, revision)
  }
  assert.equal(await second.getByRole('button', { name: 'Approve', exact: true }).count(), 1)
  assert.doesNotMatch(await page.locator('body').innerText(), /RAW_PRIVATE|Thinking\.\.\.|Preparing response/)
  const disclosure = first.getByRole('button', { name: 'Activity · 2 actions', exact: true })
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false')
  assert.equal(await first.getByText('Read the existing brief', { exact: true }).count(), 0)
  assert.equal(await first.getByText('Later activity', { exact: true }).count(), 0)
  assert.equal(await first.getByText('Awaiting approval', { exact: true }).count(), 1)
  await disclosure.click()
  await first.getByText('Read the existing brief', { exact: true }).waitFor()
  await first.getByText('Later activity', { exact: true }).waitFor()
  await disclosure.click()
  await first.getByRole('button', { name: 'Details', exact: true }).click()
  if (out) await page.screenshot({ path: resolve(out, 'canonical-pending-two-viewers.png') })
  await first.getByRole('button', { name: 'Approve', exact: true }).click()
  await page.waitForFunction(() => proof.calls.length === 1)
  assert.deepEqual(await page.evaluate(() => proof.calls), [{ sessionId: 'fixture-chat', toolUseId: 'tool-call-1', allowed: true, alwaysAllow: false }])
  assert.equal(await first.getByRole('button', { name: 'Approve', exact: true }).isDisabled(), true)
  await update({ status: 'approved', actorName: 'Reviewer', actorId: 'user:viewer-1', resolvedAt: 1000 })
  for (const viewer of [first, second]) {
    assert.match(await viewer.locator('p[role="status"]').innerText(), /Approved.*Reviewer/)
    assert.equal(await viewer.getByRole('button', { name: 'Approve', exact: true }).count(), 0)
  }
  await update({ id: 'new-source-tool-call', status: 'pending', eligibleActors: ['user:viewer-2'] })
  assert.match(await first.innerText(), /cannot resolve it/)
  await second.getByRole('button', { name: 'Deny', exact: true }).click()
  await page.waitForFunction(() => proof.calls.length === 2)
  assert.equal((await page.evaluate(() => proof.calls))[1].toolUseId, 'new-source-tool-call')
  await page.evaluate(() => proof.reject())
  await second.getByRole('alert').waitFor()
  assert.doesNotMatch(await second.innerText(), /RAW_PRIVATE_BACKEND_ERROR/)
  await update({ status: 'canceled', eligibleActors: [] }, false)
  assert.equal(await first.getByRole('button', { name: 'Approve', exact: true }).count(), 0)
  assert.match(await second.locator('p[role="status"]').innerText(), /Canceled/)
  await update({ status: 'pending', eligibleActors: ['user:viewer-1', 'user:viewer-2'] }, false)
  assert.equal(await second.getByRole('button', { name: 'Approve', exact: true }).count(), 0)
  await update({ status: 'expired' })
  assert.match(await first.locator('p[role="status"]').innerText(), /Expired/)
  await update({ kind: 'question', status: 'pending' })
  assert.match(await first.innerText(), /Awaiting answer/)
  await first.getByLabel('Your answer', { exact: true }).fill('Reviewed answer')
  await first.getByRole('button', { name: 'Send answer' }).click()
  await page.waitForFunction(() => proof.calls.length === 3)
  assert.deepEqual((await page.evaluate(() => proof.calls))[2], { sessionId: 'fixture-chat', toolUseId: 'new-source-tool-call', answer: 'Reviewed answer' })
  assert.equal(await first.getByRole('button', { name: 'Send answer' }).isDisabled(), true)
  await update({ status: 'approved' })
  assert.match(await second.locator('p[role="status"]').innerText(), /Answered/)
  await update({ id: 'multi-question', kind: 'question', status: 'pending', choices: [{ label: 'First' }, { label: 'Second' }], selectionMode: 'multi_select' })
  await second.getByRole('checkbox', { name: 'First', exact: true }).check()
  await second.getByRole('checkbox', { name: 'Second', exact: true }).check()
  await second.getByRole('button', { name: 'Send answer' }).click()
  await page.waitForFunction(() => proof.calls.length === 4)
  assert.deepEqual((await page.evaluate(() => proof.calls))[3], { sessionId: 'fixture-chat', toolUseId: 'multi-question', answer: ['First', 'Second'] })
  const artifact = { type: 'library', id: 'existing-library-id', title: 'Reviewed brief' }
  await update({ kind: 'artifact', status: 'approved', artifact })
  await second.getByRole('button', { name: 'Reviewed brief', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => proof.opened), [artifact])
  await page.setViewportSize({ width: 390, height: 844 })
  await update({ kind: 'approval', status: 'pending', artifact: undefined, id: 'narrow-request' })
  await page.waitForTimeout(350)
  if (out) await page.screenshot({ path: resolve(out, 'canonical-pending-narrow.png') })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, [])
  console.log('PASS: actual TurnCard + NativeActionCard in two viewers; canonical terminal updates, exact approval/free-text/multi-answer callback IDs, read-only/canceled/stopped/expired cases, safe failures, new request reset, original artifact identity and narrow layout.')
} finally {
  await browser?.close()
  await server.close()
}
