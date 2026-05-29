import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type JsonObject = Record<string, unknown>

function loadContract(name: string): JsonObject {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'src/config', name), 'utf8')) as JsonObject
}

describe('domain contracts', () => {
  it('billing-cycle contract aligns card DTO validation range', () => {
    const contract = loadContract('billing-cycle-contract.json')
    const createCardDto = readFileSync(
      resolve(process.cwd(), 'src/modules/cards/presentation/dto/create-card.dto.ts'),
      'utf8',
    )
    const updateCardDto = readFileSync(
      resolve(process.cwd(), 'src/modules/cards/presentation/dto/update-card.dto.ts'),
      'utf8',
    )
    const min = (contract.statementCycleRange as { min: number }).min
    const max = (contract.statementCycleRange as { max: number }).max
    expect(createCardDto).toContain(`@Min(${min})`)
    expect(createCardDto).toContain(`@Max(${max})`)
    expect(updateCardDto).toContain(`@Min(${min})`)
    expect(updateCardDto).toContain(`@Max(${max})`)
  })

  it('statements contract aligns create statement DTO', () => {
    const contract = loadContract('statements-contract.json')
    const dtoSource = readFileSync(
      resolve(process.cwd(), 'src/modules/statements/presentation/dto/create-statement.dto.ts'),
      'utf8',
    )
    const required = contract.requiredDtoFields as string[]
    for (const field of required) {
      expect(dtoSource).toContain(field)
    }
    expect(dtoSource).toContain('^\\d{4}-\\d{2}$')
  })

  it('transactions-ingest contract aligns parser outputs', () => {
    const contract = loadContract('transactions-ingest-contract.json')
    const parserSource = readFileSync(
      resolve(process.cwd(), 'src/modules/import-jobs/parsers/hdfc.parser.ts'),
      'utf8',
    )
    const requiredParsedFields = contract.requiredParsedFields as string[]
    for (const field of requiredParsedFields) {
      expect(parserSource).toContain(field)
    }
  })

  it('cc-statements-import contract aligns dto and summary payload', () => {
    const contract = loadContract('cc-statements-import-contract.json')
    const dtoSource = readFileSync(
      resolve(process.cwd(), 'src/modules/import-jobs/dto/run-cc-statements-import.dto.ts'),
      'utf8',
    )
    const serviceSource = readFileSync(
      resolve(process.cwd(), 'src/modules/import-jobs/services/cc-statements-import.service.ts'),
      'utf8',
    )
    const optionalFields = (contract.startRequest as { optionalFields: string[] }).optionalFields
    for (const field of optionalFields) {
      expect(dtoSource).toContain(field)
    }
    const requiredSummaryFields = (contract.runSummary as { requiredFields: string[] }).requiredFields
    for (const field of requiredSummaryFields) {
      expect(serviceSource).toContain(field)
    }
    const aggregateFields = (contract.runSummary as { aggregateFields: string[] }).aggregateFields
    for (const field of aggregateFields) {
      expect(serviceSource).toContain(field)
    }
  })

  it('loans-projection contract aligns loan DTO and calculator input', () => {
    const contract = loadContract('loans-projection-contract.json')
    const dtoSource = readFileSync(
      resolve(process.cwd(), 'src/modules/loans/dto/upsert-loan.dto.ts'),
      'utf8',
    )
    const calculatorSource = readFileSync(
      resolve(process.cwd(), 'src/modules/monthly-plans/domain/monthly-split.calculator.ts'),
      'utf8',
    )
    const dtoFields = contract.requiredLoanDtoFields as string[]
    for (const field of dtoFields) {
      expect(dtoSource).toContain(field)
    }
    expect(calculatorSource).toContain(String(contract.sharedCalculatorDependency))
  })
})
