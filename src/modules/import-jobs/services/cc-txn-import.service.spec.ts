import { appConfig } from '@/config/app.config'
import { CcTxnImportService } from '@/modules/import-jobs/services/cc-txn-import.service'
import { ParsedBankTransaction, PolledMessage } from '@/modules/import-jobs/types/import-contracts'

type WalletCard = {
  id: string
  tenantId: string
  cardKey: string
  issuer: string
  last4: string
  status: string
}

const TENANT = 'tenant-42'
const SBI_LABEL = 'CC Transactions/SBI'
const SBI_BANK_KEY = `LABEL:${SBI_LABEL}`
const HDFC_LABEL = 'CC Transactions/HDFC'
const HDFC_BANK_KEY = `LABEL:${HDFC_LABEL}`

function sbiRegexBody(last4: string, amount = '150.00'): string {
  return `INR ${amount} to FOO STORE on 01-03-2026 ending with ${last4} UPI Ref No. REF${last4}`
}

function message(partial: Partial<PolledMessage> & Pick<PolledMessage, 'id'>): PolledMessage {
  return {
    receivedAtMs: 1_700_000_000_000,
    from: 'alerts@sbi.co.in',
    subject: 'Txn alert',
    body: sbiRegexBody('5965'),
    ...partial,
  }
}

function card(partial: Partial<WalletCard> & Pick<WalletCard, 'cardKey' | 'issuer' | 'last4'>): WalletCard {
  return {
    id: `card-${partial.last4}`,
    tenantId: TENANT,
    status: 'ACTIVE',
    ...partial,
  }
}

function parsedSbi(last4: string): ParsedBankTransaction {
  return {
    txnDate: '2026-03-01',
    txnTimestamp: '2026-03-01T00:00:00.000Z',
    account: 'SBI',
    cardLast4: last4,
    amount: 150,
    merchant: 'FOO STORE',
    channel: 'UPI',
    referenceNo: `REF${last4}`,
    bankKey: 'SBI_XX5965',
    emailId: `msg-${last4}`,
    importedAt: '2026-03-01T00:00:00.000Z',
  }
}

describe('CcTxnImportService run persistence', () => {
  it('stores tenantId on import run rows', async () => {
    const prisma = {
      card: { findMany: jest.fn().mockResolvedValue([]) },
      importJobRun: { create: jest.fn().mockResolvedValue(null) },
    }
    const service = new CcTxnImportService(
      prisma as never,
      { listChildLabels: jest.fn().mockResolvedValue([]) } as never,
      { sendFailureEmail: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { parseBatch: jest.fn() } as never,
    )

    const summary = await service.runImport({
      tenantId: TENANT,
      dryRun: true,
      bankKeys: ['UNKNOWN_BANK'],
    })

    expect(summary.status).toBe('OK')
    expect(prisma.importJobRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobKey: 'cc_txn_import',
          tenantId: TENANT,
        }),
      }),
    )
  })
})

describe('CcTxnImportService wallet-routed import', () => {
  const originalGap = appConfig.importTxnGeminiBatchGapMs

  beforeEach(() => {
    appConfig.importTxnGeminiBatchGapMs = 0
  })

  afterEach(() => {
    appConfig.importTxnGeminiBatchGapMs = originalGap
    jest.restoreAllMocks()
  })

  function setup(options: {
    cards: WalletCard[]
    labels?: Array<{ id: string; name: string; leaf: string }>
    messagesByLabel?: Record<string, PolledMessage[]>
    jobStates?: Record<string, { watermarkIso: string; watermarkCutoffMs: number }>
    gemini?: (input: { issuer: string; messages: Array<{ id: string }> }) => Promise<unknown>
    parseSbi?: (msg: PolledMessage) => ParsedBankTransaction | null
    parseHdfc?: (msg: PolledMessage) => ParsedBankTransaction | null
  }) {
    const states = options.jobStates ?? {}
    const prisma = {
      card: {
        findMany: jest.fn().mockResolvedValue(options.cards),
        findFirst: jest.fn(async ({ where }: { where: { tenantId: string; cardKey: string } }) => {
          const found = options.cards.find(
            (row) => row.tenantId === where.tenantId && row.cardKey === where.cardKey,
          )
          return found ? { id: found.id, tenantId: found.tenantId } : null
        }),
      },
      importJobState: {
        findUnique: jest.fn(async ({ where }: { where: { jobKey_bankKey: { bankKey: string } } }) => {
          return states[where.jobKey_bankKey.bankKey] ?? null
        }),
        findMany: jest.fn().mockResolvedValue(Object.keys(states).map((bankKey) => ({ bankKey }))),
        upsert: jest.fn().mockResolvedValue(null),
      },
      importJobRun: { create: jest.fn().mockResolvedValue(null) },
      transaction: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }: { data: { id?: string } }) => ({
          id: data.id ?? `txn-${Math.random().toString(16).slice(2)}`,
        })),
      },
    }
    const gmail = {
      listChildLabels: jest.fn().mockResolvedValue(options.labels ?? []),
      pollByLabel: jest.fn(async (_tenant: string, labelName: string) => options.messagesByLabel?.[labelName] ?? []),
      fetchByMessageId: jest.fn(),
      prepareGeminiBody: jest.fn((raw: string, maxLen: number) => raw.slice(0, maxLen)),
    }
    const importFailure = {
      upsertFailure: jest.fn().mockResolvedValue(undefined),
      markResolved: jest.fn(),
      markRetrying: jest.fn(),
      markOpenWithError: jest.fn(),
    }
    const gemini = {
      parseBatch: jest.fn(
        options.gemini ??
          (async (input: { messages: Array<{ id: string }> }) => ({
            ok: true,
            byMessageId: Object.fromEntries(
              input.messages.map((row) => [row.id, { ok: false, skipReason: 'unused' }]),
            ),
          })),
      ),
    }
    const sbiParser = { parse: jest.fn(options.parseSbi ?? (() => null)) }
    const hdfcParser = { parse: jest.fn(options.parseHdfc ?? (() => null)) }
    const iciciParser = { parse: jest.fn(() => null) }

    const service = new CcTxnImportService(
      prisma as never,
      gmail as never,
      { sendFailureEmail: jest.fn() } as never,
      importFailure as never,
      sbiParser as never,
      hdfcParser as never,
      iciciParser as never,
      gemini as never,
    )

    return { service, prisma, gmail, importFailure, gemini, sbiParser, hdfcParser }
  }

  it('inserts two SBI wallet last4s and writes one LABEL watermark', async () => {
    const cards = [
      card({ cardKey: 'SBI_XX5965', issuer: 'SBI', last4: '5965' }),
      card({ cardKey: 'SBI_XX1111', issuer: 'SBI', last4: '1111' }),
    ]
    const { service, prisma, gemini } = setup({
      cards,
      labels: [{ id: 'lbl-sbi', name: SBI_LABEL, leaf: 'SBI' }],
      messagesByLabel: {
        [SBI_LABEL]: [
          message({ id: 'sbi-5965', body: sbiRegexBody('5965') }),
          message({ id: 'sbi-1111', body: sbiRegexBody('1111'), receivedAtMs: 1_700_000_000_100 }),
        ],
      },
      gemini: async () => ({
        ok: true,
        byMessageId: {
          'sbi-5965': { ok: true, last4: '5965', amount: 150, merchant: 'FOO', txnDate: '2026-03-01' },
          'sbi-1111': { ok: true, last4: '1111', amount: 90, merchant: 'BAR', txnDate: '2026-03-01' },
        },
      }),
    })

    const summary = await service.runImport({ tenantId: TENANT })

    expect(summary.aggregate.inserted).toBe(2)
    expect(prisma.transaction.create).toHaveBeenCalledTimes(2)
    expect(prisma.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, cardKey: 'SBI_XX5965' } }),
    )
    expect(prisma.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, cardKey: 'SBI_XX1111' } }),
    )
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankKey: SBI_BANK_KEY }),
      }),
    )
    expect(prisma.importJobState.upsert).toHaveBeenCalledTimes(1)
    expect(prisma.importJobState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobKey_bankKey: { jobKey: 'cc_txn_import', bankKey: SBI_BANK_KEY } },
      }),
    )
    expect(gemini.parseBatch).toHaveBeenCalledWith(
      expect.objectContaining({ issuer: 'SBI' }),
    )
  })

  it('does not match AUSFB folder to AU_* wallet cards', async () => {
    const { service, prisma, gmail } = setup({
      cards: [card({ cardKey: 'AU_XX1234', issuer: 'AU', last4: '1234' })],
      labels: [{ id: 'lbl-ausfb', name: 'CC Transactions/AUSFB', leaf: 'AUSFB' }],
      messagesByLabel: {
        'CC Transactions/AUSFB': [message({ id: 'ausfb-1' })],
      },
    })

    const summary = await service.runImport({ tenantId: TENANT })

    expect(summary.status).toBe('OK')
    expect(gmail.pollByLabel).not.toHaveBeenCalled()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(prisma.importJobState.upsert).not.toHaveBeenCalled()
  })

  it('processes HDFC mail from a random sender with no allowlist skip', async () => {
    const { service, prisma, importFailure } = setup({
      cards: [card({ cardKey: 'HDFC_XX9335', issuer: 'HDFC', last4: '9335' })],
      labels: [{ id: 'lbl-hdfc', name: HDFC_LABEL, leaf: 'HDFC' }],
      messagesByLabel: {
        [HDFC_LABEL]: [
          message({
            id: 'hdfc-rand',
            from: 'random-sender@example.com',
            subject: 'HDFC alert',
            body: 'card spend',
          }),
        ],
      },
      gemini: async () => ({
        ok: true,
        byMessageId: {
          'hdfc-rand': { ok: true, last4: '9335', amount: 500, merchant: 'STORE', txnDate: '2026-03-02' },
        },
      }),
    })

    const summary = await service.runImport({ tenantId: TENANT })

    expect(summary.aggregate.inserted).toBe(1)
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankKey: HDFC_BANK_KEY }),
      }),
    )
    expect(importFailure.upsertFailure).not.toHaveBeenCalled()
  })

  it('records card_missing for unknown last4 and still advances the watermark', async () => {
    const { service, prisma, importFailure } = setup({
      cards: [card({ cardKey: 'SBI_XX5965', issuer: 'SBI', last4: '5965' })],
      labels: [{ id: 'lbl-sbi', name: SBI_LABEL, leaf: 'SBI' }],
      messagesByLabel: {
        [SBI_LABEL]: [message({ id: 'sbi-unknown', receivedAtMs: 9_000 })],
      },
      gemini: async () => ({
        ok: true,
        byMessageId: {
          'sbi-unknown': { ok: true, last4: '0000', amount: 12, merchant: 'X', txnDate: '2026-03-01' },
        },
      }),
    })

    const summary = await service.runImport({ tenantId: TENANT })

    expect(summary.banks[0].stats.cardMissing).toBe(1)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(importFailure.upsertFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        bankKey: SBI_BANK_KEY,
        failureType: 'CARD_NOT_FOUND',
        failureReason: 'card_missing',
      }),
    )
    expect(prisma.importJobState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobKey_bankKey: { jobKey: 'cc_txn_import', bankKey: SBI_BANK_KEY } },
        create: expect.objectContaining({ watermarkCutoffMs: 9000n }),
      }),
    )
  })

  it('falls back to SBI regex when Gemini batch is ok:false', async () => {
    const { service, prisma, sbiParser } = setup({
      cards: [card({ cardKey: 'SBI_XX5965', issuer: 'SBI', last4: '5965' })],
      labels: [{ id: 'lbl-sbi', name: SBI_LABEL, leaf: 'SBI' }],
      messagesByLabel: {
        [SBI_LABEL]: [message({ id: 'sbi-regex', body: sbiRegexBody('5965') })],
      },
      gemini: async () => ({ ok: false, error: '429' }),
      parseSbi: (msg) => ({ ...parsedSbi('5965'), emailId: msg.id }),
    })

    const summary = await service.runImport({ tenantId: TENANT })

    expect(sbiParser.parse).toHaveBeenCalled()
    expect(summary.aggregate.inserted).toBe(1)
    expect(prisma.card.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, cardKey: 'SBI_XX5965' } }),
    )
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ bankKey: SBI_BANK_KEY }),
      }),
    )
  })

  it('upserts a parse failure when Gemini and regex both miss, and still updates watermark', async () => {
    const { service, prisma, importFailure, sbiParser } = setup({
      cards: [card({ cardKey: 'SBI_XX5965', issuer: 'SBI', last4: '5965' })],
      labels: [{ id: 'lbl-sbi', name: SBI_LABEL, leaf: 'SBI' }],
      messagesByLabel: {
        [SBI_LABEL]: [message({ id: 'sbi-miss', receivedAtMs: 8_888, body: 'otp only' })],
      },
      gemini: async () => ({ ok: false, error: 'bad json' }),
      parseSbi: () => null,
    })

    const summary = await service.runImport({ tenantId: TENANT })

    expect(sbiParser.parse).toHaveBeenCalled()
    expect(summary.aggregate.parseMiss).toBe(1)
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(importFailure.upsertFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        bankKey: SBI_BANK_KEY,
        failureType: 'PARSE_MISS',
        failureReason: 'parser_returned_null',
      }),
    )
    expect(prisma.importJobState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobKey_bankKey: { jobKey: 'cc_txn_import', bankKey: SBI_BANK_KEY } },
        create: expect.objectContaining({ watermarkCutoffMs: 8888n }),
      }),
    )
  })

  it('copies the legacy SBI_XX5965 watermark when the LABEL key is absent', async () => {
    const legacyCutoff = 1_000_000
    const { service, prisma, gmail } = setup({
      cards: [card({ cardKey: 'SBI_XX5965', issuer: 'SBI', last4: '5965' })],
      labels: [{ id: 'lbl-sbi', name: SBI_LABEL, leaf: 'SBI' }],
      jobStates: {
        SBI_XX5965: {
          watermarkIso: new Date(legacyCutoff).toISOString(),
          watermarkCutoffMs: legacyCutoff,
        },
      },
      messagesByLabel: {
        [SBI_LABEL]: [
          message({ id: 'old', receivedAtMs: 500_000 }),
          message({
            id: 'new',
            receivedAtMs: 2_000_000,
            body: sbiRegexBody('5965'),
          }),
        ],
      },
      gemini: async () => ({
        ok: true,
        byMessageId: {
          new: { ok: true, last4: '5965', amount: 20, merchant: 'M', txnDate: '2026-03-01' },
        },
      }),
    })

    await service.runImport({ tenantId: TENANT })

    expect(prisma.importJobState.findUnique).toHaveBeenCalledWith({
      where: { jobKey_bankKey: { jobKey: 'cc_txn_import', bankKey: SBI_BANK_KEY } },
    })
    expect(prisma.importJobState.findUnique).toHaveBeenCalledWith({
      where: { jobKey_bankKey: { jobKey: 'cc_txn_import', bankKey: 'SBI_XX5965' } },
    })
    const buffered = new Date(legacyCutoff)
    buffered.setDate(buffered.getDate() - 1)
    expect(gmail.pollByLabel).toHaveBeenCalledWith(TENANT, SBI_LABEL, buffered.toISOString().slice(0, 10))
    expect(prisma.transaction.create).toHaveBeenCalledTimes(1)
    expect(prisma.importJobState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobKey_bankKey: { jobKey: 'cc_txn_import', bankKey: SBI_BANK_KEY } },
        create: expect.objectContaining({ watermarkCutoffMs: 2000000n }),
      }),
    )
  })

  it('drains 6 messages as two Gemini batches and sleeps once between them', async () => {
    appConfig.importTxnGeminiBatchGapMs = 10
    const msgs = Array.from({ length: 6 }, (_, i) =>
      message({
        id: `m${i + 1}`,
        receivedAtMs: 1_700_000_000_000 + i,
        body: sbiRegexBody('5965'),
      }),
    )
    const { service, gemini } = setup({
      cards: [card({ cardKey: 'SBI_XX5965', issuer: 'SBI', last4: '5965' })],
      labels: [{ id: 'lbl-sbi', name: SBI_LABEL, leaf: 'SBI' }],
      messagesByLabel: { [SBI_LABEL]: msgs },
      gemini: async (input) => ({
        ok: true,
        byMessageId: Object.fromEntries(
          input.messages.map((row) => [
            row.id,
            { ok: true, last4: '5965', amount: 10, merchant: 'M', txnDate: '2026-03-01' },
          ]),
        ),
      }),
    })
    const sleep = jest
      .spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep')
      .mockResolvedValue(undefined)

    await service.runImport({ tenantId: TENANT })

    expect(gemini.parseBatch).toHaveBeenCalledTimes(2)
    expect(gemini.parseBatch.mock.calls[0][0].messages).toHaveLength(5)
    expect(gemini.parseBatch.mock.calls[1][0].messages).toHaveLength(1)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(10)
  })
})
