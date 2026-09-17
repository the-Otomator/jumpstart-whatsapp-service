import {
  GoogleGenerativeAI,
  Content,
  FunctionDeclarationsTool,
  GenerateContentResult,
} from '@google/generative-ai'
import { createClient } from '@supabase/supabase-js'
import type { ChatMessage, BotTool } from '../types'
import { logger } from '../lib/logger'

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

/** Max length for a model id — keeps callers from stuffing arbitrary long strings. */
const MAX_MODEL_LEN = 64
const MODEL_REGISTRY_MODULE = 'whatsapp_bot'
export const MODEL_REGISTRY_CACHE_TTL_MS = 90_000

type FallbackReason = 'not_in_catalog' | 'other'

export interface ModelFallbackRecord {
  organization_id: string
  module_key: typeof MODEL_REGISTRY_MODULE
  requested_model: string
  used_model: string
  reason: FallbackReason
  provider_error: string | null
}

export interface ModelRegistry {
  resolve(organizationId: string, moduleKey: string): Promise<string | null>
  logFallback(record: ModelFallbackRecord): Promise<void>
}

export interface ModelResolution {
  model: string
  source: 'registry' | 'request' | 'env' | 'default'
  fallbackReason: FallbackReason | null
}

const registryCache = new Map<string, { model: string | null; expiresAt: number }>()
let platformRegistry: ModelRegistry | null = null

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

function getPlatformRegistry(): ModelRegistry {
  if (platformRegistry) return platformRegistry
  const url = process.env.BOT_SUPABASE_URL
  const serviceKey = process.env.BOT_SUPABASE_SERVICE_KEY
  if (!url || !serviceKey) throw new Error('Bot platform registry credentials are not set')
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  platformRegistry = {
    async resolve(organizationId, moduleKey) {
      const { data, error } = await client.rpc('resolve_ai_model', {
        p_org_id: organizationId,
        p_module_key: moduleKey,
      })
      if (error) throw error
      return typeof data === 'string' && data.trim() ? data.trim() : null
    },
    async logFallback(record) {
      const { error } = await client.from('ai_model_fallback_log').insert(record)
      if (error) throw error
    },
  }
  return platformRegistry
}

async function recordFallback(registry: ModelRegistry, record: ModelFallbackRecord): Promise<void> {
  try {
    await registry.logFallback(record)
  } catch (err) {
    logger.error({ err, org: record.organization_id }, 'Failed to record AI model fallback')
  }
}

/** Registry is authoritative. The request is a guarded compatibility fallback when
 * no registry entry exists; the environment is emergency-only for registry outages. */
export async function resolveGeminiModel(
  organizationId: string,
  requestModel?: string | null,
  envModel: string | undefined | null = process.env.GEMINI_MODEL,
  registry?: ModelRegistry,
  now: number = Date.now(),
): Promise<ModelResolution> {
  let activeRegistry = registry
  let registryModel: string | null
  try {
    activeRegistry ??= getPlatformRegistry()
    const cached = registryCache.get(organizationId)
    if (cached && cached.expiresAt > now) {
      registryModel = cached.model
    } else {
      registryModel = await activeRegistry.resolve(organizationId, MODEL_REGISTRY_MODULE)
      registryCache.set(organizationId, { model: registryModel, expiresAt: now + MODEL_REGISTRY_CACHE_TTL_MS })
    }
  } catch (err) {
    const model = isValidGeminiModel(envModel) ? envModel.trim() : DEFAULT_GEMINI_MODEL
    const fallbackRecord: ModelFallbackRecord = {
      organization_id: organizationId,
      module_key: MODEL_REGISTRY_MODULE,
      requested_model: isValidGeminiModel(requestModel) ? requestModel.trim() : DEFAULT_GEMINI_MODEL,
      used_model: model,
      reason: 'other',
      provider_error: err instanceof Error ? err.message : String(err),
    }
    if (activeRegistry) await recordFallback(activeRegistry, fallbackRecord)
    else logger.error({ err, org: organizationId }, 'AI model registry unavailable before fallback could be recorded')
    return { model, source: model === DEFAULT_GEMINI_MODEL ? 'default' : 'env', fallbackReason: 'other' }
  }

  if (registryModel !== null) return { model: registryModel, source: 'registry', fallbackReason: null }

  const model = isValidGeminiModel(requestModel) ? requestModel.trim() : DEFAULT_GEMINI_MODEL
  await recordFallback(activeRegistry!, {
    organization_id: organizationId,
    module_key: MODEL_REGISTRY_MODULE,
    requested_model: model,
    used_model: model,
    reason: 'not_in_catalog',
    provider_error: null,
  })
  return { model, source: model === DEFAULT_GEMINI_MODEL ? 'default' : 'request', fallbackReason: 'not_in_catalog' }
}

export function clearGeminiModelCacheForTests(): void {
  registryCache.clear()
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
  modelName: string,
  systemPrompt?: string,
): Promise<GeminiResponse> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not set')

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
