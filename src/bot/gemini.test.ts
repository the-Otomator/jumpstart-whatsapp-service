/**
 * Model resolution precedence for Gemini.
 * Run: npx ts-node --transpile-only src/bot/gemini.test.ts
 */
import assert from 'assert'
import {
  DEFAULT_GEMINI_MODEL,
  isValidGeminiModel,
  resolveGeminiModel,
} from './gemini'

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

function testPrecedence(): void {
  // Request wins over env
  assert.strictEqual(
    resolveGeminiModel('gemini-2.0-flash', 'gemini-2.5-pro'),
    'gemini-2.0-flash',
  )

  // Env wins over default when request absent
  assert.strictEqual(
    resolveGeminiModel(undefined, 'gemini-2.5-pro'),
    'gemini-2.5-pro',
  )
  assert.strictEqual(resolveGeminiModel(null, 'gemini-2.5-pro'), 'gemini-2.5-pro')

  // Default when neither set
  assert.strictEqual(resolveGeminiModel(undefined, undefined), DEFAULT_GEMINI_MODEL)
  assert.strictEqual(resolveGeminiModel(null, null), DEFAULT_GEMINI_MODEL)

  // Invalid request falls back to env (not passed through)
  assert.strictEqual(
    resolveGeminiModel('gpt-4', 'gemini-2.5-pro'),
    'gemini-2.5-pro',
  )
  assert.strictEqual(
    resolveGeminiModel('https://evil.example/model', 'gemini-2.5-pro'),
    'gemini-2.5-pro',
  )

  // Invalid request + invalid env → default
  assert.strictEqual(resolveGeminiModel('not-a-model', 'also-bad'), DEFAULT_GEMINI_MODEL)

  // Invalid env alone → default
  assert.strictEqual(resolveGeminiModel(undefined, 'claude-3'), DEFAULT_GEMINI_MODEL)

  assert.strictEqual(DEFAULT_GEMINI_MODEL, 'gemini-2.5-flash')
}

testValidation()
testPrecedence()
console.log('gemini.test.ts: all passed')
