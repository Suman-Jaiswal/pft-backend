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
    expect(parsed?.bankKey).toBe('ICICI_XX5000')
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
    expect(parsed?.bankKey).toBe('ICICI_XX9003')
  })

  it('extracts transaction amount and ignores available credit limit amount', () => {
    const parsed = parser.parse({
      id: 'msg3d',
      receivedAtMs: Date.now(),
      from: 'credit_cards@icici.bank.in',
      subject: 'Transaction alert for your ICICI Bank Credit Card',
      body: `Dear Customer, Your ICICI Bank Credit Card XX5000 has been used for a transaction of INR 519.75 on May 20, 2026 at 11:37:23. Info: SPACESHIP.COM* WDCVMW.
The Available Credit Limit on your card is INR 2,98,986.80 and Total Credit Limit is INR 3,00,000.00.`,
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.amount).toBe(519.75)
    expect(parsed?.cardLast4).toBe('5000')
  })

  it('returns null when transaction amount is missing even if limit lines contain INR values', () => {
    const parsed = parser.parse({
      id: 'msg3e',
      receivedAtMs: Date.now(),
      from: 'credit_cards@icici.bank.in',
      subject: 'Transaction alert for your ICICI Bank Credit Card',
      body: `Dear Customer, Your ICICI Bank Credit Card XX9003 has been used for a transaction of USD .00 on May 20, 2026 at 11:31:59.
The Available Credit Limit on your card is INR 2,99,508.55 and Total Credit Limit is INR 3,00,000.00.`,
    })

    expect(parsed).toBeNull()
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
