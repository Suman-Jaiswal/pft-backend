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
  })
})
