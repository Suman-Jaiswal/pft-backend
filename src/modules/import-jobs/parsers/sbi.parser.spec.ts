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
  })
})
