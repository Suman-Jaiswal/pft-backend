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
    expect(parsed?.referenceNo).toBe('U123')
  })

  it('parses card ending pattern with reference number', () => {
    const parsed = parser.parse({
      id: 'msg3b',
      receivedAtMs: Date.now(),
      from: 'alerts@icicibank.com',
      subject: 'Card Alert',
      body: 'Credit Card ending 9003 has been used for INR 420.50 at STARBUCKS. reference number 778899',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.cardLast4).toBe('9003')
    expect(parsed?.merchant).toBe('STARBUCKS')
    expect(parsed?.referenceNo).toBe('778899')
  })

  it('skips declined transactions', () => {
    const parsed = parser.parse({
      id: 'msg3c',
      receivedAtMs: Date.now(),
      from: 'alerts@icicibank.com',
      subject: 'Alert',
      body: 'ICICI card XX5000 transaction DECLINED INR 120.00 at TEST.',
    })

    expect(parsed).toBeNull()
  })
})
