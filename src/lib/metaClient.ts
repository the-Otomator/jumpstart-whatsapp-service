import type { MetaCredentials, MetaTemplateComponent, TemplateInfo } from '../types'
import { logger } from './logger'

const GRAPH_BASE = process.env.META_GRAPH_BASE ?? 'https://graph.facebook.com/v21.0'

interface MetaGraphError {
  error?: { message?: string; type?: string; code?: number; fbtrace_id?: string }
}

async function graphFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<any> {
  const url = `${GRAPH_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> | undefined),
    },
  })

  const body = await res.json() as MetaGraphError & Record<string, unknown>

  if (!res.ok) {
    const msg = body.error?.message ?? `Graph API ${res.status}`
    logger.error({ status: res.status, path, graphError: body.error }, 'Meta Graph API error')
    throw Object.assign(new Error(msg), { status: res.status, graphError: body.error })
  }

  return body
}

// ── Template CRUD ──────────────────────────────────────────────

export async function createTemplate(
  creds: MetaCredentials,
  template: { name: string; language: string; category: string; components: MetaTemplateComponent[] },
): Promise<{ id: string; status: string }> {
  const body = await graphFetch(`/${creds.wabaId}/message_templates`, creds.accessToken, {
    method: 'POST',
    body: JSON.stringify({
      name: template.name,
      language: template.language,
      category: template.category,
      components: template.components,
    }),
  })

  return { id: body.id, status: body.status ?? 'PENDING' }
}

export async function listTemplates(creds: MetaCredentials): Promise<TemplateInfo[]> {
  const body = await graphFetch(`/${creds.wabaId}/message_templates?limit=255`, creds.accessToken)

  return (body.data ?? []).map((t: any) => ({
    name: t.name,
    status: t.status,
    category: t.category,
    language: t.language,
    id: t.id,
    components: t.components ?? [],
  }))
}

export async function getTemplate(creds: MetaCredentials, name: string): Promise<TemplateInfo | null> {
  const body = await graphFetch(
    `/${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}`,
    creds.accessToken,
  )

  const match = (body.data ?? [])[0]
  if (!match) return null

  return {
    name: match.name,
    status: match.status,
    category: match.category,
    language: match.language,
    id: match.id,
    components: match.components ?? [],
  }
}

export async function deleteTemplate(creds: MetaCredentials, name: string): Promise<void> {
  await graphFetch(
    `/${creds.wabaId}/message_templates?name=${encodeURIComponent(name)}`,
    creds.accessToken,
    { method: 'DELETE' },
  )
}
