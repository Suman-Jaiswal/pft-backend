import { SbiParser } from '@/modules/import-jobs/parsers/sbi.parser'

describe('SbiParser', () => {
  const parser = new SbiParser()

  it('parses amount and card last4 from SMS-like body', () => {
    const parsed = parser.parse({
      id: 'msg1',
      receivedAtMs: Date.now(),
      from: 'alerts@sbi.co.in',
      subject: 'txn alert',
      body: 'Your SBI Card XX5965 spent INR 1,234.50 at AMAZON Ref: ABC123',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.cardLast4).toBe('5965')
    expect(parsed?.amount).toBe(1234.5)
    expect(parsed?.referenceNo).toBe('ABC123')
  })

  it('parses UPI reference variant', () => {
    const parsed = parser.parse({
      id: 'msg1b',
      receivedAtMs: Date.now(),
      from: 'alerts@sbi.co.in',
      subject: 'txn alert',
      body: 'Your SBI Card XX5965 spent Rs 49.00 to ZOMATO on 21-04-2026. UPI Ref No 531313131',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.referenceNo).toBe('531313131')
    expect(parsed?.merchant).toBe('ZOMATO')
  })

  it('parses ending with template from transaction alert email', () => {
    const parsed = parser.parse({
      id: 'msg1d',
      receivedAtMs: Date.now(),
      from: 'onlinesbicard@sbicard.com',
      subject: 'Transaction Alert from SBI Card',
      body: 'This is to inform you that, Rs.240.00 spent on your SBI Credit Card ending with 5965 at ZEPTOMARKETPLACEPRIVA on 21-05-26 via UPI (Ref No. 436011751416).',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.cardLast4).toBe('5965')
    expect(parsed?.merchant).toBe('ZEPTOMARKETPLACEPRIVA')
    expect(parsed?.referenceNo).toBe('436011751416')
  })

  it('skips failed alerts', () => {
    const parsed = parser.parse({
      id: 'msg1c',
      receivedAtMs: Date.now(),
      from: 'alerts@sbi.co.in',
      subject: 'txn alert',
      body: 'SBI Card XX5965 payment FAILED for INR 200 at TEST.',
    })

    expect(parsed).toBeNull()
  })
})
