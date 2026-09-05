import { coerceFdPacket } from '@/modules/fd-ledger/fd-packet'

describe('coerceFdPacket', () => {
  it('converts a historical scalar FD into a packet', () => {
    expect(coerceFdPacket(5000)).toEqual({ amount: 5000, quantity: 1 })
    expect(coerceFdPacket(0)).toEqual({ amount: 0, quantity: 0 })
  })

  it('leaves an already-normalized packet unchanged', () => {
    expect(coerceFdPacket({ amount: 2500, quantity: 3 })).toEqual({ amount: 2500, quantity: 3 })
  })

  it('does not treat a packet object as a scalar amount', () => {
    expect(coerceFdPacket({ amount: 0, quantity: 0 })).toEqual({ amount: 0, quantity: 0 })
  })
})
