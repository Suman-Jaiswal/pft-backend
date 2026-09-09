import {
  getCurrentFiscalHalfKey,
  getNextFiscalHalfKey,
  isCreatableFiscalHalf,
  isFiscalHalfLocked,
} from '@/modules/settings/domain/fiscal-half'

describe('fiscal half keys', () => {
  it('treats September as H1 and October as the next H2', () => {
    const september = new Date(2026, 8, 9)
    expect(getCurrentFiscalHalfKey(september)).toBe('FY26-27_H1')
    expect(getNextFiscalHalfKey(september)).toBe('FY26-27_H2')
    expect(isCreatableFiscalHalf('FY26-27_H1', september)).toBe(true)
    expect(isCreatableFiscalHalf('FY26-27_H2', september)).toBe(true)
    expect(isCreatableFiscalHalf('FY27-28_H1', september)).toBe(false)
    expect(isFiscalHalfLocked('FY26-27_H1', september)).toBe(true)
    expect(isFiscalHalfLocked('FY26-27_H2', september)).toBe(false)
  })

  it('rolls H2 into the next fiscal H1 and locks the half once it starts', () => {
    const october = new Date(2026, 9, 1)
    expect(getCurrentFiscalHalfKey(october)).toBe('FY26-27_H2')
    expect(getNextFiscalHalfKey(october)).toBe('FY27-28_H1')
    expect(isFiscalHalfLocked('FY26-27_H2', october)).toBe(true)
    expect(isFiscalHalfLocked('FY27-28_H1', october)).toBe(false)
  })
})
