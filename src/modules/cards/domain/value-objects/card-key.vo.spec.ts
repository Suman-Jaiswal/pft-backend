import { CardKey } from '@/modules/cards/domain/value-objects/card-key.vo'

describe('CardKey', () => {
  it('normalizes to uppercase', () => {
    expect(CardKey.create('hdfc_xx9335').value).toBe('HDFC_XX9335')
  })

  it('normalizes legacy plain suffix form to masked form', () => {
    expect(CardKey.create('hdfc_9335').value).toBe('HDFC_XX9335')
  })

  it('throws on empty key', () => {
    expect(() => CardKey.create('')).toThrow()
  })
})
