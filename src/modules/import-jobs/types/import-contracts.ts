export type ImportJobStatus = 'OK' | 'PARTIAL' | 'FAILURE' | 'SKIPPED_LOCKED'
export type ImportErrorCode = 'REAUTH_REQUIRED'

export type ImportWindowSource = 'watermark' | 'firestore_max_txn' | 'none'
export type ImportFailureStatus = 'OPEN' | 'RETRYING' | 'RESOLVED' | 'IGNORED'
export type ImportFailureType = 'PARSE_MISS' | 'PARSE_ERROR' | 'CARD_RULE_MISMATCH' | 'WRITE_FAILED' | 'CARD_NOT_FOUND'

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
  writeFailures?: number
  cardMissing?: number
}

export interface BankImportResult {
  bankKey: string
  summary: string
  stats: BankImportStats
  error?: string
  errorCode?: ImportErrorCode
}

export interface ImportRunSummary {
  job: 'cc_txn_import'
  status: ImportJobStatus
  errorCode?: ImportErrorCode
  reauthRequired?: boolean
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

export interface ImportFailureRecord {
  id: string
  jobKey: string
  bankKey: string
  messageId: string
  receivedAtMs: number | null
  fromAddress: string | null
  subject: string | null
  bodyPreview: string | null
  failureType: ImportFailureType
  failureReason: string
  errorText: string | null
  status: ImportFailureStatus
  attemptCount: number
  firstSeenAt: string
  lastSeenAt: string
  lastRetriedAt: string | null
  resolvedAt: string | null
  resolvedTxnId: string | null
  createdAt: string
  updatedAt: string
}

export interface ImportFailureListResult {
  items: ImportFailureRecord[]
  total: number
  page: number
  pageSize: number
}

export interface ImportFailureRetryResult {
  selected: number
  attempted: number
  resolved: number
  stillOpen: number
  notFoundInGmail: number
  bankBreakdown: Record<string, { attempted: number; resolved: number; stillOpen: number; notFoundInGmail: number }>
}

export interface WatermarkRebaseResult {
  dryRun: boolean
  days: number
  rebasedAtIso: string
  banks: Array<{
    bankKey: string
    watermarkIso: string
    watermarkCutoffMs: number
    updated: boolean
  }>
}
