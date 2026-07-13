import type { proto } from '@whiskeysockets/baileys'

export type ExtendedMessageKey = proto.IMessageKey & {
  senderPn?: string
  participantPn?: string
  senderLid?: string
  remoteJidAlt?: string
  participantAlt?: string
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

export function jidLocalPart(jid: string): string {
  return jid.split('@')[0]?.split(':')[0] ?? jid
}

/** Classify inbound Baileys message as group vs 1:1 and resolve the group JID when possible. */
export function resolveGroupInbound(key: ExtendedMessageKey): {
  isGroup: boolean
  groupJid: string | null
  ambiguous: boolean
} {
  const remoteJid = key.remoteJid ?? ''
  const remoteJidAlt = key.remoteJidAlt ?? ''
  const participant = key.participant ?? ''

  const groupFromRemote = isGroupJid(remoteJid) ? remoteJid : null
  const groupFromAlt = isGroupJid(remoteJidAlt) ? remoteJidAlt : null
  const hasParticipant = Boolean(participant)

  const isGroup = Boolean(groupFromRemote || groupFromAlt || hasParticipant)
  const groupJid = groupFromRemote ?? groupFromAlt
  const ambiguous = isGroup && !groupJid

  return { isGroup, groupJid, ambiguous }
}

export function jidToDigits(v?: string | null): string | null {
  if (!v) return null
  const bare = String(v).split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
  return bare || null
}

export function pickPnDigits(...cands: Array<string | null | undefined>): string | null {
  for (const c of cands) {
    if (!c) continue
    const s = String(c)
    if (s.endsWith('@lid')) continue
    if (s.includes('@s.whatsapp.net') || !s.includes('@')) {
      const d = jidToDigits(s)
      if (d) return d
    }
  }
  return null
}
