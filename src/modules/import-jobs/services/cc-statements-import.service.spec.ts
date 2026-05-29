import { buildStatementPdfPasswordCandidates } from '@/modules/import-jobs/services/cc-statements-import.service'

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
