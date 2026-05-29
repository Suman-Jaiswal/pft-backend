import { readFileSync } from 'fs'
import { resolve } from 'path'

type ContractField = {
  key: string
  apiKey: string
  configKey: string
}

function mustContain(filePath: string, token: string): string | null {
  const source = readFileSync(filePath, 'utf8')
  return source.includes(token) ? null : `${filePath} missing "${token}"`
}

function main(): void {
  const root = process.cwd()
  const contractPath = resolve(root, 'src/config/monthly-split-contract.json')
  const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as { fields: ContractField[] }

  const checks: Array<{ file: string; tokens: string[] }> = [
    {
      file: resolve(root, 'prisma/schema.prisma'),
      tokens: ['sipMf', 'stocks', 'fd', 'savings', 'otherSources', 'defaultSipMf', 'defaultStocks', 'defaultFd', 'defaultSavings', 'defaultOtherSources'],
    },
    {
      file: resolve(root, 'src/modules/monthly-plans/dto/upsert-monthly-plan.dto.ts'),
      tokens: contract.fields
        .map((field) => field.apiKey)
        .filter((key) => !key.startsWith('default') && key !== 'loanRepayment' && key !== 'basicExpenses'),
    },
    {
      file: resolve(root, 'src/modules/settings/presentation/dto/update-pft-settings.dto.ts'),
      tokens: contract.fields.map((field) => field.apiKey).filter((key) => key.startsWith('default')),
    },
    {
      file: resolve(root, 'src/modules/monthly-plans/monthly-plans.service.ts'),
      tokens: ['calcFreeCash', 'otherSources', 'sipMf', 'stocks', 'fd', 'savings'],
    },
    {
      file: resolve(root, 'scripts/migrate-firestore.ts'),
      tokens: contract.fields.map((field) => field.configKey),
    },
    {
      file: resolve(root, 'scripts/reconcile-migration.ts'),
      tokens: ['stocks', 'fd'],
    },
    {
      file: resolve(root, 'src/config/monthly-split.contract.spec.ts'),
      tokens: ['monthly split mirrored contract'],
    },
    {
      file: resolve(root, 'src/modules/monthly-plans/domain/monthly-split.calculator.spec.ts'),
      tokens: ['monthly split calculator'],
    },
  ]

  const failures: string[] = []
  for (const check of checks) {
    for (const token of check.tokens) {
      const error = mustContain(check.file, token)
      if (error) failures.push(error)
    }
  }

  if (failures.length > 0) {
    console.error('Monthly split change checklist failed:')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
    return
  }

  console.log('Monthly split change checklist passed.')
}

main()
