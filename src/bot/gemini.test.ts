/** Platform-registry model resolution. Run with ts-node. */
import assert from 'assert'
import {
  DEFAULT_GEMINI_MODEL,
  MODEL_REGISTRY_OUTAGE_TTL_MS,
  MODEL_REGISTRY_TIMEOUT_MS,
  ModelFallbackRecord,
  ModelRegistry,
  clearGeminiModelCacheForTests,
  isValidGeminiModel,
  resolveGeminiModel,
} from './gemini'

const ORG_ID = '11111111-1111-4111-8111-111111111111'

class FakeRegistry implements ModelRegistry {
  readonly records: ModelFallbackRecord[] = []
  resolveCalls = 0
  value: string | null
  resolveError?: Error
  hang = false

  constructor(value: string | null, resolveError?: Error, private readonly logError?: Error) {
    this.value = value
    this.resolveError = resolveError
  }

  async resolve(): Promise<string | null> {
    this.resolveCalls += 1
    if (this.hang) return new Promise<string | null>(() => undefined)
    if (this.resolveError) throw this.resolveError
    return this.value
  }

  async logFallback(record: ModelFallbackRecord): Promise<void> {
    this.records.push(record)
    if (this.logError) throw this.logError
  }
}

function testValidation(): void {
  assert.strictEqual(isValidGeminiModel('gemini-2.5-flash'), true)
  assert.strictEqual(isValidGeminiModel('gemini-2.0-flash'), true)
  assert.strictEqual(isValidGeminiModel('  gemini-2.5-flash  '), true)
  assert.strictEqual(isValidGeminiModel('gpt-4'), false)
  assert.strictEqual(isValidGeminiModel('http://evil'), false)
  assert.strictEqual(isValidGeminiModel(''), false)
  assert.strictEqual(isValidGeminiModel(null), false)
  assert.strictEqual(isValidGeminiModel(undefined), false)
  assert.strictEqual(isValidGeminiModel('gemini-' + 'x'.repeat(100)), false)
}

async function testHealthyResolution(): Promise<void> {
  clearGeminiModelCacheForTests()
  const registry = new FakeRegistry('gemini-registry')
  const selected = await resolveGeminiModel(ORG_ID, 'gemini-request', 'gemini-env', registry, 0)
  assert.deepStrictEqual(selected, {
    model: 'gemini-registry',
    source: 'registry',
    fallbackReason: null,
    registryFailure: null,
  })
  await resolveGeminiModel(ORG_ID, undefined, 'gemini-env', registry, 45_000)
  assert.strictEqual(registry.resolveCalls, 1)
  await resolveGeminiModel(ORG_ID, undefined, 'gemini-env', registry, 90_001)
  assert.strictEqual(registry.resolveCalls, 2)

  clearGeminiModelCacheForTests()
  const nonGemini = await resolveGeminiModel(
    ORG_ID,
    undefined,
    'gemini-env',
    new FakeRegistry('claude-registry-model'),
  )
  assert.strictEqual(nonGemini.model, 'claude-registry-model')
}

async function testBoundedOutage(): Promise<{ messages: number; calls: number; writes: number }> {
  clearGeminiModelCacheForTests()
  const registry = new FakeRegistry(null, new Error('network unavailable'))
  const messages = 100
  for (let index = 0; index < messages; index += 1) {
    const result = await resolveGeminiModel(ORG_ID, undefined, 'gemini-emergency', registry, index)
    assert.strictEqual(result.model, 'gemini-emergency')
    assert.strictEqual(result.registryFailure, 'network')
  }
  assert.strictEqual(registry.resolveCalls, 1)
  assert.strictEqual(registry.records.length, 1)
  return { messages, calls: registry.resolveCalls, writes: registry.records.length }
}

async function testHangingRegistry(): Promise<number> {
  clearGeminiModelCacheForTests()
  const registry = new FakeRegistry(null)
  registry.hang = true
  const started = performance.now()
  const result = await resolveGeminiModel(ORG_ID, undefined, 'gemini-emergency', registry)
  const elapsed = Math.round(performance.now() - started)
  assert.strictEqual(result.model, 'gemini-emergency')
  assert.strictEqual(result.registryFailure, 'network')
  assert.ok(elapsed >= MODEL_REGISTRY_TIMEOUT_MS - 50, `timeout returned too early: ${elapsed}ms`)
  assert.ok(elapsed < MODEL_REGISTRY_TIMEOUT_MS + 500, `timeout exceeded bound margin: ${elapsed}ms`)
  return elapsed
}

async function testRecovery(): Promise<number> {
  clearGeminiModelCacheForTests()
  const registry = new FakeRegistry(null, new Error('temporary outage'))
  await resolveGeminiModel(ORG_ID, undefined, 'gemini-emergency', registry, 0)
  registry.resolveError = undefined
  registry.value = 'gemini-recovered'
  const stillCached = await resolveGeminiModel(
    ORG_ID,
    undefined,
    'gemini-emergency',
    registry,
    MODEL_REGISTRY_OUTAGE_TTL_MS - 1,
  )
  assert.strictEqual(stillCached.source, 'env')
  const recoveredAt = MODEL_REGISTRY_OUTAGE_TTL_MS + 1
  const recovered = await resolveGeminiModel(ORG_ID, undefined, 'gemini-emergency', registry, recoveredAt)
  assert.strictEqual(recovered.model, 'gemini-recovered')
  assert.strictEqual(recovered.source, 'registry')
  assert.strictEqual(registry.resolveCalls, 2)
  return recoveredAt
}

async function testMissingCredentialsDiagnostic(): Promise<void> {
  clearGeminiModelCacheForTests()
  const oldUrl = process.env.BOT_SUPABASE_URL
  const oldKey = process.env.BOT_SUPABASE_SERVICE_KEY
  delete process.env.BOT_SUPABASE_URL
  delete process.env.BOT_SUPABASE_SERVICE_KEY
  try {
    const missing = await resolveGeminiModel(ORG_ID, undefined, 'gemini-emergency', undefined, 0)
    assert.strictEqual(missing.registryFailure, 'configuration')
    assert.strictEqual(missing.model, 'gemini-emergency')
  } finally {
    if (oldUrl === undefined) delete process.env.BOT_SUPABASE_URL
    else process.env.BOT_SUPABASE_URL = oldUrl
    if (oldKey === undefined) delete process.env.BOT_SUPABASE_SERVICE_KEY
    else process.env.BOT_SUPABASE_SERVICE_KEY = oldKey
  }

  clearGeminiModelCacheForTests()
  const network = await resolveGeminiModel(
    ORG_ID,
    undefined,
    'gemini-emergency',
    new FakeRegistry(null, new Error('network outage')),
    0,
  )
  assert.strictEqual(network.registryFailure, 'network')
}

async function testFailedLogDoesNotFailResolution(): Promise<void> {
  clearGeminiModelCacheForTests()
  const failedLog = new FakeRegistry(null, new Error('registry offline'), new Error('insert denied'))
  const result = await resolveGeminiModel(ORG_ID, undefined, 'gemini-emergency', failedLog)
  assert.strictEqual(result.model, 'gemini-emergency')
}

async function main(): Promise<void> {
  testValidation()
  await testHealthyResolution()
  const bounded = await testBoundedOutage()
  const elapsed = await testHangingRegistry()
  const recoveredAt = await testRecovery()
  await testMissingCredentialsDiagnostic()
  await testFailedLogDoesNotFailResolution()
  console.log(`outage messages: ${bounded.messages}`)
  console.log(`registry attempts: ${bounded.calls}`)
  console.log(`fallback write attempts: ${bounded.writes}`)
  console.log(`latency cap: ${MODEL_REGISTRY_TIMEOUT_MS}ms; observed: ${elapsed}ms`)
  console.log(`recovery window: ${MODEL_REGISTRY_OUTAGE_TTL_MS}ms; observed recovery: ${recoveredAt}ms`)
  console.log('missing credentials: configuration; network outage: network')
  console.log('gemini.test.ts: all passed')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
