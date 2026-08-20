import type { Contact, proto } from '@whiskeysockets/baileys'

/** Message key fields Baileys attaches for LID↔PN (v6.8+/v7 WAMessageKey + stanza attrs). */
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

export function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid')
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

/** Prefer PN JIDs / bare digits; never treat `@lid` as a phone. */
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

/** Contact.id may be LID; phoneNumber holds the PN when available (Baileys v7). */
export function contactPhoneDigits(contact?: Pick<Contact, 'id' | 'phoneNumber' | 'lid'> | null): string | null {
  if (!contact) return null
  return pickPnDigits(contact.phoneNumber, contact.id)
}

/**
 * Webhook `from` must be an MSISDN for CRM matching.
 * Prefer resolved PN digits; fall back to JID local part only when no PN is known.
 */
export function resolveWebhookFrom(opts: {
  isGroup: boolean
  remoteJid: string
  participant?: string | null
  senderPn: string | null
  participantPn: string | null
}): string {
  if (opts.isGroup) {
    return opts.participantPn ?? jidLocalPart(opts.participant ?? '')
  }
  return opts.senderPn ?? jidLocalPart(opts.remoteJid)
}

/** Normalize v7 GroupParticipant (Contact) list back to JID strings for webhooks. */
export function groupParticipantJids(
  participants: Array<string | Pick<Contact, 'id' | 'phoneNumber' | 'lid'>>
): string[] {
  return participants.map((p) => {
    if (typeof p === 'string') return p
    return p.phoneNumber ?? p.id
  })
}

export function participantMatchesSystem(
  participants: Array<string | Pick<Contact, 'id' | 'phoneNumber' | 'lid'>>,
  systemJid: string
): boolean {
  if (!systemJid) return false
  const sysBare = jidLocalPart(systemJid)
  const sysIds = new Set(
    [systemJid, sysBare].filter(Boolean)
  )
  for (const p of participants) {
    const cands =
      typeof p === 'string'
        ? [p, jidLocalPart(p)]
        : [p.id, p.phoneNumber, p.lid, jidLocalPart(p.id), jidLocalPart(p.phoneNumber ?? ''), jidLocalPart(p.lid ?? '')]
    for (const c of cands) {
      if (c && sysIds.has(c)) return true
    }
  }
  return false
}

/**
 * Resolve the phone-number form exposed alongside a LID message key in Baileys v7.
 * `remoteJidAlt` is the PN for one-to-one messages; `participantAlt` is the PN
 * for the author of a group message. Keep the legacy fields for stored/replayed
 * messages from pre-v7 sockets that may still populate them at runtime.
 */
export function resolveInboundPhone(key: ExtendedMessageKey, isGroup: boolean): string | null {
  return isGroup
    ? pickPnDigits(key.participantPn, key.participantAlt, key.participant)
    : pickPnDigits(
        key.senderPn,
        key.remoteJidAlt,
        key.remoteJid?.endsWith('@s.whatsapp.net') ? key.remoteJid : undefined,
      )
}
