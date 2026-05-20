export type ImportJobStatus = 'OK' | 'PARTIAL' | 'FAILURE' | 'SKIPPED_LOCKED'

export type ImportWindowSource = 'watermark' | 'firestore_max_txn' | 'none'

export type BankParserName = 'parseSbiTxn' | 'parseHdfcTxn' | 'parseIciciTxn'

export interface BankConfig {
  bankKey: string
  account: string
  cardLast4?: string
  knownCards?: string[]
  labelName: string
  parserName: BankParserName
  senderAllowlist?: string[]
  fallbackStartDate: string
}

export interface ImportWindow {
  startDate: string | null
  source: ImportWindowSource
  watermarkCutoffMs: number | null
}

export interface ParsedBankTransaction {
  txnDate: string
  txnTimestamp: string
  account: string
  cardLast4: string
  amount: number
  merchant: string
  channel: string
  referenceNo?: string
  bankKey: string
  emailId: string
  importedAt: string
}

export interface PersistableTransaction {
  txnDate: Date
  txnTimestamp: Date | null
  cardKey: string
  amount: number
  merchant: string
  channel: string
  bankKey: string
  emailId: string
  dedupeKey: string
  importedAt: Date
  referenceNo: string | null
  externalId: string | null
}

export interface BankImportStats {
  messages: number
  messagesFromSearch: number
  inserted: number
  duplicates: number
  skipped: number
  parseMiss: number
  parseErrors: number
}

export interface BankImportResult {
  bankKey: string
  summary: string
  stats: BankImportStats
  error?: string
}

export interface ImportRunSummary {
  job: 'cc_txn_import'
  status: ImportJobStatus
  startedAt: string
  completedAt: string
  elapsedMs: number
  failureCount: number
  aggregate: BankImportStats
  spendCapAlertSent: boolean
  spendCap?: number
  spendThreshold?: number
  combinedCycleSpend?: number
  banks: BankImportResult[]
}

export interface PolledMessage {
  id: string
  receivedAtMs: number
  from: string
  subject: string
  body: string
}
