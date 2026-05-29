import { calcStashDelta } from '@/modules/monthly-plans/domain/stash.calculator'

describe('stash calculator', () => {
  it('returns positive delta when free cash improves', () => {
    expect(calcStashDelta(1000, 2500)).toBe(1500)
  })

  it('returns negative delta when free cash drops', () => {
    expect(calcStashDelta(3000, 500)).toBe(-2500)
  })
})
