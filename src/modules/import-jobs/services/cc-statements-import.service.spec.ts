import {
  buildStatementPdfPasswordCandidates,
  deriveStatementMonthFromDueDate,
  normalizeStatementAmounts,
} from '@/modules/import-jobs/services/cc-statements-import.service'

describe('CcStatementsImportService password parity', () => {
  it('keeps explicit password as first candidate', () => {
    const candidates = buildStatementPdfPasswordCandidates(
      'CC Statements/csb_xx4345_statements',
      'statement',
      'manual-pass',
    )
    expect(candidates[0]).toBe('manual-pass')
  })

  it('generates CSB-derived candidates in stable order', () => {
    const candidates = buildStatementPdfPasswordCandidates('CC Statements/csb_4345', 'subject')
    expect(candidates).toEqual(['S4349', '4345', 'S4345', '43459'])
  })

  it('supports all-candidates-fail scenario inputs with deterministic candidate list', () => {
    const candidates = buildStatementPdfPasswordCandidates('CC Statements/csb_xx4345_statements', 'subject')
    expect(candidates).toEqual(['S4349', '4345', 'S4345', '43459'])
  })
})

describe('CcStatementsImportService statement derivation', () => {
  it('maps due month to generated statement month', () => {
    expect(deriveStatementMonthFromDueDate('2026-06-02')).toBe('2026-05')
    expect(deriveStatementMonthFromDueDate('2026-01-05')).toBe('2025-12')
  })

  it('normalizes reversed parsed amounts', () => {
    expect(normalizeStatementAmounts(15000, 1200)).toEqual({
      minimumAmountDue: 1200,
      totalAmountDue: 15000,
    })
    expect(normalizeStatementAmounts(1200, 15000)).toEqual({
      minimumAmountDue: 1200,
      totalAmountDue: 15000,
    })
  })
})
