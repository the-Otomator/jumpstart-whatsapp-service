import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../lib/logger'

export function createTenantClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function createBotRun(
  tenant: SupabaseClient,
  params: {
    organizationId: string
    conversationId: string
    triggerMessageId: string
    model: string
  },
): Promise<string> {
  const { data, error } = await tenant
    .from('wa_bot_runs')
    .insert({
      organization_id: params.organizationId,
      conversation_id: params.conversationId,
      trigger_message_id: params.triggerMessageId,
      model: params.model,
      status: 'processing',
    })
    .select('id')
    .single()

  if (error || !data) {
    logger.error({ error }, 'Failed to create wa_bot_runs row')
    throw new Error('Failed to create bot run')
  }
  return data.id as string
}

export async function updateBotRunDone(
  tenant: SupabaseClient,
  runId: string,
  meta: {
    promptTokens?: number
    completionTokens?: number
    toolCalls?: unknown[]
  },
): Promise<void> {
  const { error } = await tenant
    .from('wa_bot_runs')
    .update({
      status: 'done',
      prompt_tokens: meta.promptTokens ?? null,
      completion_tokens: meta.completionTokens ?? null,
      tool_calls: meta.toolCalls?.length ? meta.toolCalls : null,
    })
    .eq('id', runId)

  if (error) logger.error({ runId, error }, 'Failed to update bot run to done')
}

export async function updateBotRunError(
  tenant: SupabaseClient,
  runId: string,
  errorMsg: string,
): Promise<void> {
  const { error } = await tenant
    .from('wa_bot_runs')
    .update({ status: 'error', error: errorMsg })
    .eq('id', runId)

  if (error) logger.error({ runId, error }, 'Failed to update bot run to error')
}
