/** Platform-registry model resolution. Run with ts-node. */
import assert from 'assert'
import {
  DEFAULT_GEMINI_MODEL,
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
  constructor(
    private readonly value: string | null,
    private readonly resolveError?: Error,
    private readonly logError?: Error,
  ) {}
  async resolve(): Promise<string | null> {
    this.resolveCalls += 1
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

async function testResolution(): Promise<void> {
  clearGeminiModelCacheForTests()
  const registryWins = new FakeRegistry('gemini-registry')
  const selected = await resolveGeminiModel(ORG_ID, 'gemini-request', 'gemini-env', registryWins, 0)
  assert.deepStrictEqual(selected, { model: 'gemini-registry', source: 'registry', fallbackReason: null })
  assert.strictEqual(registryWins.records.length, 0)
  const cached = await resolveGeminiModel(ORG_ID, undefined, 'gemini-env', registryWins, 45_000)
  assert.strictEqual(cached.model, 'gemini-registry')
  assert.strictEqual(registryWins.resolveCalls, 1)
  await resolveGeminiModel(ORG_ID, undefined, 'gemini-env', registryWins, 90_001)
  assert.strictEqual(registryWins.resolveCalls, 2)

  clearGeminiModelCacheForTests()
  const nonGeminiRegistry = new FakeRegistry('claude-registry-model')
  const nonGemini = await resolveGeminiModel(ORG_ID, undefined, 'gemini-env', nonGeminiRegistry)
  assert.strictEqual(nonGemini.model, 'claude-registry-model')
  assert.strictEqual(nonGemini.source, 'registry')

  clearGeminiModelCacheForTests()
  const missingRegistry = new FakeRegistry(null)
  const requestFallback = await resolveGeminiModel(ORG_ID, 'gemini-request', 'gemini-env-must-not-win', missingRegistry)
  assert.strictEqual(requestFallback.model, 'gemini-request')
  assert.strictEqual(missingRegistry.records[0].reason, 'not_in_catalog')

  clearGeminiModelCacheForTests()
  const outage = new FakeRegistry(null, new Error('registry unavailable'))
  const emergency = await resolveGeminiModel(ORG_ID, 'gpt-is-untrusted', 'gemini-emergency', outage)
  assert.strictEqual(emergency.model, 'gemini-emergency')
  assert.strictEqual(emergency.fallbackReason, 'other')
  assert.strictEqual(outage.records[0].used_model, 'gemini-emergency')
  assert.strictEqual(outage.records[0].provider_error, 'registry unavailable')

  clearGeminiModelCacheForTests()
  const outageWithoutValidEnv = new FakeRegistry(null, new Error('registry timeout'))
  const builtIn = await resolveGeminiModel(ORG_ID, undefined, 'claude-env-is-invalid', outageWithoutValidEnv)
  assert.strictEqual(builtIn.model, DEFAULT_GEMINI_MODEL)
  assert.strictEqual(outageWithoutValidEnv.records[0].used_model, DEFAULT_GEMINI_MODEL)

  clearGeminiModelCacheForTests()
  const failedLog = new FakeRegistry(null, new Error('registry offline'), new Error('insert denied'))
  const stillAnswers = await resolveGeminiModel(ORG_ID, undefined, 'gemini-emergency', failedLog)
  assert.strictEqual(stillAnswers.model, 'gemini-emergency')

  console.log(`observed model: ${emergency.model}`)
  console.log(`observed fallback reason: ${outage.records[0].reason}`)
}

async function main(): Promise<void> {
  testValidation()
  await testResolution()
  console.log('gemini.test.ts: all passed')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
