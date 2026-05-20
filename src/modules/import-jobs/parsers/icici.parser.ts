import { Injectable } from '@nestjs/common'
import { ParsedBankTransaction, PolledMessage } from '@/modules/import-jobs/types/import-contracts'

@Injectable()
export class IciciParser {
  parse(message: PolledMessage): ParsedBankTransaction | null {
    const amountMatch = message.body.match(/(?:INR|Rs\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : NaN
    if (!Number.isFinite(amount)) return null

    const merchant = (message.body.match(/(?:at|towards)\s+([A-Za-z0-9 .&-]{3,80})/i)?.[1] ?? 'UNKNOWN').trim()
    const referenceNo = (message.body.match(/(?:Ref|Reference|Txn)\s*[:#-]?\s*([A-Za-z0-9-]+)/i)?.[1] ?? '').trim()
    const last4 = (message.body.match(/(?:XX|xx)(\d{4})/)?.[1] ?? '').trim()
    if (!last4) return null

    const ts = new Date(message.receivedAtMs).toISOString()
    return {
      txnDate: ts.slice(0, 10),
      txnTimestamp: ts,
      account: 'ICICI',
      cardLast4: last4,
      amount,
      merchant,
      channel: 'UNKNOWN',
      referenceNo: referenceNo || undefined,
      bankKey: 'ICICI_SHARED',
      emailId: message.id,
      importedAt: new Date().toISOString(),
    }
  }
}
