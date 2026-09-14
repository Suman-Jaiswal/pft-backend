/**
 * One-time migration helper: seeds `PftSetting.statementSourceConfig` with
 * the values that used to be hardcoded in `CcStatementsImportService`'s
 * `STATEMENT_SOURCES` array (now driven entirely by tenant settings — see
 * `StatementSourcesService`). Only writes entries for cards that already
 * exist for the tenant; skips anything not previously configured.
 *
 * Usage: SEED_STATEMENT_SOURCES_TENANT_ID=<tenantId> npx ts-node -r tsconfig-paths/register scripts/seed-statement-source-config.ts
 * (defaults to tenant_default if unset)
 */
import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const LEGACY_DEFAULTS: Array<{ cardKey: string; labelName: string; flow: 'direct' | 'cloudPdf'; pdfPassword?: string }> = [
  { cardKey: 'SBI_XX5965', labelName: 'CC Statements/sbi_xx5965_statements', flow: 'direct' },
  { cardKey: 'HDFC_XX9335', labelName: 'CC Statements/hdfc_xx9335_statements', flow: 'cloudPdf', pdfPassword: 'SUMA0709' },
  { cardKey: 'ICICI_XX5000', labelName: 'CC Statements/icici_xx5000_statements', flow: 'direct' },
  { cardKey: 'ICICI_XX9003', labelName: 'CC Statements/icici_xx9003_statements', flow: 'direct' },
  { cardKey: 'CSB_XX4345', labelName: 'CC Statements/csb_xx4345_statements', flow: 'cloudPdf', pdfPassword: 'SUMA0709' },
  { cardKey: 'SLICE_XX6447', labelName: 'CC Statements/slice_xx6447_statements', flow: 'direct' },
]

async function main(): Promise<void> {
  const tenantId = (process.env.SEED_STATEMENT_SOURCES_TENANT_ID ?? 'tenant_default').trim()

  const cards = await prisma.card.findMany({ where: { tenantId }, select: { cardKey: true } })
  const existingCardKeys = new Set(cards.map((c) => c.cardKey.toUpperCase()))

  const sources = LEGACY_DEFAULTS.filter((entry) => existingCardKeys.has(entry.cardKey))
  const skipped = LEGACY_DEFAULTS.filter((entry) => !existingCardKeys.has(entry.cardKey)).map((e) => e.cardKey)

  if (sources.length === 0) {
    console.log(`No matching cards found for tenant ${tenantId}; nothing to seed.`)
    return
  }

  const existingSetting = await prisma.pftSetting.findUnique({ where: { tenantId }, select: { id: true } })
  if (!existingSetting) {
    throw new Error(
      `No PftSetting row exists for tenant ${tenantId} yet. Load the Settings page once (it auto-creates defaults) then re-run this script.`,
    )
  }

  await prisma.pftSetting.update({
    where: { tenantId },
    data: { statementSourceConfig: sources },
  })

  console.log(`Seeded statementSourceConfig for tenant ${tenantId}:`)
  console.table(sources)
  if (skipped.length) {
    console.log(`Skipped (no matching card row): ${skipped.join(', ')}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
