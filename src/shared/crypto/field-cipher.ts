import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LEN = 16
const TAG_LEN = 16
const SALT = 'pft-field-enc-v1'

function deriveKey(): Buffer {
  const secret = process.env.FIELD_ENCRYPTION_KEY
  if (!secret) throw new Error('FIELD_ENCRYPTION_KEY env var is required for card data encryption')
  return scryptSync(secret, SALT, 32)
}

export function encryptField(plaintext: string): string {
  const key = deriveKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptField(ciphertext: string): string {
  const key = deriveKey()
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const encrypted = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final('utf8')
}
