import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
export interface Envelope { v: 1; kid: string; iv: string; tag: string; ciphertext: string }
export class AuthCipher {
  private readonly keys = new Map<string, Buffer>()
  constructor(readonly currentKid: string, keys: Record<string, string>) {
    for (const [id, value] of Object.entries(keys)) {
      const key = Buffer.from(value, 'base64')
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || key.length !== 32 || key.toString('base64') !== value) throw new Error('HA_KEYRING_INVALID')
      this.keys.set(id, key)
    }
    if (!this.keys.has(currentKid)) throw new Error('HA_CURRENT_KEY_MISSING')
  }
  seal(session: string, item: string, plaintext: string): Envelope {
    if (Buffer.byteLength(plaintext) > 2 * 1024 * 1024) throw new Error('HA_AUTH_VALUE_TOO_LARGE')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentKid)!, iv)
    cipher.setAAD(Buffer.from(JSON.stringify([1, session, item, this.currentKid])))
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    return { v: 1, kid: this.currentKid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
  }
  open(session: string, item: string, value: Envelope): string {
    const key = this.keys.get(value?.kid)
    if (value?.v !== 1 || !key || typeof value.ciphertext !== 'string' || value.ciphertext.length > 3 * 1024 * 1024) throw new Error('HA_AUTH_ENVELOPE_INVALID')
    const iv = Buffer.from(value.iv, 'base64'), tag = Buffer.from(value.tag, 'base64')
    if (iv.length !== 12 || tag.length !== 16) throw new Error('HA_AUTH_ENVELOPE_INVALID')
    const cipher = createDecipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(JSON.stringify([1, session, item, value.kid])))
    cipher.setAuthTag(tag)
    try { return Buffer.concat([cipher.update(Buffer.from(value.ciphertext, 'base64')), cipher.final()]).toString('utf8') }
    catch { throw new Error('HA_AUTH_DECRYPT_FAILED') }
  }
}
