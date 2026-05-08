import { logger } from './logger'
import type { IntentRule } from './intentRulesStore'

export interface ClassificationResult {
  intent: string | null
  intentLabel: string | null
  confidence: number
  allScores: Record<string, number>
}

const TIMEOUT_MS = Number(process.env.INTENT_CLASSIFIER_TIMEOUT_MS) || 3000
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

export async function classifyMessage(
  text: string,
  rules: IntentRule[]
): Promise<ClassificationResult | null> {
  if (!rules.length || !text.trim()) return null

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set - skipping classification')
    return null
  }

  const intentsBlock = rules
    .map((rule) => {
      const examplesLine = rule.examples.length
        ? `  examples: ${JSON.stringify(rule.examples)}`
        : ''
      return [
        `- name: "${rule.name}"`,
        `  description: "${rule.description}"`,
        examplesLine,
      ].filter(Boolean).join('\n')
    })
    .join('\n')

  const prompt = `Classify the following WhatsApp message into ONE of the intents listed below.
Return ONLY valid JSON with shape: {"intent": "<name or null>", "confidence": <0-1>, "scores": {<name>: <0-1>}}.
If no intent fits well, set intent to null and confidence to 0.

Intents:
${intentsBlock}

Message: ${JSON.stringify(text)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        }),
        signal: controller.signal,
      }
    )
    clearTimeout(timer)

    if (!res.ok) {
      logger.warn({ status: res.status }, 'Gemini API returned non-OK')
      return null
    }

    const json = await res.json() as any
    const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!raw) return null

    const parsed = JSON.parse(raw)
    const intentName: string | null = parsed.intent ?? null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    const allScores: Record<string, number> = parsed.scores ?? {}
    const matchedRule = rules.find((rule) => rule.name === intentName)

    return {
      intent: intentName,
      intentLabel: matchedRule?.label ?? null,
      confidence,
      allScores,
    }
  } catch (err: unknown) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      logger.warn('Intent classification timed out')
    } else {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'Intent classification error')
    }
    return null
  }
}
