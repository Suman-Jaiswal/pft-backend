import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { initializeApp, cert, getApps, App } from 'firebase-admin/app'
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore'
import { PrismaClient } from '@prisma/client'

type FirestoreDoc = Record<string, unknown>

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`)
  }
  return String(value).trim()
}

function optionalEnv(name: string): string | undefined {
  const v = process.env[name]
  return v && String(v).trim() ? String(v).trim() : undefined
}

function toDate(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value instanceof Timestamp) return value.toDate()
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeCardKey(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase()
}

function parseCardParts(cardKey: string): { issuer: string; last4: string | null } {
  const m = /^([A-Z0-9]+)_XX(\d{2,4})$/.exec(cardKey)
  if (m) return { issuer: m[1], last4: m[2] }
  return { issuer: cardKey.split('_')[0] || 'UNKNOWN', last4: null }
}

function statementMonthFrom(doc: FirestoreDoc): string | null {
  const syncMonth = String(doc.statementSyncMonth ?? doc.statement_sync_month ?? '').trim()
  if (/^\d{4}-\d{2}$/.test(syncMonth)) return syncMonth
  const due = toDate(doc.dueDate ?? doc.due_date)
  if (!due) return null
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}`
}

function buildFirebaseApp(): App {
  if (getApps().length > 0) return getApps()[0]!
  const serviceAccountPath = optionalEnv('FIREBASE_SERVICE_ACCOUNT_PATH')
  const serviceAccountJson = optionalEnv('FIREBASE_SERVICE_ACCOUNT_JSON')
  const projectId = optionalEnv('FIREBASE_PROJECT_ID')
  if (!serviceAccountPath && !serviceAccountJson) {
    throw new Error('Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON')
  }
  const account = serviceAccountPath
    ? JSON.parse(readFileSync(serviceAccountPath, 'utf8'))
    : JSON.parse(serviceAccountJson as string)
  return initializeApp({
    credential: cert(account),
    projectId: projectId ?? account.project_id,
  })
}

async function fetchCollection(db: Firestore, uid: string, name: string): Promise<Array<{ id: string; data: FirestoreDoc }>> {
  const snap = await db.collection('users').doc(uid).collection(name).get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as FirestoreDoc }))
}

async function main(): Promise<void> {
  const uid = env('MIGRATION_FIRESTORE_UID')
  const actor = env('MIGRATION_ACTOR_ID', 'migration-script')
  const dryRun = process.argv.includes('--dry-run')

  const firebaseApp = buildFirebaseApp()
  const firestore = getFirestore(firebaseApp)
  const prisma = new PrismaClient()

  const [cardsRaw, statementsRaw, latestBillsRaw, expensesRaw, monthlyPlansRaw, billsRaw, loansRaw] = await Promise.all([
    fetchCollection(firestore, uid, 'cards'),
    fetchCollection(firestore, uid, 'cardStatements'),
    fetchCollection(firestore, uid, 'latestBills'),
    fetchCollection(firestore, uid, 'dailyCardExpenses'),
    fetchCollection(firestore, uid, 'monthlyPlans'),
    fetchCollection(firestore, uid, 'bills'),
    fetchCollection(firestore, uid, 'loans'),
  ])
  const settingsSnap = await firestore.collection('users').doc(uid).collection('pft_config').doc('settings').get()
  const settingsRaw = (settingsSnap.exists ? (settingsSnap.data() as FirestoreDoc) : {}) ?? {}

  const analysis = {
    cards: cardsRaw.length,
    cardStatements: statementsRaw.length,
    latestBills: latestBillsRaw.length,
    dailyCardExpenses: expensesRaw.length,
    monthlyPlans: monthlyPlansRaw.length,
    bills: billsRaw.length,
    loans: loansRaw.length,
    hasSettings: settingsSnap.exists,
  }
  console.log('Firestore analysis:', JSON.stringify(analysis, null, 2))

  const now = new Date()
  const cardMap = new Map<string, { id: string; statementCycleDay: number | null }>()

  // 1) cards collection (preferred source)
  for (const row of cardsRaw) {
    const cardKey = normalizeCardKey(row.data.cardKey ?? row.data.card)
    if (!cardKey) continue
    const { issuer, last4 } = parseCardParts(cardKey)
    const id = String(row.data.id ?? row.id ?? `card_${randomUUID()}`)
    const cycle = toNumber(row.data.statementCycleDay ?? row.data.statementCycle, NaN)
    const statementCycleDay = Number.isFinite(cycle) && cycle >= 1 && cycle <= 31 ? Math.floor(cycle) : null
    let resolvedId = id
    if (!dryRun) {
      const saved = await prisma.card.upsert({
        where: { tenantId_cardKey: { tenantId: uid, cardKey } },
        update: {
          issuer: String(row.data.issuer ?? issuer),
          last4: String(row.data.last4 ?? last4 ?? '') || null,
          network: String(row.data.network ?? '') || null,
          statementCycleDay,
          creditLimit: toNumber(row.data.creditLimit, 0) || null,
          status: String(row.data.status ?? 'ACTIVE'),
          updatedBy: actor,
        },
        create: {
          id,
          tenantId: uid,
          cardKey,
          issuer: String(row.data.issuer ?? issuer),
          last4: String(row.data.last4 ?? last4 ?? '') || null,
          network: String(row.data.network ?? '') || null,
          statementCycleDay,
          creditLimit: toNumber(row.data.creditLimit, 0) || null,
          status: String(row.data.status ?? 'ACTIVE'),
          createdAt: toDate(row.data.createdAt) ?? now,
          updatedAt: toDate(row.data.updatedAt) ?? now,
          createdBy: actor,
          updatedBy: actor,
        },
      })
      resolvedId = saved.id
    }
    cardMap.set(cardKey, { id: resolvedId, statementCycleDay })
  }

  // 2) fallback card generation from latestBills + expenses
  for (const source of [...latestBillsRaw, ...expensesRaw]) {
    const cardKey = normalizeCardKey(source.data.card)
    if (!cardKey || cardMap.has(cardKey)) continue
    const { issuer, last4 } = parseCardParts(cardKey)
    const id = `card_${randomUUID()}`
    const cycle = toNumber(source.data.statementCycle ?? source.data.statement_cycle, NaN)
    const statementCycleDay = Number.isFinite(cycle) && cycle >= 1 && cycle <= 31 ? Math.floor(cycle) : null
    let resolvedId = id
    if (!dryRun) {
      const saved = await prisma.card.upsert({
        where: { tenantId_cardKey: { tenantId: uid, cardKey } },
        update: {
          issuer,
          last4,
          statementCycleDay,
          updatedBy: actor,
        },
        create: {
          id,
          tenantId: uid,
          cardKey,
          issuer,
          last4,
          network: null,
          statementCycleDay,
          creditLimit: null,
          status: 'ACTIVE',
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
        },
      })
      resolvedId = saved.id
    }
    cardMap.set(cardKey, { id: resolvedId, statementCycleDay })
  }

  // 3) statements from cardStatements first
  const statementSeen = new Set<string>()
  for (const row of statementsRaw) {
    const cardKey = normalizeCardKey(row.data.cardKey ?? row.data.card)
    if (!cardKey) continue
    const card = cardMap.get(cardKey)
    if (!card) continue
    const statementMonth = String(row.data.statementMonth ?? '').trim()
    if (!/^\d{4}-\d{2}$/.test(statementMonth)) continue
    const key = `${card.id}::${statementMonth}`
    if (statementSeen.has(key)) continue
    statementSeen.add(key)
    if (!dryRun) {
      await prisma.statement.upsert({
        where: { tenantId_cardId_statementMonth: { tenantId: uid, cardId: card.id, statementMonth } },
        update: {
          cardKey,
          dueDate: toDate(row.data.dueDate) ?? now,
          minimumAmountDue: toNumber(row.data.minimumAmountDue),
          totalAmountDue: toNumber(row.data.totalAmountDue),
          status: String(row.data.status ?? 'DUE'),
          statementSyncMonth: String(row.data.statementSyncMonth ?? '') || null,
          updatedBy: actor,
        },
        create: {
          id: `st_${randomUUID()}`,
          tenantId: uid,
          cardId: card.id,
          cardKey,
          statementMonth,
          dueDate: toDate(row.data.dueDate) ?? now,
          minimumAmountDue: toNumber(row.data.minimumAmountDue),
          totalAmountDue: toNumber(row.data.totalAmountDue),
          status: String(row.data.status ?? 'DUE'),
          statementSyncMonth: String(row.data.statementSyncMonth ?? '') || null,
          createdAt: toDate(row.data.createdAt) ?? now,
          updatedAt: toDate(row.data.updatedAt) ?? now,
          createdBy: actor,
          updatedBy: actor,
        },
      })
    }
  }

  // 4) statements fallback from latestBills
  for (const row of latestBillsRaw) {
    const cardKey = normalizeCardKey(row.data.card)
    if (!cardKey) continue
    const card = cardMap.get(cardKey)
    if (!card) continue
    const statementMonth = statementMonthFrom(row.data)
    if (!statementMonth) continue
    const key = `${card.id}::${statementMonth}`
    if (statementSeen.has(key)) continue
    statementSeen.add(key)
    if (!dryRun) {
      await prisma.statement.upsert({
        where: { tenantId_cardId_statementMonth: { tenantId: uid, cardId: card.id, statementMonth } },
        update: {
          cardKey,
          dueDate: toDate(row.data.dueDate ?? row.data.due_date) ?? now,
          minimumAmountDue: toNumber(row.data.minimumAmountDue ?? row.data.minimum_amount_due),
          totalAmountDue: toNumber(row.data.totalAmountDue ?? row.data.total_amount_due),
          status: String(row.data.status ?? 'DUE'),
          statementSyncMonth: String(row.data.statementSyncMonth ?? row.data.statement_sync_month ?? '') || null,
          updatedBy: actor,
        },
        create: {
          id: `st_${randomUUID()}`,
          tenantId: uid,
          cardId: card.id,
          cardKey,
          statementMonth,
          dueDate: toDate(row.data.dueDate ?? row.data.due_date) ?? now,
          minimumAmountDue: toNumber(row.data.minimumAmountDue ?? row.data.minimum_amount_due),
          totalAmountDue: toNumber(row.data.totalAmountDue ?? row.data.total_amount_due),
          status: String(row.data.status ?? 'DUE'),
          statementSyncMonth: String(row.data.statementSyncMonth ?? row.data.statement_sync_month ?? '') || null,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
        },
      })
    }
  }

  // 5) transactions from dailyCardExpenses
  for (const row of expensesRaw) {
    const cardKey = normalizeCardKey(row.data.card)
    const card = cardMap.get(cardKey)
    if (!card) continue
    const sourceTxnId = String(row.data.id ?? row.id ?? `txn_${randomUUID()}`)
    const externalId = String(row.data.dedupeKey ?? row.data.dedupe_key ?? row.id ?? '').trim() || null
    const txnDate = toDate(row.data.txnDate ?? row.data.txn_date) ?? now
    if (!dryRun) {
      const createData = {
        id: sourceTxnId,
        tenantId: uid,
        cardId: card.id,
        statementId: null,
        txnDate,
        amount: toNumber(row.data.amount),
        merchant: String(row.data.merchant ?? ''),
        channel: String(row.data.channel ?? ''),
        txnTimestamp: toDate(row.data.txnTimestamp ?? row.data.txn_timestamp),
        bankKey: String(row.data.bankKey ?? row.data.bank_key ?? '') || null,
        emailId: String(row.data.emailId ?? row.data.email_id ?? '') || null,
        dedupeKey: String(row.data.dedupeKey ?? row.data.dedupe_key ?? '') || null,
        importedAt: toDate(row.data.importedAt ?? row.data.imported_at),
        referenceNo: String(row.data.referenceNo ?? row.data.reference_no ?? '') || null,
        externalId,
        createdAt: toDate(row.data.importedAt ?? row.data.imported_at ?? row.data.createdAt) ?? now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
      }
      if (externalId) {
        await prisma.transaction.upsert({
          where: { tenantId_externalId: { tenantId: uid, externalId } },
          update: {
            txnDate: createData.txnDate,
            amount: createData.amount,
            merchant: createData.merchant,
            channel: createData.channel,
            txnTimestamp: createData.txnTimestamp,
            bankKey: createData.bankKey,
            emailId: createData.emailId,
            dedupeKey: createData.dedupeKey,
            importedAt: createData.importedAt,
            referenceNo: createData.referenceNo,
            updatedBy: actor,
          },
          create: createData,
        })
      } else {
        await prisma.transaction.upsert({
          where: { id: sourceTxnId },
          update: {
            cardId: createData.cardId,
            statementId: createData.statementId,
            txnDate: createData.txnDate,
            txnTimestamp: createData.txnTimestamp,
            amount: createData.amount,
            merchant: createData.merchant,
            channel: createData.channel,
            bankKey: createData.bankKey,
            emailId: createData.emailId,
            dedupeKey: createData.dedupeKey,
            importedAt: createData.importedAt,
            referenceNo: createData.referenceNo,
            updatedBy: actor,
          },
          create: createData,
        })
      }
    }
  }

  // 6) settings from pft_config/settings
  const pick = (k: string, d = 0): number => toNumber(settingsRaw[k], d)
  if (!dryRun) {
    await prisma.pftSetting.upsert({
      where: { tenantId: uid },
      update: {
        currency: String(settingsRaw.currency ?? 'INR'),
        defaultSalary: pick('default_salary'),
        defaultOtherIncome: pick('default_other_income'),
        defaultRent: pick('default_rent'),
        defaultCook: pick('default_cook'),
        defaultLoanRepayment: pick('default_loan_repayment'),
        defaultSip: pick('default_sip'),
        defaultInvestment: pick('default_investment'),
        defaultLiquidSaved: pick('default_liquid_saved'),
        defaultBills: pick('default_bills'),
        defaultBasicExpenses: pick('default_basic_expenses'),
        defaultOtherExpenses: pick('default_other_expenses'),
        prevLiquidBalance: pick('prev_liquid_balance'),
        prevInvestmentBalance: pick('prev_investment_balance'),
        stashBalance: pick('stash_balance'),
        dashboardYearRange: String(settingsRaw.dashboard_year_range ?? settingsRaw.dashboardYearRange ?? '') || null,
        updatedBy: actor,
      },
      create: {
        id: `pst_${randomUUID()}`,
        tenantId: uid,
        currency: String(settingsRaw.currency ?? 'INR'),
        defaultSalary: pick('default_salary'),
        defaultOtherIncome: pick('default_other_income'),
        defaultRent: pick('default_rent'),
        defaultCook: pick('default_cook'),
        defaultLoanRepayment: pick('default_loan_repayment'),
        defaultSip: pick('default_sip'),
        defaultInvestment: pick('default_investment'),
        defaultLiquidSaved: pick('default_liquid_saved'),
        defaultBills: pick('default_bills'),
        defaultBasicExpenses: pick('default_basic_expenses'),
        defaultOtherExpenses: pick('default_other_expenses'),
        prevLiquidBalance: pick('prev_liquid_balance'),
        prevInvestmentBalance: pick('prev_investment_balance'),
        stashBalance: pick('stash_balance'),
        dashboardYearRange: String(settingsRaw.dashboard_year_range ?? settingsRaw.dashboardYearRange ?? '') || null,
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
      },
    })
  }

  // 7) monthly plans
  for (const row of monthlyPlansRaw) {
    const month = toNumber(row.data.month)
    const year = toNumber(row.data.year)
    if (!month || !year) continue
    if (!dryRun) {
      await prisma.monthlyPlan.upsert({
        where: { tenantId_year_month: { tenantId: uid, year, month } },
        update: {
          rent: toNumber(row.data.rent),
          cook: toNumber(row.data.cook),
          sip: toNumber(row.data.sip),
          bills: toNumber(row.data.bills),
          basicCcSpent: toNumber(row.data.basicCcSpent ?? row.data.basic_cc_spent),
          loanPayments: (row.data.loanPayments ?? row.data.loan_payments ?? []) as object,
          investment: toNumber(row.data.investment),
          liquidSaved: toNumber(row.data.liquidSaved ?? row.data.liquid_saved),
          otherExpenses: toNumber(row.data.otherExpenses ?? row.data.other_expenses),
          customExpenses: (row.data.customExpenses ?? row.data.custom_expenses ?? []) as object,
          salary: toNumber(row.data.salary),
          otherIncome: toNumber(row.data.otherIncome ?? row.data.other_income),
          banks: (row.data.banks ?? {}) as object,
          remarks: String(row.data.remarks ?? ''),
          updatedBy: actor,
        },
        create: {
          id: String(row.data.id ?? row.id ?? `mpl_${randomUUID()}`),
          tenantId: uid,
          month,
          year,
          rent: toNumber(row.data.rent),
          cook: toNumber(row.data.cook),
          sip: toNumber(row.data.sip),
          bills: toNumber(row.data.bills),
          basicCcSpent: toNumber(row.data.basicCcSpent ?? row.data.basic_cc_spent),
          loanPayments: (row.data.loanPayments ?? row.data.loan_payments ?? []) as object,
          investment: toNumber(row.data.investment),
          liquidSaved: toNumber(row.data.liquidSaved ?? row.data.liquid_saved),
          otherExpenses: toNumber(row.data.otherExpenses ?? row.data.other_expenses),
          customExpenses: (row.data.customExpenses ?? row.data.custom_expenses ?? []) as object,
          salary: toNumber(row.data.salary),
          otherIncome: toNumber(row.data.otherIncome ?? row.data.other_income),
          banks: (row.data.banks ?? {}) as object,
          remarks: String(row.data.remarks ?? ''),
          createdAt: toDate(row.data.createdAt) ?? now,
          updatedAt: toDate(row.data.updatedAt) ?? now,
          createdBy: actor,
          updatedBy: actor,
        },
      })
    }
  }

  // 8) bills
  for (const row of billsRaw) {
    if (!dryRun) {
      await prisma.bill.upsert({
        where: { id: String(row.data.id ?? row.id ?? `bil_${randomUUID()}`) },
        update: {
          name: String(row.data.name ?? ''),
          amount: toNumber(row.data.amount),
          dueDay: toNumber(row.data.dueDay ?? row.data.due_day),
          frequency: String(row.data.frequency ?? 'MONTHLY'),
          category: String(row.data.category ?? 'GENERAL'),
          status: String(row.data.status ?? 'ACTIVE'),
          updatedBy: actor,
        },
        create: {
          id: String(row.data.id ?? row.id ?? `bil_${randomUUID()}`),
          tenantId: uid,
          name: String(row.data.name ?? ''),
          amount: toNumber(row.data.amount),
          dueDay: toNumber(row.data.dueDay ?? row.data.due_day),
          frequency: String(row.data.frequency ?? 'MONTHLY'),
          category: String(row.data.category ?? 'GENERAL'),
          status: String(row.data.status ?? 'ACTIVE'),
          createdAt: toDate(row.data.createdAt) ?? now,
          updatedAt: toDate(row.data.updatedAt) ?? now,
          createdBy: actor,
          updatedBy: actor,
        },
      })
    }
  }

  // 9) loans
  for (const row of loansRaw) {
    if (!dryRun) {
      await prisma.loan.upsert({
        where: { id: String(row.data.id ?? row.id ?? `lon_${randomUUID()}`) },
        update: {
          name: String(row.data.name ?? ''),
          principal: toNumber(row.data.principal),
          emi: toNumber(row.data.emi),
          rate: toNumber(row.data.rate),
          startDate: toDate(row.data.startDate ?? row.data.start_date) ?? now,
          tenureMonths: toNumber(row.data.tenureMonths ?? row.data.tenure_months),
          status: String(row.data.status ?? 'ACTIVE'),
          updatedBy: actor,
        },
        create: {
          id: String(row.data.id ?? row.id ?? `lon_${randomUUID()}`),
          tenantId: uid,
          name: String(row.data.name ?? ''),
          principal: toNumber(row.data.principal),
          emi: toNumber(row.data.emi),
          rate: toNumber(row.data.rate),
          startDate: toDate(row.data.startDate ?? row.data.start_date) ?? now,
          tenureMonths: toNumber(row.data.tenureMonths ?? row.data.tenure_months),
          status: String(row.data.status ?? 'ACTIVE'),
          createdAt: toDate(row.data.createdAt) ?? now,
          updatedAt: toDate(row.data.updatedAt) ?? now,
          createdBy: actor,
          updatedBy: actor,
        },
      })
    }
  }

  const final = {
    dryRun,
    tenantId: uid,
    cardsPrepared: cardMap.size,
    statementsPrepared: statementSeen.size,
    transactionsPrepared: expensesRaw.length,
    monthlyPlansPrepared: monthlyPlansRaw.length,
    billsPrepared: billsRaw.length,
    loansPrepared: loansRaw.length,
    settingsPrepared: true,
  }
  console.log('Migration summary:', JSON.stringify(final, null, 2))
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
