import 'reflect-metadata'
import { readFileSync } from 'fs'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { PrismaClient } from '@prisma/client'

type AnyDoc = Record<string, unknown>

function env(name: string): string {
  const v = process.env[name]
  if (!v || !String(v).trim()) throw new Error(`Missing required env: ${name}`)
  return String(v).trim()
}

function toNum(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function fdRupees(v: unknown): number {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return toNum(v)
  const row = v as Record<string, unknown>
  return toNum(row.amount) * toNum(row.quantity)
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (v instanceof Timestamp) return v.toDate()
  const parsed = new Date(String(v ?? ''))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function fetchFs(uid: string, name: string): Promise<Array<{ id: string; data: AnyDoc }>> {
  const db = getFirestore()
  const snap = await db.collection('users').doc(uid).collection(name).get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as AnyDoc }))
}

async function main(): Promise<void> {
  const uid = env('MIGRATION_FIRESTORE_UID')
  if (!getApps().length) {
    const path = env('FIREBASE_SERVICE_ACCOUNT_PATH')
    const serviceAccount = JSON.parse(readFileSync(path, 'utf8'))
    initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
  }
  const prisma = new PrismaClient()
  const [monthlyPlansFs, billsFs, loansFs, latestBillsFs, txFs] = await Promise.all([
    fetchFs(uid, 'monthlyPlans'),
    fetchFs(uid, 'bills'),
    fetchFs(uid, 'loans'),
    fetchFs(uid, 'latestBills'),
    fetchFs(uid, 'dailyCardExpenses'),
  ])

  const [monthlyPlansDb, billsDb, loansDb, cardsDb, statementsDb, txDb] = await Promise.all([
    prisma.monthlyPlan.count({ where: { tenantId: uid } }),
    prisma.bill.count({ where: { tenantId: uid } }),
    prisma.loan.count({ where: { tenantId: uid } }),
    prisma.card.count({ where: { tenantId: uid } }),
    prisma.statement.count({ where: { tenantId: uid } }),
    prisma.transaction.count({ where: { tenantId: uid } }),
  ])

  const firestoreTotals = {
    monthlyPlanInvestment: monthlyPlansFs.reduce(
      (a, r) => a + toNum(r.data.stocks ?? r.data.investment) + fdRupees(r.data.fd),
      0,
    ),
    latestBillsTotalDue: latestBillsFs.reduce((a, r) => a + toNum(r.data.totalAmountDue ?? r.data.total_amount_due), 0),
    txAmount: txFs.reduce((a, r) => a + toNum(r.data.amount), 0),
  }

  const [monthlyPlanRows, statementTotal, transactionTotal] = await Promise.all([
    prisma.monthlyPlan.findMany({ where: { tenantId: uid }, select: { stocks: true, fd: true } }),
    prisma.statement.aggregate({ where: { tenantId: uid }, _sum: { totalAmountDue: true } }),
    prisma.transaction.aggregate({ where: { tenantId: uid }, _sum: { amount: true } }),
  ])
  const dbTotals = {
    monthlyPlanInvestment: monthlyPlanRows.reduce(
      (sum, row) => sum + Number(row.stocks) + fdRupees(row.fd),
      0,
    ),
    latestBillsTotalDue: Number(statementTotal._sum.totalAmountDue ?? 0),
    txAmount: Number(transactionTotal._sum.amount ?? 0),
  }

  const report = {
    tenantId: uid,
    counts: {
      firestore: {
        monthlyPlans: monthlyPlansFs.length,
        bills: billsFs.length,
        loans: loansFs.length,
        latestBills: latestBillsFs.length,
        transactions: txFs.length,
      },
      postgres: {
        monthlyPlans: monthlyPlansDb,
        bills: billsDb,
        loans: loansDb,
        cards: cardsDb,
        statements: statementsDb,
        transactions: txDb,
      },
    },
    totals: { firestore: firestoreTotals, postgres: dbTotals },
    generatedAt: toDate(new Date())?.toISOString(),
  }
  console.log(JSON.stringify(report, null, 2))
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
