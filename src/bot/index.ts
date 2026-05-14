import type { BotProcessRequest } from '../types'
import { logger } from '../lib/logger'
import { createTenantClient, createBotRun, updateBotRunDone, updateBotRunError } from './runLogger'
import { fetchHistory } from './contextBuilder'
import { callGemini } from './gemini'
import { getTools, dispatchTool } from './toolRegistry'
import { sendWhatsAppMessage } from '../routes/messages'

const DEFAULT_HISTORY_LIMIT = 10

export async function processBotMessage(req: BotProcessRequest): Promise<string> {
  const log = logger.child({ org: req.organizationId, conv: req.conversationId })
  const tenant = createTenantClient(req.tenantUrl, req.tenantServiceKey)

  const runId = await createBotRun(tenant, {
    organizationId: req.organizationId,
    conversationId: req.conversationId,
    triggerMessageId: req.messageId,
    model: 'gemini-2.0-flash',
  })

  try {
    const historyLimit = req.maxHistoryMessages ?? DEFAULT_HISTORY_LIMIT
    const history = await fetchHistory(tenant, req.conversationId, historyLimit)
    log.info({ historyLen: history.length, runId }, 'Fetched conversation history')

    const tools = getTools()
    const geminiResult = await callGemini(history, tools, req.systemPrompt)
    log.info(
      { hasText: !!geminiResult.text, fnCalls: geminiResult.functionCalls.length, runId },
      'Gemini responded',
    )

    let replyText = geminiResult.text ?? ''
    const toolCallResults: unknown[] = []

    if (geminiResult.functionCalls.length > 0) {
      const ctx = {
        organizationId: req.organizationId,
        conversationId: req.conversationId,
        contactPhone: req.contactPhone,
        deviceId: req.deviceId,
        orgIdOnDevice: req.orgIdOnDevice,
        tenantUrl: req.tenantUrl,
        tenantServiceKey: req.tenantServiceKey,
      }

      for (const fc of geminiResult.functionCalls) {
        log.info({ tool: fc.name }, 'Dispatching tool call')
        const toolResult = await dispatchTool(fc.name, fc.args, ctx)
        toolCallResults.push({ name: fc.name, args: fc.args, result: toolResult })
        if (!replyText) replyText = toolResult
      }
    }

    if (!replyText) {
      replyText = '...'
      log.warn({ runId }, 'Gemini returned empty response, using fallback')
    }

    await sendWhatsAppMessage({
      orgId: req.orgIdOnDevice,
      to: req.contactPhone.replace(/^\+/, ''),
      type: 'text',
      message: replyText,
    })
    log.info({ runId, to: req.contactPhone }, 'Bot reply sent via WA')

    const { error: insertErr } = await tenant.from('wa_messages').insert({
      organization_id: req.organizationId,
      conversation_id: req.conversationId,
      direction: 'out',
      body: replyText,
      bot_run_id: runId,
    })
    if (insertErr) log.error({ insertErr }, 'Failed to insert outbound wa_messages row')

    await updateBotRunDone(tenant, runId, {
      promptTokens: geminiResult.promptTokens,
      completionTokens: geminiResult.completionTokens,
      toolCalls: toolCallResults.length > 0 ? toolCallResults : undefined,
    })

    return runId
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ runId, err: msg }, 'Bot processing failed')
    await updateBotRunError(tenant, runId, msg)
    throw err
  }
}
