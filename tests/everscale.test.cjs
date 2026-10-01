const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const vm = require('node:vm')

const script = readFileSync(new URL('../widget.html', `file://${__filename}`), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1]
const now = 1790881800000
const block = {
  id: 'a'.repeat(64), gen_utime: now / 1000 - 3,
  workchain_id: -1, shard: '8000000000000000', seq_no: 62539000,
}
function response() {
  return {
    data: { all: ['120', '600'], mc: ['30', '150'], wc: ['90', '450'], blocks: [block] },
  }
}
function context(fetch = async () => ({ ok: true, json: async () => response() })) {
  const ctx = vm.createContext({ fetch, AbortSignal, window: { addEventListener() {} } })
  vm.runInContext(script, ctx)
  return ctx
}

test('computes all rates over the same complete minute, using all blocks', async () => {
  let request
  const ctx = context(async (url, options) => {
    request = { url, ...options }
    return { ok: true, json: async () => response() }
  })
  const result = await ctx.fetchEverscaleLoad(now)
  assert.equal(result.bps, '2.0')
  assert.equal(result.tps, '10.0')
  assert.equal(result.tpsMC, '2.50')
  assert.equal(result.tpsWC0, '7.50')
  assert.equal(result.latest.id, block.id)
  assert.match(request.url, /^https:\/\/mainnet\.evercloud\.dev\/.+\/graphql$/)
  assert.equal(request.method, 'POST')
  assert.equal(request.cache, 'no-store')
  assert.ok(request.signal instanceof AbortSignal)
  const query = JSON.parse(request.body).query
  assert.equal(query.match(/gen_utime: \{ gt: 1790881730, le: 1790881790 \}/g).length, 3)
  assert.match(query, /orderBy: \[\{ path: "gen_utime", direction: DESC \}\]/)
})

test('repeated snapshots do not double count; later snapshots replace prior load', async () => {
  const payload = response()
  const ctx = context(async () => ({ ok: true, json: async () => payload }))
  assert.equal((await ctx.fetchEverscaleLoad(now)).tps, '10.0')
  assert.equal((await ctx.fetchEverscaleLoad(now)).tps, '10.0')
  payload.data.all = ['30', '0']
  payload.data.mc = ['30', '0']
  payload.data.wc = ['0', null]
  const result = await ctx.fetchEverscaleLoad(now)
  assert.equal(result.bps, '0.5')
  assert.equal(result.tps, '0.0')
  assert.equal(result.tpsMC, '0.00')
  assert.equal(result.tpsWC0, '0.00')
})

test('empty aggregates render zero without interpreting missing data as zero', async () => {
  const payload = response()
  for (const key of ['all', 'mc', 'wc']) payload.data[key] = ['0', null]
  const result = await context(async () => ({ ok: true, json: async () => payload })).fetchEverscaleLoad(now)
  assert.equal(result.bps, '0.0')
  assert.equal(result.tps, '0.0')
})

for (const [name, alter, message] of [
  ['GraphQL errors despite HTTP 200', p => { p.errors = [{ message: 'unavailable' }] }, /query failed/],
  ['missing data', p => { delete p.data }, /Invalid.*block/],
  ['empty block list', p => { p.data.blocks = [] }, /Invalid.*block/],
  ['stale head', p => { p.data.blocks = [{ ...block, gen_utime: now / 1000 - 31 }] }, /stale/],
  ['future head', p => { p.data.blocks = [{ ...block, gen_utime: now / 1000 + 31 }] }, /clock/],
  ['invalid block fields', p => { p.data.blocks = [{ ...block, shard: '<script>' }] }, /Invalid.*block/],
  ['invalid software version', p => { p.data.blocks = [{ ...block, gen_software_version: '<script>' }] }, /Invalid.*block/],
  ['null transaction sum with blocks', p => { p.data.all[1] = null }, /transaction count/],
  ['missing aggregate', p => { delete p.data.mc }, /counters/],
  ['null block count', p => { p.data.all[0] = null }, /counters/],
  ['negative counter', p => { p.data.all[1] = '-1' }, /transaction count/],
  ['unsafe integer', p => { p.data.all[1] = '9007199254740992' }, /transaction count/],
  ['inconsistent workchain totals', p => { p.data.all[1] = '599' }, /Inconsistent/],
]) {
  test(`rejects ${name}`, async () => {
    const payload = response()
    alter(payload)
    const ctx = context(async () => ({ ok: true, json: async () => payload }))
    await assert.rejects(ctx.fetchEverscaleLoad(now), message)
  })
}

test('rejects HTTP errors and propagates network timeouts', async () => {
  await assert.rejects(context(async () => ({ ok: false, status: 503 })).fetchEverscaleLoad(now), /HTTP 503/)
  await assert.rejects(context(async () => { throw new Error('timeout') }).fetchEverscaleLoad(now), /timeout/)
})

test('polling clears displayed rates on error and restores them on recovery', () => {
  const ctx = context()
  const values = {}
  const output = { textContent: '' }
  let poll
  ctx.createMetric = () => ({
    elem: { updateElem: (key, value) => { values[key] = value }, querySelector: () => output },
    log: value => { output.textContent = value },
  })
  ctx.startLongPolling = options => { poll = options }
  ctx.blockPollingEverscale({}, 'ever-main')
  const snapshot = { latest: block, bps: '2.0', tps: '10.0', tpsMC: '2.50', tpsWC0: '7.50' }
  poll.onBatch(snapshot)
  assert.equal(values.tps, '10.0')
  poll.onError(new Error('unavailable'))
  assert.deepEqual(Object.values(values), ['...', '...', '...', '...'])
  assert.equal(output.textContent, 'ERROR: unavailable')
  poll.onBatch(snapshot)
  assert.equal(values.tps, '10.0')
  assert.match(output.textContent, /62539000/)
})

test('mainnet selects HTTP polling; testnet and Venom retain their subscriptions', () => {
  const ctx = context()
  const calls = []
  ctx.blockPollingEverscale = (_, network) => calls.push(['poll', network])
  ctx.blockSubscriptionEverX = (_, network) => calls.push(['subscription', network])
  for (const network of ['ever-main', 'ever-test', 'venom-main']) ctx.loadWidget({}, network)
  assert.deepEqual(calls, [['poll', 'ever-main'], ['subscription', 'ever-test'], ['subscription', 'venom-main']])
  assert.equal(ctx.explorerBlock('ever-main', block), 'https://evertx.us/validators')
  assert.match(ctx.explorerBlock('venom-main', block), /^https:\/\/venomscan.com\/blocks\//)
})
