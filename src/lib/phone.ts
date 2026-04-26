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
