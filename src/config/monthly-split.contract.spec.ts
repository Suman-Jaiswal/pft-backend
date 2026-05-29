import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type ContractField = {
  key: string
  configKey: string
  apiKey: string
}

function toDefaultApiKey(fieldKey: string): string {
  return `default${fieldKey.charAt(0).toUpperCase()}${fieldKey.slice(1)}`
}

function parseOptionalDtoKeys(source: string): string[] {
  const keys: string[] = []
  const re = /\s([A-Za-z0-9_]+)\?:/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) keys.push(match[1]!)
  return keys
}

describe('monthly split mirrored contract', () => {
  const root = process.cwd()
  const contractPath = resolve(root, 'src/config/monthly-split-contract.json')
  const monthlyDtoPath = resolve(root, 'src/modules/monthly-plans/dto/upsert-monthly-plan.dto.ts')
  const settingsDtoPath = resolve(root, 'src/modules/settings/presentation/dto/update-pft-settings.dto.ts')
  const migrateScriptPath = resolve(root, 'scripts/migrate-firestore.ts')

  const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as { fields: ContractField[] }
  const monthlyDtoSource = readFileSync(monthlyDtoPath, 'utf8')
  const settingsDtoSource = readFileSync(settingsDtoPath, 'utf8')
  const migrateScriptSource = readFileSync(migrateScriptPath, 'utf8')

  it('keeps monthly DTO payload fields aligned with contract', () => {
    const monthlyContractApiKeys = contract.fields
      .map((field) => field.apiKey)
      .filter((apiKey) => !apiKey.startsWith('default') && apiKey !== 'loanRepayment' && apiKey !== 'basicExpenses')
      .sort()
    const dtoOptionalKeys = parseOptionalDtoKeys(monthlyDtoSource)
      .filter(
        (key) =>
          key !== 'remarks' &&
          key !== 'loanPayments' &&
          key !== 'customExpenses' &&
          key !== 'banks' &&
          key !== 'basicCcSpent',
      )
      .sort()

    expect(monthlyDtoSource).toContain('month!: number')
    expect(monthlyDtoSource).toContain('year!: number')
    expect(dtoOptionalKeys).toEqual(monthlyContractApiKeys)
  })

  it('keeps settings DTO payload fields aligned with contract', () => {
    const contractDefaults = new Set(contract.fields.map((field) => toDefaultApiKey(field.key)))
    const dtoOptionalKeys = parseOptionalDtoKeys(settingsDtoSource)
    const dtoDefaultKeys = dtoOptionalKeys.filter((key) => key.startsWith('default'))

    expect(dtoDefaultKeys.sort()).toEqual(Array.from(contractDefaults).sort())
  })

  it('keeps migration script config keys aligned with contract', () => {
    for (const field of contract.fields) {
      expect(migrateScriptSource).toContain(field.configKey)
    }
  })
})
