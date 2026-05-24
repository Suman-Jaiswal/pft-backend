import { HdfcParser } from '@/modules/import-jobs/parsers/hdfc.parser'

describe('HdfcParser', () => {
  const parser = new HdfcParser()

  it('parses hdfc body with xx card format', () => {
    const parsed = parser.parse({
      id: 'msg2',
      receivedAtMs: Date.now(),
      from: 'alerts@hdfcbank.net',
      subject: 'txn',
      body: 'HDFC Card xx9335 used for INR 899.00 at SWIGGY Ref: R1',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.cardLast4).toBe('9335')
    expect(parsed?.amount).toBe(899)
    expect(parsed?.merchant).toBe('SWIGGY')
  })

  it('parses debited towards template with date variant', () => {
    const parsed = parser.parse({
      id: 'msg2b',
      receivedAtMs: Date.now(),
      from: 'alerts@hdfcbank.net',
      subject: 'Instant Alert',
      body: 'Your card xx9335 has been debited for Rs.410.00 towards *RSP*INSTAMART* on *21 Apr, 2026 at 18:35:20.',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.merchant).toBe('RSP*INSTAMART')
    expect(parsed?.amount).toBe(410)
  })

  it('parses credit card ending template from insta alert', () => {
    const parsed = parser.parse({
      id: 'msg2d',
      receivedAtMs: Date.now(),
      from: 'alerts@hdfcbank.bank.in',
      subject: 'A payment was made using your Credit Card',
      body: 'We would like to inform you that Rs. 321.00 has been debited from your HDFC Bank Credit Card ending 9335 towards BUNDL TECHNOLOGIES on 19 May, 2026 at 11:59:26.',
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.cardLast4).toBe('9335')
    expect(parsed?.merchant).toBe('BUNDL TECHNOLOGIES')
    expect(parsed?.amount).toBe(321)
  })

  it('skips declined or non-posted txn alerts', () => {
    const parsed = parser.parse({
      id: 'msg2c',
      receivedAtMs: Date.now(),
      from: 'alerts@hdfcbank.net',
      subject: 'txn declined',
      body: 'HDFC card xx9335 transaction DECLINED for INR 300.00 at FOOD.',
    })

    expect(parsed).toBeNull()
  })
})
