import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

test.beforeEach(async ({ page }) => { await page.goto('/') })
const resultsHeading = 'Understand the impact.'

test('landing, real example, filtering, grouping and deterministic exports', async ({ page }) => {
  await expect(page).toHaveTitle(/APIShift/)
  await page.getByRole('button', { name: 'Try a real example' }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toBeVisible()
  await expect(page.getByText('6 of 6 findings', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Breaking 4 Requires attention', exact: true })).toBeVisible()
  await page.getByLabel('Filter severity').selectOption('breaking')
  await expect(page.locator('.findings-count')).toContainText('4 of 6 findings')
  await page.getByLabel('Search findings').fill('not-found-anywhere')
  await expect(page.getByRole('heading', { name: 'No findings match these filters' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.getByLabel('Group findings').selectOption('severity')
  await expect(page.getByRole('heading', { name: 'Non-breaking', exact: true })).toBeVisible()
  const files: string[] = []
  for (const name of ['JSON', 'JSON', 'Markdown']) {
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name, exact: true }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe(name === 'JSON' ? 'apishift-report.json' : 'apishift-report.md')
    files.push(await readFile((await download.path())!, 'utf8'))
  }
  expect(files[0]).toBe(files[1])
  expect(JSON.parse(files[0]).counts.breaking).toBe(4)
  expect(files[2]).toContain('# APIShift comparison report')
})

test('file upload, compare, swap, reset and undo invalidate results', async ({ page }) => {
  await page.getByLabel('Upload baseline specification').setInputFiles(path.resolve('examples/baseline.yaml'))
  await page.getByLabel('Upload proposed specification').setInputFiles(path.resolve('examples/proposed.yaml'))
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toBeVisible()
  await page.getByRole('button', { name: 'Swap baseline and proposed' }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'BASELINE / what’s live', exact: true }).getByRole('button', { name: /proposed.yaml/ })).toBeVisible()
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toBeVisible()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Choose a specification or drag and drop it here' })).toHaveCount(2)
  await page.getByRole('button', { name: 'Undo reset' }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toBeVisible()
})

test('paste validation errors, unsupported version, empty contract and stale results', async ({ page }) => {
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Add both baseline and proposed')
  await page.getByRole('button', { name: 'Paste specification', exact: true }).nth(0).click()
  await page.getByRole('button', { name: 'Paste specification', exact: true }).nth(1).click()
  const spec = JSON.stringify({ openapi: '3.1.0', info: { title: 'Empty', version: '1' }, paths: {} })
  await page.getByLabel('Baseline specification', { exact: true }).fill(spec)
  await page.getByLabel('Proposed specification', { exact: true }).fill('{')
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Proposed: Invalid JSON or YAML')
  await expect(page.getByRole('alert')).toBeFocused()
  await page.getByLabel('Proposed specification', { exact: true }).fill(spec.replace('3.1.0', '3.2.0'))
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Supported versions')
  await page.getByLabel('Proposed specification', { exact: true }).fill(spec)
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'No changes detected in the supported rules' })).toBeVisible()
  await page.getByLabel('Baseline specification', { exact: true }).fill('{}')
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
})

test('no external traffic, no persistence, unsafe refs rejected and strings rendered as text', async ({ page, context }) => {
  const external: string[] = []
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('blob:')) external.push(request.url()) })
  const make = (schema: unknown) => JSON.stringify({ openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths: { '/<img src=x onerror=alert(1)>': { get: { responses: { '200': { description: 'OK', content: { 'application/json': { schema } } } } } } } })
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Paste specification', exact: true }).nth(i).click()
  await page.getByLabel('Baseline specification', { exact: true }).fill(make({ type: 'string' }))
  await page.getByLabel('Proposed specification', { exact: true }).fill(make({ $ref: 'https://example.invalid/private.json' }))
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('External references are never fetched')
  await page.getByLabel('Proposed specification', { exact: true }).fill(make({ type: 'number' }))
  await page.getByRole('button', { name: 'Compare specifications', exact: true }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toBeVisible()
  expect(await page.locator('img').count()).toBe(0)
  expect(external).toEqual([])
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
  expect(await context.cookies()).toEqual([])
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
})

test('file size limit and resetting an active worker', async ({ page }) => {
  await page.getByLabel('Upload baseline specification').setInputFiles({ name: 'large.yaml', mimeType: 'text/yaml', buffer: Buffer.alloc(1_048_577, 'a') })
  await expect(page.getByRole('alert')).toContainText('file exceeds 1 MiB')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Your next release, with fewer surprises.' })).toBeVisible()
})

test('worker timeout fails closed and reset terminates pending work', async ({ page }) => {
  await page.addInitScript(() => {
    class StalledWorker {
      postMessage() { /* Deliberately never finishes: exercise the watchdog. */ }
      terminate() { /* No browser worker is started in this injected failure scenario. */ }
    }
    Object.defineProperty(window, 'Worker', { value: StalledWorker })
  })
  await page.reload()
  await page.clock.install()
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Analyzing locally…' })).toBeDisabled()
  await page.clock.runFor(8_001)
  await expect(page.getByRole('alert')).toContainText('8-second processing limit')
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await page.clock.runFor(8_001)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: resultsHeading })).toHaveCount(0)
})

test('keyboard navigation, responsive layout, light and dark accessibility', async ({ page }, testInfo) => {
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Load example', exact: true }).click()
  await expect(page.getByRole('heading', { name: resultsHeading })).toBeVisible()
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations
    expect(violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`${theme}.png`), fullPage: true })
  }
  await page.getByLabel('Filter severity').focus()
  await expect(page.getByLabel('Filter severity')).toBeFocused()
  if (testInfo.project.name === 'desktop-chromium') {
    await page.setViewportSize({ width: 768, height: 1024 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.setViewportSize({ width: 640, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }
})
