#!/usr/bin/env node
/**
 * Invariant smoke test — drives the real app in a real browser.
 *
 * `npm test` covers pure functions, and it has never caught a serious bug in
 * this codebase. Every one that shipped and was fixed — AI-created documents
 * arriving blank, a context menu that closed itself on open, a multi-select menu
 * whose every action threw ReferenceError, an outliner that ejected you to the
 * editor on the first click — compiled cleanly and passed the unit suite. They
 * were only visible by driving the app.
 *
 * So this asserts the things CLAUDE.md calls non-negotiable, against the running
 * studio:
 *
 *   1 · AI off  ⇒ no AI component renders, no AI path is reachable.
 *   2 · No AI write reaches a .md except through Proposal → review → apply.
 *   4 · updateContent() is the only mutation seam, and it reaches disk.
 *   5 · ProposalService.apply() snapshots before it writes. No exceptions.
 *   6 · Node ids are stable, unique, and never reused.
 *
 * plus the WCAG AA contrast floors on the muted text ramp, in every theme.
 *
 * Where a claim is about *durability*, the assertion reads persisted bytes out
 * of OPFS rather than the DOM — the blank-document bug passed every DOM check
 * while writing nothing to disk.
 *
 * Runs against the OPFS backend (File System Access is deleted before the app
 * boots) so there is no directory-picker prompt to satisfy.
 *
 *   node scripts/smoke.mjs
 *   BASE=http://localhost:4173 node scripts/smoke.mjs
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const PID = 'smoke'

// CI images often preinstall a browser at a known path; otherwise use whatever
// `playwright install chromium` put down.
const executablePath = ['/opt/pw-browsers/chromium/chrome', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome']
  .find((p) => fs.existsSync(p))

let failed = 0
let ran = 0
function check(label, ok, detail) {
  ran++
  if (!ok) failed++
  console.log(`${ok ? '\x1b[32m  ok\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${label}`)
  if (!ok && detail !== undefined) console.log(`        got: ${JSON.stringify(detail)}`)
}
function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`) }

// ── fixture ─────────────────────────────────────────────────────────────────

const ORIGINAL = 'The original text of this scene, written by a human being. '

function seed(page) {
  return page.evaluate(async ({ pid, original }) => {
    const root = await (await navigator.storage.getDirectory())
      .getDirectoryHandle('konbini-projects', { create: true })
    const bundle = await root.getDirectoryHandle(`${pid}.konbini`, { create: true })
    const docsDir = await bundle.getDirectoryHandle('docs', { create: true })
    await bundle.getDirectoryHandle('snapshots', { create: true })
    const write = async (dir, name, text) => {
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await fh.createWritable()
      await w.write(text)
      await w.close()
    }
    const now = new Date().toISOString()
    const mk = (id, type, title, parentId) => ({
      id, type, title, parentId, childIds: [], expanded: true,
      meta: { label: 'scene', status: 'draft', synopsis: '', target: 500, includeInCompile: true, keywords: [] },
      ext: {}, rev: 1, modified: now,
    })
    const nodes = { trash: mk('trash', 'folder', 'Trash', null), ch1: mk('ch1', 'folder', 'Chapter One', null) }
    const docs = {}
    for (let i = 0; i < 3; i++) {
      const sid = `sc${i}`
      nodes[sid] = mk(sid, 'scene', `Scene ${i + 1}`, 'ch1')
      nodes.ch1.childIds.push(sid)
      docs[sid] = { snapshots: [] }
      await write(docsDir, `${sid}.md`, original.repeat(6))
    }
    await write(bundle, 'project.json', JSON.stringify({
      schemaVersion: 2, id: pid, title: 'Smoke', created: now, modified: now,
      rootIds: ['ch1', 'trash'], trashId: 'trash', nodes, docs,
      settings: { location: 'opfs:' + pid, template: 'novel' },
    }))
    for (const f of ['codex.json', 'debt.json', 'comments.json']) await write(bundle, f, '[]')
    window.api.prefs.set('konbini_recents_v1', JSON.stringify([
      { id: pid, title: 'Smoke', location: 'opfs:' + pid, opened: Date.now(), words: 100 },
    ]))
  }, { pid: PID, original: ORIGINAL })
}

/** Read a file out of the bundle in OPFS — the durable truth, not the store. */
function readBundle(page, path) {
  return page.evaluate(async ({ pid, path: p }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
    let dir = await root.getDirectoryHandle(`${pid}.konbini`)
    const parts = p.split('/')
    const file = parts.pop()
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg)
    try { return await (await (await dir.getFileHandle(file)).getFile()).text() }
    catch { return null }
  }, { pid: PID, path })
}

function listBundle(page, sub) {
  return page.evaluate(async ({ pid, sub: s }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
    let dir = await root.getDirectoryHandle(`${pid}.konbini`)
    // A node with no snapshots yet has no directory at all.
    try { for (const seg of (s ? s.split('/') : [])) dir = await dir.getDirectoryHandle(seg) }
    catch { return [] }
    const out = []
    for await (const [name] of dir.entries()) out.push(name)
    return out.sort()
  }, { pid: PID, sub })
}

// ── boot ────────────────────────────────────────────────────────────────────

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
await page.addInitScript(() => { try { delete window.showDirectoryPicker } catch { /* already absent */ } })

const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(BASE)
await page.waitForFunction(() => !!window.api, null, { timeout: 30000 })
await seed(page)
await page.reload()
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(600)

/** The AI panels, by the label the rail actually renders. */
const AI_TABS = ['Chat', 'Codex', 'Readers', 'Critic']
const railTabs = () => page.evaluate(() =>
  [...document.querySelectorAll('.rail-tabs > button')].map((b) => b.title || b.textContent.trim()))
/**
 * Flip the AI layer the way a writer does — through the settings screen.
 *
 * Deliberately not by importing aiStore: a dev server that has hot-reloaded a
 * module serves it at `…?t=<stamp>`, so a fresh `import()` from the test gets
 * its own instance with its own state, and every assertion after it would be
 * measuring a store the app has never heard of.
 */
const setAI = async (on) => {
  // Reached through the command palette rather than the toolbar: the toolbar's
  // "AI" button only exists while AI is *off*, so it can't be used to turn it
  // back off again.
  // The palette labels the same screen "Enable AI…" while AI is off and
  // "AI Settings…" once it is on, so ask for whichever one exists right now.
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.type(on ? 'Enable AI' : 'AI Settings', { delay: 20 })
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  const box = page.locator('label:has-text("Enable AI features") input[type=checkbox]')
  await box.waitFor({ timeout: 10000 })
  if ((await box.isChecked()) !== on) await box.setChecked(on)
  await page.waitForTimeout(300)
  // Leave the settings screen so the rail is measurable again.
  const close = page.locator('.tab-x').last()
  if (await close.count()) await close.click()
  await page.waitForTimeout(400)
}

// ── invariant 1 ─────────────────────────────────────────────────────────────
section('Invariant 1 · AI off means zero AI in the DOM')

// Off is observable without reaching into state: the toolbar shows the
// "enable" affordance rather than the AI controls.
check('AI is off out of the box (BYOK — nothing runs unasked)',
  await page.locator('.tb-btn.ai-enable').count() === 1)

const offTabs = await railTabs()
check('no AI panel is offered in the rail', AI_TABS.every((t) => !offTabs.includes(t)), offTabs)
check('the AI switch is still visible, so the feature is discoverable',
  await page.locator('.tb-btn.ai-enable').count() === 1)

// Prove the check above isn't vacuous: the same selectors must find AI when on.
await setAI(true)
const onTabs = await railTabs()
check('turning AI on adds every AI panel (guard is not vacuous)',
  AI_TABS.every((t) => onTabs.includes(t)), onTabs)
// The one AI capability that can rewrite the app's own configuration must be
// off until the author asks for it — separately from AI itself being on.
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('AI Settings', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
const cfgBox = page.locator('label:has-text("Let the assistant edit its own instructions") input[type=checkbox]')
await cfgBox.waitFor({ timeout: 10000 }).catch(() => {})
check('the assistant cannot edit its own settings by default',
  await cfgBox.count() === 1 && !(await cfgBox.isChecked()))
await page.locator('.tab-x').last().click()
await page.waitForTimeout(400)

await setAI(false)
check('turning AI back off removes them all', (await railTabs()).every((t) => !AI_TABS.includes(t)))

// ── invariant 6 ─────────────────────────────────────────────────────────────
section('Invariant 6 · node ids are unique and never reused')

// Create nodes through the platform seam as fast as the app can, which keeps
// the whole burst inside a millisecond or two — exactly the window where a
// time-plus-counter id collides between two devices.
const burst = await page.evaluate(async () => {
  const pid = 'smoke'
  const out = []
  for (let i = 0; i < 30; i++) {
    const r = await window.api.node.mutate(pid, { type: 'create', parentId: null, nodeType: 'document' })
    out.push(Object.values(r.nodes).filter((n) => n.ext._newId !== undefined).map((n) => n.id))
  }
  return out
})
const burstIds = burst.flat()
check('30 rapid creates yield 30 distinct ids',
  new Set(burstIds).size === burstIds.length && burstIds.length === 30, burstIds.length)
check('ids carry per-process entropy, not just time+counter',
  burstIds.every((id) => id.split('-').length >= 4), burstIds[0])

// The `_newId` marker must be one-shot. A stale one made every AI-created
// document resolve to the *first* node of the session — which is how AI drafts
// arrived blank.
check('each create marks exactly one new node', burst.every((m) => m.length === 1), burst)
check('consecutive creates never resolve to the same node',
  new Set(burst.map((m) => m[0])).size === burst.length)

const manifest = JSON.parse(await readBundle(page, 'project.json'))
const nodeIds = Object.keys(manifest.nodes)
check('persisted ids are unique', new Set(nodeIds).size === nodeIds.length, nodeIds.length)
check('every childId resolves to a real node',
  Object.values(manifest.nodes).every((n) => n.childIds.every((c) => manifest.nodes[c])))
check('every parentId resolves to a real node',
  Object.values(manifest.nodes).every((n) => n.parentId === null || !!manifest.nodes[n.parentId]))
check('no node is its own child',
  Object.values(manifest.nodes).every((n) => !n.childIds.includes(n.id)))
check('no _newId marker was persisted',
  Object.values(manifest.nodes).every((n) => n.ext?._newId === undefined),
  Object.values(manifest.nodes).filter((n) => n.ext?._newId !== undefined).map((n) => n.id))

// ── invariant 4 ─────────────────────────────────────────────────────────────
section('Invariant 4 · typed text reaches disk through the one seam')

await page.locator('.tree-row').filter({ hasText: 'Scene 1' }).first().click()
await page.waitForSelector('.cm-content', { timeout: 20000 })
await page.locator('.cm-content').click()
await page.keyboard.press('Control+End')
await page.keyboard.type(' HUMAN_EDIT.', { delay: 15 })
await page.waitForFunction(
  () => /saved/i.test(document.querySelector('.statusbar')?.textContent ?? ''),
  null, { timeout: 15000 },
).catch(() => { /* fall through to the byte check, which is the real assertion */ })
await page.waitForTimeout(1200)
const afterTyping = await readBundle(page, 'docs/sc0.md')
check('the .md on disk contains what was typed',
  !!afterTyping && afterTyping.includes('HUMAN_EDIT.'), afterTyping?.slice(-60))

// ── invariants 2 & 5 ────────────────────────────────────────────────────────
section('Invariants 2 & 5 · edits are gated by review, and snapshotted first')

// Driven through project-wide replace, which queues proposals into exactly the
// pipeline every AI command uses: createProposal → the store's queue →
// ChangesetModal → Studio's single onApply, which snapshots and then writes.
// Using replace rather than a mocked AI call means the gate and the snapshot are
// proved by a real user flow with nothing stubbed.
const snapsBefore = await listBundle(page, 'snapshots/sc1')
const diskBefore = await readBundle(page, 'docs/sc1.md')
check('fixture text is on disk to begin with', diskBefore.includes('human being'), diskBefore?.slice(0, 40))

await page.keyboard.press('Control+Shift+F')
await page.waitForSelector('.srch-input', { timeout: 10000 })
await page.locator('.srch-input').first().fill('human being')
await page.waitForTimeout(500)
await page.locator('.srch-replace').fill('REVIEWED_REPLACEMENT')
await page.waitForTimeout(400)
const replaceAll = page.locator('.modal-foot .btn.primary, .btn.primary:has-text("Replace all")').last()
check('replace offers a reviewable "replace all"', await replaceAll.count() > 0)
await replaceAll.click()

await page.waitForSelector('.cs-body', { timeout: 10000 })
check('a changeset review opens before anything is written', true)
check('the review offers per-hunk accept/reject', await page.locator('.cs-hunk').count() > 0)

// The gate has to be load-bearing: nothing may have reached disk yet.
const diskDuringReview = await readBundle(page, 'docs/sc1.md')
check('nothing is written while a change is only proposed',
  diskDuringReview === diskBefore && !diskDuringReview.includes('REVIEWED_REPLACEMENT'),
  diskDuringReview?.slice(0, 60))

// Apply every queued proposal; the queue auto-advances to the next document.
let applied = 0
for (let i = 0; i < 6; i++) {
  if (await page.locator('.cs-body').count() === 0) break
  await page.locator('.modal-foot .btn.primary').click()
  applied++
  await page.waitForTimeout(700)
}
await page.waitForTimeout(800)
check('every queued document was reviewed one at a time', applied >= 1, applied)

const diskAfter = await readBundle(page, 'docs/sc1.md')
check('applying writes the reviewed text to the .md',
  !!diskAfter && diskAfter.includes('REVIEWED_REPLACEMENT'), diskAfter?.slice(0, 60))
check('a proposal applied to a document that is not open still reaches disk',
  diskAfter !== diskBefore)

// Snapshots are filed per node: snapshots/<nodeId>/<snapshotId>.md
const snapsAfter = await listBundle(page, 'snapshots/sc1')
const newSnaps = snapsAfter.filter((s2) => !snapsBefore.includes(s2))
check('applying took a snapshot first', newSnaps.length > 0, { snapsBefore, snapsAfter })
if (newSnaps.length) {
  const bodies = (await Promise.all(newSnaps.map((s2) => readBundle(page, `snapshots/sc1/${s2}`)))).join('\n')
  check('the snapshot holds the pre-change text', bodies.includes('human being'))
  check('the snapshot does NOT hold the new text — it is a rollback point',
    !bodies.includes('REVIEWED_REPLACEMENT'))
}

// ── rename everywhere ───────────────────────────────────────────────────────
section('Rename · a character rename leaves nothing pointing at the old name')

// Project-wide replace rewrites prose and stops, which leaves the binder, the
// codex and — worst — comment anchors disagreeing with the manuscript. A
// comment recovers itself by its quoted text, so renaming the prose without the
// quote orphans the note. This drives the whole operation and reads the bytes.

const RN_SCENE = 'sc0'
await page.evaluate(async ({ pid }) => {
  // Give the fixture the things a rename has to reach beyond prose.
  const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('konbini-projects')
  const bundle = await root.getDirectoryHandle(`${pid}.konbini`)
  const write = async (name, text) => {
    const fh = await bundle.getFileHandle(name, { create: true })
    const w = await fh.createWritable(); await w.write(text); await w.close()
  }
  const manifest = JSON.parse(await (await (await bundle.getFileHandle('project.json')).getFile()).text())
  manifest.nodes.sc0.title = 'Mira at the River'
  manifest.nodes.sc0.meta.synopsis = 'Mira waits for the tide.'
  manifest.nodes.sc0.meta.keywords = ['pov-mira', 'river']
  await write('project.json', JSON.stringify(manifest))
  const docs = await bundle.getDirectoryHandle('docs')
  const fh = await docs.getFileHandle('sc0.md', { create: true })
  const w = await fh.createWritable()
  await w.write('Mira counted the coins. [[Mira]] said nothing. The admiral watched.')
  await w.close()
  const now = new Date().toISOString()
  await write('codex.json', JSON.stringify([{
    id: 'e1', name: 'Mira', aliases: ['Mira Vance'], category: 'character',
    summary: 'Mira runs the ferry.',
    facts: [{ id: 'f1', label: 'role', value: 'Mira pilots it', aiGenerated: false, confirmedAt: null }],
    createdAt: now, modifiedAt: now, aiGenerated: false,
  }]))
  await write('comments.json', JSON.stringify([{
    id: 'c1', docId: 'sc0', anchor: { from: 0, to: 23, quote: 'Mira counted the coins.' },
    body: 'Would Mira really count twice?', author: 'me', origin: 'author', createdAt: now, resolved: false,
  }]))
}, { pid: PID })
await page.reload()
await page.locator('.recent-row').first().click()
await page.waitForSelector('.tree-row', { timeout: 30000 })
await page.waitForTimeout(700)

await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('Rename Everywhere', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.rn-fields', { timeout: 10000 }).catch(() => {})
check('rename is reachable from the command palette', await page.locator('.rn-fields').count() === 1)

await page.locator('.rn-fields input').first().fill('Mira')
await page.locator('.rn-fields input').last().fill('Sera')
await page.waitForTimeout(600)

const rnGroups = await page.locator('.rn-group-hd').allInnerTexts()
const named = (label) => rnGroups.some((g) => g.startsWith(label))
check('the preview inventories every place the name hides',
  ['Documents', 'Binder titles', 'Synopses', 'Keywords', 'Codex', 'Comments'].every(named), rnGroups)

const rnSnapsBefore = await listBundle(page, `snapshots/${RN_SCENE}`)
await page.locator('.modal-foot .btn.primary').click()
await page.waitForTimeout(2500)

const rnProse = await readBundle(page, `docs/${RN_SCENE}.md`)
check('prose is renamed, wikilink included',
  !!rnProse && rnProse.includes('Sera counted') && rnProse.includes('[[Sera]]'), rnProse?.slice(0, 70))
check('a name inside another word is left alone',
  !!rnProse && rnProse.includes('admiral'), rnProse?.slice(0, 70))
check('a snapshot was taken before the document was rewritten',
  (await listBundle(page, `snapshots/${RN_SCENE}`)).length > rnSnapsBefore.length)

const rnManifest = JSON.parse(await readBundle(page, 'project.json'))
const rnNode = rnManifest.nodes[RN_SCENE]
check('the binder title no longer says the old name — the gap replace left',
  rnNode?.title === 'Sera at the River', rnNode?.title)
check('the synopsis follows', rnNode?.meta?.synopsis === 'Sera waits for the tide.', rnNode?.meta?.synopsis)
check('the binder keyword follows, in the case the tag was using',
  (rnNode?.meta?.keywords ?? []).includes('pov-sera'), rnNode?.meta?.keywords)

const rnCodex = JSON.parse(await readBundle(page, 'codex.json') ?? '[]')
check('the codex entry, its aliases, summary and facts all follow',
  rnCodex[0]?.name === 'Sera'
  && rnCodex[0]?.aliases?.includes('Sera Vance')
  && rnCodex[0]?.summary?.includes('Sera')
  && rnCodex[0]?.facts?.[0]?.value?.includes('Sera'), rnCodex[0])

const rnComments = JSON.parse(await readBundle(page, 'comments.json') ?? '[]')
check('the comment\'s quoted anchor follows the prose, so the note is not orphaned',
  rnComments[0]?.anchor?.quote === 'Sera counted the coins.', rnComments[0]?.anchor)
check('and the note text follows too',
  (rnComments[0]?.body ?? '').includes('Sera'), rnComments[0]?.body)
check('nothing anywhere still says the old name',
  !JSON.stringify([rnProse, rnManifest.nodes[RN_SCENE], rnCodex, rnComments]).includes('Mira'))

// ── invariant 2, on a non-Anthropic provider ────────────────────────────────
section('Invariant 2 · assistant tools work on an OpenAI-compatible provider')

// The tool loop was Anthropic-only for one reason — only one wire format had
// been implemented — which made the "let the assistant use tools" switch
// tickable but inert on every other provider. This drives the whole loop over a
// mocked OpenAI-compatible endpoint: tool schemas out, streamed `tool_calls`
// deltas in, results returned as `role: "tool"` messages, and the resulting
// edit still gated by review and snapshotted before it reaches disk.
//
// The mock is deliberately unkind. It splits tool arguments across frames,
// drops `index` from continuation frames, and reports `finish_reason: "stop"`
// on a turn that is asking for a tool — the three ways real compat servers
// (Ollama, vLLM, llama.cpp) diverge from the spec.

const MOCK_BASE = 'https://mock-openai.konbini.test/v1'
const AI_MARKER = 'AI_VIA_OPENAI_TOOLS'
const NEW_TEXT = `Rewritten by the assistant over an OpenAI-compatible endpoint. ${AI_MARKER}`

const frame = (o) => `data: ${JSON.stringify(o)}\n\n`
const delta = (d, extra = {}) => frame({ object: 'chat.completion.chunk', choices: [{ index: 0, delta: d, ...extra }] })
const editArgs = JSON.stringify({ document: 'Scene 3', new_text: NEW_TEXT })
const cut = Math.floor(editArgs.length / 2)

const TURNS = [
  // 1 · asks to read a document; arguments split mid-key across two frames.
  delta({ role: 'assistant', content: '' })
    + delta({ content: 'Let me read that scene.' })
    + delta({ tool_calls: [{ index: 0, id: 'call_read', type: 'function', function: { name: 'get_document', arguments: '' } }] })
    + delta({ tool_calls: [{ index: 0, function: { arguments: '{"tit' } }] })
    + delta({ tool_calls: [{ index: 0, function: { arguments: 'le":"Scene 3"}' } }] })
    + delta({}, { finish_reason: 'tool_calls' }) + 'data: [DONE]\n\n',
  // 2 · proposes an edit — no `index` on the continuation frames, and it claims
  //     to have stopped normally while still asking for a tool.
  delta({ tool_calls: [{ id: 'call_edit', type: 'function', function: { name: 'propose_edit', arguments: '' } }] })
    + delta({ tool_calls: [{ function: { arguments: editArgs.slice(0, cut) } }] })
    + delta({ tool_calls: [{ function: { arguments: editArgs.slice(cut) } }] })
    + delta({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n',
  // 3 · the final answer, plus the trailing usage frame.
  delta({ content: 'Queued the revision for your review.' })
    + frame({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 40 } })
    + delta({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n',
]

const wire = []
await page.route('**/chat/completions', async (route) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
  try { wire.push(JSON.parse(route.request().postData() ?? '{}')) } catch { wire.push(null) }
  const body = TURNS[wire.length - 1] ?? TURNS[TURNS.length - 1]
  await route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/event-stream' }, body })
})

// Configure the provider the way an author does — through the settings screen.
await setAI(true)
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('AI Settings', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.seg button', { timeout: 10000 })
await page.locator('.seg button', { hasText: 'Custom' }).first().click()
await page.waitForTimeout(300)
const toolsBox = page.locator('label:has-text("Let the assistant use tools") input[type=checkbox]')
check('the tools switch is not labelled as one vendor’s privilege',
  !/claude only/i.test(await page.locator('label:has-text("Let the assistant use tools")').first().innerText()))
if ((await toolsBox.count()) && !(await toolsBox.isChecked())) await toolsBox.setChecked(true)
await page.locator('.ai-row:has-text("Base URL") input').first().fill(MOCK_BASE)
await page.locator('.ai-row:has-text("API Key") input').first().fill('sk-mock')
await page.locator('.ai-row:has-text("Model") input').first().fill('mock-tools-model')
await page.waitForTimeout(300)
await page.locator('.tab-x').last().click()
await page.waitForTimeout(400)

const sc2Disk = await readBundle(page, 'docs/sc2.md')
const sc2Snaps = await listBundle(page, 'snapshots/sc2')

// Ask the assistant to revise a scene it has to go and read first.
await page.locator('.rail-tabs > button').filter({ hasText: 'Chat' }).first().click()
  .catch(() => page.locator('.rail-tabs > button[title="Chat"]').first().click())
await page.waitForSelector('.asst-input textarea', { timeout: 10000 })
await page.locator('.asst-input textarea').fill('Read Scene 3 and propose a revision.')
await page.keyboard.press('Enter')

await page.waitForSelector('.cs-body', { timeout: 20000 }).catch(() => {})

check('the assistant called out to the OpenAI-compatible endpoint', wire.length >= 1, wire.length)
const req1 = wire[0] ?? {}
const toolNames = (req1.tools ?? []).map((t) => t?.function?.name)
check('it advertised the tools in OpenAI function-schema form',
  Array.isArray(req1.tools) && req1.tools.every((t) => t.type === 'function' && !!t.function?.parameters)
    && toolNames.includes('get_document') && toolNames.includes('propose_edit'),
  toolNames)
check('it left the choice of tool to the model', req1.tool_choice === 'auto', req1.tool_choice)
check('it sent the provider’s own model, not a Claude id',
  req1.model === 'mock-tools-model', req1.model)
check('the config tools stay unadvertised until the author opts in',
  !toolNames.includes('propose_config'), toolNames)

// The second request is the real proof: results have to go back in the shape
// the endpoint expects, or the model is answering into a void.
const msgs2 = wire[1]?.messages ?? []
const asstTurn = msgs2.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
const toolMsg = msgs2.find((m) => m.role === 'tool')
check('the assistant’s tool_calls turn is replayed back to the endpoint',
  asstTurn?.tool_calls?.[0]?.function?.name === 'get_document', asstTurn?.tool_calls)
check('the tool result comes back as a role:"tool" message on the right id',
  !!toolMsg && toolMsg.tool_call_id === asstTurn?.tool_calls?.[0]?.id,
  { got: toolMsg?.tool_call_id, want: asstTurn?.tool_calls?.[0]?.id })
check('the tool actually ran and returned the document’s real text',
  !!sc2Disk && !!toolMsg && toolMsg.content.includes(sc2Disk.trim().slice(0, 40)),
  toolMsg?.content?.slice(0, 80))
check('arguments split across frames were reassembled (the edit named its document)',
  (wire[2]?.messages ?? []).some((m) => m.role === 'tool' && /Changeset/.test(m.content ?? '')),
  (wire[2]?.messages ?? []).filter((m) => m.role === 'tool').map((m) => m.content?.slice(0, 60)))
check('the loop kept going despite finish_reason:"stop" on a tool turn', wire.length >= 3, wire.length)

// And the invariant itself: an AI edit is still only ever a proposal.
check('the AI edit opened a changeset review instead of writing',
  await page.locator('.cs-body').count() === 1)
const sc2During = await readBundle(page, 'docs/sc2.md')
check('nothing reached the .md while the AI edit was only proposed',
  sc2During === sc2Disk && !sc2During.includes(AI_MARKER), sc2During?.slice(0, 60))

await page.locator('.modal-foot .btn.primary').click()
await page.waitForTimeout(900)
const sc2After = await readBundle(page, 'docs/sc2.md')
check('accepting the AI edit writes it to disk', !!sc2After && sc2After.includes(AI_MARKER), sc2After?.slice(0, 80))
const sc2SnapsAfter = await listBundle(page, 'snapshots/sc2')
const sc2New = sc2SnapsAfter.filter((s2) => !sc2Snaps.includes(s2))
check('the AI edit was snapshotted before it was applied', sc2New.length > 0, { sc2Snaps, sc2SnapsAfter })
if (sc2New.length) {
  const before = await readBundle(page, `snapshots/sc2/${sc2New[0]}`)
  check('the snapshot is the pre-AI text', !!before && !before.includes(AI_MARKER), before?.slice(0, 60))
}

// The chat surfaces what the assistant did, so the author can audit the turn.
const chatText = await page.locator('.asst-chat').innerText().catch(() => '')
check('the conversation names the tools that ran', /Read "Scene 3"/.test(chatText), chatText.slice(-200))

await page.unroute('**/chat/completions')

// ── adventure mode ──────────────────────────────────────────────────────────
section('Adventure · drafting only ever appends, and every append is undoable')

// Adventure writes into the real manuscript, so its safety story is different
// from every other AI surface: no changeset gate (there is nothing to review —
// the text is new), but a snapshot before every append and a step-back that
// puts the manuscript *and* the outline back exactly as they were. That claim
// is only worth anything measured against persisted bytes.

const ADV_PASSAGE = 'ADVENTURE_PASSAGE He broke the seal with his thumb.'
const advSeen = []
await page.route('**/chat/completions', async (route) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
  }
  if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
  const body = JSON.parse(route.request().postData() ?? '{}')
  const prompt = (body.messages ?? []).map((m) => m.content).join('\n')
  const kind = /directions the story could take/.test(prompt) ? 'options'
    : /Continue directly from the preceding text/.test(prompt) ? 'passage'
    : /story bible editor/.test(prompt) ? 'notes'
    : /running summary of a novel/.test(prompt) ? 'summary'
    : 'other'
  advSeen.push(kind)
  const reply = {
    options: '[{"text":"He opens the letter"},{"text":"He rows for the far bank"}]',
    passage: ADV_PASSAGE,
    notes: '[{"name":"Vass","category":"character","summary":"The ferryman.","facts":[{"label":"role","value":"ferryman"}]}]',
    summary: 'A ferryman finds a letter addressed to himself.',
    other: '',
  }[kind]
  await route.fulfill({
    status: 200,
    headers: { ...cors, 'content-type': 'text/event-stream' },
    body: delta({ role: 'assistant', content: '' }) + delta({ content: reply }) + delta({}, { finish_reason: 'stop' }) + 'data: [DONE]\n\n',
  })
})

await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
await page.keyboard.type('Adventure', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.adv-setup', { timeout: 10000 }).catch(() => {})
check('Adventure opens on a setup screen, not straight into generation',
  await page.locator('.adv-setup').count() === 1)
check('it offers to continue from prose that already exists',
  await page.locator('.adv-setup-mode button').first().innerText().catch(() => '') === 'Continue from here')

await page.locator('.adv-start').click()
await page.waitForSelector('.adv-deck', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(900)
const cardValues = await page.locator('.adv-card-text').evaluateAll((els) => els.map((e) => e.value))
check('picking up from a scene offers a deck of beats', cardValues.length === 2, cardValues)
check('the beats are the model\'s directions, editable in place',
  cardValues[0] === 'He opens the letter', cardValues)
check('the author\'s own beat is offered alongside them',
  await page.locator('.adv-own textarea').count() === 1)

const advDoc = 'docs/sc2.md'
const advBefore = await readBundle(page, advDoc)
const advSnapsBefore = await listBundle(page, 'snapshots/sc2')

await page.locator('.adv-card-num').first().click()
await page.waitForTimeout(3500)

const advAfter = await readBundle(page, advDoc)
check('choosing a beat appends its prose to the scene on disk',
  !!advAfter && advAfter.includes(ADV_PASSAGE), advAfter?.slice(-80))
check('the append leaves what was already written untouched',
  !!advAfter && !!advBefore && advAfter.startsWith(advBefore.trimEnd()), advAfter?.slice(0, 60))
const advSnapsAfter = await listBundle(page, 'snapshots/sc2')
const advNewSnaps = advSnapsAfter.filter((s2) => !advSnapsBefore.includes(s2))
check('a snapshot was taken before the passage was written', advNewSnaps.length > 0, { advSnapsBefore, advSnapsAfter })
if (advNewSnaps.length) {
  const body = await readBundle(page, `snapshots/sc2/${advNewSnaps[0]}`)
  check('the snapshot is the pre-passage text, so step back is exact',
    !!body && !body.includes(ADV_PASSAGE), body?.slice(-60))
}
check('the deck, notes and summary all ran for one beat',
  advSeen.filter((k) => k === 'passage').length === 1
  && advSeen.includes('notes') && advSeen.includes('summary'), advSeen)

// The outline is written as a side effect of drafting.
const manifestAdv = JSON.parse(await readBundle(page, 'project.json'))
const spine = Object.values(manifestAdv.nodes).find((n) => n.title === 'Story spine')
check('the chosen beats are mirrored into a binder document', !!spine,
  Object.values(manifestAdv.nodes).map((n) => n.title))
if (spine) {
  const spineBody = await readBundle(page, `docs/${spine.id}.md`)
  check('the spine records the beat that was chosen',
    !!spineBody && spineBody.includes('He opens the letter'), spineBody)
}

// Nothing is filed to the codex without the author.
check('what the assistant noticed waits in an inbox',
  /Vass/.test(await page.locator('.adv-notes').innerText().catch(() => '')))
check('and is NOT in the codex until it is accepted',
  !(await readBundle(page, 'codex.json') ?? '').includes('Vass'))
await page.locator('.adv-note-act .btn.primary').first().click()
await page.waitForTimeout(700)
check('accepting it writes the entry to the codex sidecar',
  (await readBundle(page, 'codex.json') ?? '').includes('Vass'))

// Step back: the whole beat comes off, manuscript and outline together.
await page.locator('.adv-strip button:has-text("Step back")').click()
await page.waitForTimeout(1600)
const advUndone = await readBundle(page, advDoc)
check('stepping back removes the passage from disk',
  !!advUndone && !advUndone.includes(ADV_PASSAGE), advUndone?.slice(-60))
check('stepping back restores exactly what was there before', advUndone === advBefore)
if (spine) {
  const spineBody = await readBundle(page, `docs/${spine.id}.md`)
  check('stepping back also un-writes the outline — no orphan beat',
    !(spineBody ?? '').includes('He opens the letter'), spineBody)
}

await page.unroute('**/chat/completions')
await page.locator('.tab-x').last().click()
await page.waitForTimeout(400)
await setAI(false)
check('Adventure is not offered with AI switched off (invariant 1)',
  !(await railTabs()).includes('Adventure')
  && await page.locator('.adv-deck').count() === 0)

// ── contrast floors ─────────────────────────────────────────────────────────
section('Contrast · the muted text ramp clears WCAG AA in every theme')

const measureContrast = () => page.evaluate(() => {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const ctx = cv.getContext('2d')
  const rgb = (c) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1)
    ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  const lum = (c) => {
    const [r, g, b] = rgb(c)
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (hi + 0.05) / (lo + 0.05)
  }
  const root = document.documentElement
  const val = (t) => getComputedStyle(root).getPropertyValue(t).trim()
  const SURFACES = ['--bg', '--bg-2', '--bg-3', '--editor-bg', '--sidebar']
  // --dim is decorative and disabled marks, so AA Large (3:1); the rest carry
  // information and take the full 4.5:1.
  const FLOORS = { '--text': 4.5, '--text-2': 4.5, '--text-3': 4.5, '--dim': 3.0 }

  const worst = []
  const measure = (name) => {
    for (const [tok, floor] of Object.entries(FLOORS)) {
      for (const s of SURFACES) {
        const r = ratio(val(tok), val(s))
        if (r < floor) worst.push({ theme: name, token: tok, on: s, ratio: +r.toFixed(2), floor })
      }
    }
    // Blockquotes are prose and sit on the editor background specifically.
    const q = ratio(val('--hl-quote'), val('--editor-bg'))
    if (q < 4.5) worst.push({ theme: name, token: '--hl-quote', on: '--editor-bg', ratio: +q.toFixed(2), floor: 4.5 })
  }

  measure(document.querySelector('.thm-card.on .thm-name')?.textContent?.trim() ?? root.dataset.theme)
  return worst
})
// Sweep every skin through the app's own Themes screen, so the real derivation
// engine (including the contrast clamp) is what gets measured.
await page.keyboard.press('Control+k')
await page.waitForTimeout(300)
// "Skins" rather than "Themes": the latter also matches the Layout command
// "Theme: switch to Light", which ranks first and would just flip the theme.
await page.keyboard.type('Skins', { delay: 20 })
await page.waitForTimeout(400)
await page.keyboard.press('Enter')
await page.waitForSelector('.thm-card', { timeout: 10000 })
const cards = await page.locator('.thm-card').count()
check('the Themes screen lists the built-in skins', cards >= 5, cards)

const allFailures = []
for (let i = 0; i < cards; i++) {
  await page.locator('.thm-card .thm-apply').nth(i).click()
  await page.waitForTimeout(350)
  allFailures.push(...await measureContrast())
}
check(`the muted ramp clears its floor on every surface, across ${cards} skins`,
  allFailures.length === 0, allFailures.slice(0, 8))

// ── document structure ─────────────────────────────────────────────────────
section('Structure · a screen reader gets landmarks and a heading')

const structure = await page.evaluate(() => ({
  h1: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
  landmarks: [...document.querySelectorAll('header, nav, main, aside, footer, [role=main], [role=navigation], [role=complementary], [role=contentinfo], [role=banner]')]
    .map((e) => e.getAttribute('role') ?? e.tagName.toLowerCase()),
  tree: !!document.querySelector('[role=tree]'),
  treeitems: document.querySelectorAll('[role=treeitem]').length,
  tabStops: document.querySelectorAll('[role=treeitem][tabindex="0"]').length,
}))
check('the page has exactly one h1, and it names the project',
  structure.h1.length === 1 && structure.h1[0] === 'Smoke', structure.h1)
check('the shell exposes landmarks (banner/nav/main/complementary/contentinfo)',
  ['header', 'nav', 'main', 'aside', 'footer'].every((r) => structure.landmarks.includes(r)),
  structure.landmarks)
check('the binder is a tree with treeitem rows', structure.tree && structure.treeitems > 0, structure)
check('the tree has exactly one tab stop (roving tabindex)', structure.tabStops === 1, structure.tabStops)

// ── nothing threw ───────────────────────────────────────────────────────────
section('No uncaught errors')
check('no uncaught page errors during the run', pageErrors.length === 0, pageErrors)

await browser.close()

console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${ran - failed}/${ran} checks passed\x1b[0m`)
process.exit(failed === 0 ? 0 : 1)
