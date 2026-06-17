export interface CreateCardCommand {
  tenantId: string
  actorId: string
  cardKey: string
  issuer: string
  last4?: string
  network?: string
  statementCycleDay?: number
  creditLimit?: number
  fullCardNumber?: string
  cvv?: string
  expiryDate?: string
  variant?: string
}
