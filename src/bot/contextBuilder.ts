import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from '../types'
import { logger } from '../lib/logger'

export async function fetchHistory(
  tenant: SupabaseClient,
  conversationId: string,
  limit: number,
): Promise<ChatMessage[]> {
  const { data, error } = await tenant
    .from('wa_messages')
    .select('id, direction, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    logger.error({ conversationId, error }, 'Failed to fetch conversation history')
    return []
  }

  return (data ?? []).map((row) => ({
    role: row.direction === 'in' ? ('user' as const) : ('model' as const),
    text: row.body ?? '',
  }))
}
