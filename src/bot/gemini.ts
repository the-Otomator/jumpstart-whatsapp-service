import {
  GoogleGenerativeAI,
  Content,
  FunctionDeclarationsTool,
  GenerateContentResult,
} from '@google/generative-ai'
import type { ChatMessage, BotTool } from '../types'
import { logger } from '../lib/logger'

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

/** Max length for a model id — keeps callers from stuffing arbitrary long strings. */
const MAX_MODEL_LEN = 64

/**
 * Accept only Gemini model ids (`gemini-*`). Invalid values must not be passed
 * through to the API (request body is untrusted).
 */
export function isValidGeminiModel(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_MODEL_LEN) return false
  return /^gemini-[a-zA-Z0-9._-]+$/.test(trimmed)
}

/**
 * Precedence: request body → GEMINI_MODEL env → built-in default.
 * Invalid request/env values fall back to the next tier (never passed through).
 */
export function resolveGeminiModel(
  requestModel?: string | null,
  envModel: string | undefined | null = process.env.GEMINI_MODEL,
): string {
  if (isValidGeminiModel(requestModel)) return requestModel.trim()
  if (isValidGeminiModel(envModel)) return envModel.trim()
  return DEFAULT_GEMINI_MODEL
}

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful WhatsApp assistant. Reply concisely in the same language the user writes in.'

export interface GeminiResponse {
  text: string | null
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>
  promptTokens: number
  completionTokens: number
  model: string
}

export async function callGemini(
  messages: ChatMessage[],
  tools: BotTool[],
  systemPrompt?: string,
  requestModel?: string | null,
): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

  const modelName = resolveGeminiModel(requestModel)
  logger.info({ model: modelName }, 'Gemini model selected')

  const genAI = new GoogleGenerativeAI(apiKey)

  const geminiTools: FunctionDeclarationsTool[] =
    tools.length > 0
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters as FunctionDeclarationsTool['functionDeclarations'] extends
                Array<infer D>
                ? D extends { parameters?: infer P }
                  ? P
                  : never
                : never,
            })),
          },
        ]
      : []

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    tools: geminiTools.length > 0 ? geminiTools : undefined,
  })

  const contents: Content[] = messages.map((m) => ({
    role: m.role,
    parts: m.parts,
  }))

  let result: GenerateContentResult
  try {
    result = await model.generateContent({ contents })
  } catch (err) {
    logger.error({ err, model: modelName }, 'Gemini API call failed')
    throw err
  }

  const response = result.response
  const candidate = response.candidates?.[0]
  const parts = candidate?.content?.parts ?? []

  const textParts = parts.filter((p) => 'text' in p && p.text).map((p) => (p as { text: string }).text)
  const text = textParts.length > 0 ? textParts.join('') : null

  const functionCalls = parts
    .filter((p) => 'functionCall' in p && p.functionCall)
    .map((p) => {
      const fc = (p as { functionCall: { name: string; args: Record<string, unknown> } }).functionCall
      return { name: fc.name, args: fc.args ?? {} }
    })

  const usage = response.usageMetadata
  return {
    text,
    functionCalls,
    promptTokens: usage?.promptTokenCount ?? 0,
    completionTokens: usage?.candidatesTokenCount ?? 0,
    model: modelName,
  }
}
