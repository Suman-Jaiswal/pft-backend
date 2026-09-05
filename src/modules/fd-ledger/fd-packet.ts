import { BadRequestException } from '@nestjs/common'

export type FdPacket = { amount: number; quantity: number }

function fromScalar(amount: number): FdPacket {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new BadRequestException('FD amount must be a non-negative number.')
  }
  return { amount, quantity: amount > 0 ? 1 : 0 }
}

export function coerceFdPacket(value: unknown): FdPacket {
  if (typeof value === 'number') return fromScalar(value)
  if (typeof value === 'string' && value.trim() !== '') return fromScalar(Number(value))
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('FD must be an { amount, quantity } object.')
  }
  const row = value as Record<string, unknown>
  const amount = Number(row.amount)
  const quantity = Number(row.quantity)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(quantity) || quantity < 0) {
    throw new BadRequestException('FD amount must be non-negative and quantity an integer.')
  }
  if ((amount === 0) !== (quantity === 0)) {
    throw new BadRequestException('FD amount and quantity must both be zero or both be positive.')
  }
  return { amount, quantity }
}
