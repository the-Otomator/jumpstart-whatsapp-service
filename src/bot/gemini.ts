import {
  GoogleGenerativeAI,
  Content,
  FunctionDeclarationsTool,
  GenerateContentResult,
} from '@google/generative-ai'
import type { ChatMessage, BotTool } from '../types'
import { logger } from '../lib/logger'

const MODEL = 'gemini-2.0-flash'

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful WhatsApp assistant. Reply concisely in the same language the user writes in.'

export interface GeminiResponse {
  text: string | null
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>
  promptTokens: number
  completionTokens: number
}

export async function callGemini(
  messages: ChatMessage[],
  tools: BotTool[],
  systemPrompt?: string,
): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

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
    model: MODEL,
    systemInstruction: systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    tools: geminiTools.length > 0 ? geminiTools : undefined,
  })

  const contents: Content[] = messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }))

  let result: GenerateContentResult
  try {
    result = await model.generateContent({ contents })
  } catch (err) {
    logger.error({ err }, 'Gemini API call failed')
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
  }
}
