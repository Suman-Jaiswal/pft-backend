import { Injectable } from '@nestjs/common'
import { ParsedBankTransaction, PolledMessage } from '@/modules/import-jobs/types/import-contracts'

@Injectable()
export class SbiParser {
  parse(message: PolledMessage): ParsedBankTransaction | null {
    const source = `${message.subject}\n${message.body}`
    const amountMatch = source.match(/(?:INR|Rs\.?|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : NaN
    if (!Number.isFinite(amount)) return null

    if (this.shouldSkipNonPostedTxn(source, amount)) return null

    const merchant =
      (
        source.match(/(?:to|at)\s+([A-Z0-9*._\-/ ]+?)\s+on\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/i)?.[1] ??
        source.match(/in favour of\s+([A-Z0-9*._\-/ ]+?)(?:\.|\n|$)/i)?.[1] ??
        'SBI TXN'
      ).trim()
    const referenceNo =
      (
        source.match(/UPI Ref No[:\s-]*([A-Z0-9]+)/i)?.[1] ??
        source.match(/Ref(?:erence)?\s*(?:No|Number)?[:\s-]*([A-Z0-9]+)/i)?.[1] ??
        ''
      ).trim()
    const last4 = (message.body.match(/(?:XX|x{2})(\d{4})/)?.[1] ?? '').trim()
    if (!last4) return null

    const ts = new Date(message.receivedAtMs).toISOString()
    return {
      txnDate: ts.slice(0, 10),
      txnTimestamp: ts,
      account: 'SBI',
      cardLast4: last4,
      amount,
      merchant: this.normalizeMerchant(merchant),
      channel: this.detectChannel(source),
      referenceNo: referenceNo || undefined,
      bankKey: 'SBI_5965',
      emailId: message.id,
      importedAt: new Date().toISOString(),
    }
  }

  private shouldSkipNonPostedTxn(text: string, amount: number): boolean {
    const source = text.toUpperCase()
    if (amount <= 0) return true
    return (
      source.includes('DECLINED') ||
      source.includes('FAILED') ||
      source.includes('FAILURE') ||
      source.includes('REVERSED') ||
      source.includes('REVERSAL') ||
      source.includes('VOID') ||
      source.includes('CANCELLED') ||
      source.includes('CANCELED') ||
      source.includes('VERIFICATION') ||
      source.includes('VERIFY')
    )
  }

  private normalizeMerchant(value: string): string {
    return value
      .replace(/\s+/g, ' ')
      .replace(/[.]+$/, '')
      .trim()
  }

  private detectChannel(text: string): string {
    const source = text.toUpperCase()
    if (source.includes('UPI')) return 'UPI'
    if (source.includes('ONLINE') || source.includes('ECOM')) return 'ONLINE'
    if (source.includes('POS') || source.includes('CONTACTLESS')) return 'POS'
    return 'CARD'
  }
}
