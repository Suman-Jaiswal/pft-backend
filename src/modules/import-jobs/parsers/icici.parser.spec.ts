import { IciciParser } from '@/modules/import-jobs/parsers/icici.parser'

describe('IciciParser', () => {
  const parser = new IciciParser()

  it('parses shared icici message', () => {
    const parsed = parser.parse({
      id: 'msg3',
      receivedAtMs: Date.now(),
      from: 'alerts@icicibank.com',
      subject: 'txn',
      body: 'ICICI card XX5000 debited INR 120.00 towards UPI Ref: U123',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.cardLast4).toBe('5000')
    expect(parsed?.amount).toBe(120)
  })
})
