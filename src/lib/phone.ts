/** Normalize a phone string to a Baileys JID (number@s.whatsapp.net). */
export function toJid(phone: string): string {
  if (/[+\s]/.test(phone)) {
    throw new Error(`Phone must not contain '+' or spaces: ${phone}`)
  }
  const clean = phone.replace(/\D/g, '')
  if (clean.length < 8 || clean.length > 15) {
    throw new Error(`Invalid phone length (${clean.length}): ${phone}`)
  }
  return `${clean}@s.whatsapp.net`
}

/** Extract the numeric part from a JID (strips @s.whatsapp.net or @g.us). */
export function jidToPhone(jid: string): string {
  return jid.split('@')[0]
}

/**
 * Permissive normalizer: accepts E.164 (`+972...`), international digits
 * (`972...`), or Israeli local format (`05x-...` / `05x xxxxxxx`). Strips
 * separators and converts a leading `0` to the Israeli country code `972`.
 *
 * Returns digits only (no JID suffix). Use {@link toJid} to attach
 * `@s.whatsapp.net` once you have the canonical international number.
 */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim()
  if (!trimmed) throw new Error('Phone is empty')

  const digits = trimmed.replace(/\D/g, '')
  if (!digits) throw new Error(`Invalid phone (no digits): ${phone}`)

  // Israeli local: 0XXXXXXXXX (10 digits starting with 0) → 972 + drop leading 0
  const normalized = digits.length === 10 && digits.startsWith('0')
    ? `972${digits.slice(1)}`
    : digits

  if (normalized.length < 8 || normalized.length > 15) {
    throw new Error(`Invalid phone length (${normalized.length}): ${phone}`)
  }
  return normalized
}

/** Convenience: normalize a flexible-format phone and return its JID. */
export function normalizeToJid(phone: string): string {
  return `${normalizePhone(phone)}@s.whatsapp.net`
}
