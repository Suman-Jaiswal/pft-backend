import { Injectable } from '@nestjs/common'
import { ParsedBankTransaction, PolledMessage } from '@/modules/import-jobs/types/import-contracts'

@Injectable()
export class HdfcParser {
  parse(message: PolledMessage): ParsedBankTransaction | null {
    const source = `${message.subject}\n${message.body}`
    const amountMatch = source.match(/(?:Rs\.?|INR|₹)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i)
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : NaN
    if (!Number.isFinite(amount)) return null

    if (this.shouldSkipNonPostedTxn(source, amount)) return null

    const merchant = this.resolveMerchant(source)
    const referenceNo = (source.match(/(?:Ref|Reference|Txn)\s*[:#-]?\s*([A-Za-z0-9-]+)/i)?.[1] ?? '').trim()
    const last4 = (message.body.match(/(?:xx|XX)(\d{4})/)?.[1] ?? '').trim()
    if (!last4) return null

    const ts = new Date(message.receivedAtMs).toISOString()
    return {
      txnDate: ts.slice(0, 10),
      txnTimestamp: ts,
      account: 'HDFC',
      cardLast4: last4,
      amount,
      merchant: merchant || 'HDFC card',
      channel: this.detectChannel(source),
      referenceNo: referenceNo || undefined,
      bankKey: 'HDFC_9335',
      emailId: message.id,
      importedAt: new Date().toISOString(),
    }
  }

  private resolveMerchant(text: string): string {
    const normalized = this.preNormalize(text)
    const patterns = [
      /(?:\bhas been debited\b|\bis debited\b)(?:[\s\S]+?)\btowards\s+([\s\S]+?)\s+on\s*\*?\s*\d{1,2}\s+[A-Za-z]{3,9},?\s*\*?\s*\d{2,4}/i,
      /towards\s+([\s\S]+?)\s+on\s*\*?\s*\d{1,2}[-/][A-Za-z0-9]{2,9}[-/]\d{2,4}/i,
      /towards\s+([\s\S]+?)\s+on\s*\*?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s*\*?\s*\d{2,4}/i,
      /\bat\s+([A-Za-z0-9*._\-/ ]+?)\s+on\s*\*?\s*\d{1,2}[-/][A-Za-z0-9]{2,9}[-/]\d{2,4}/i,
      /(?:\bMerchants?\s*:\s*|\bPayee\s*:\s*|\bBilled to\s*:\s*)([A-Za-z0-9*._\-\s/]+?)(?:\n|$|\.(?!,))/i,
      /\bat\s+([A-Za-z0-9*._\-/ ]+?)(?:\s+Ref[:#-]?\s*[A-Za-z0-9-]+|\.|$)/i,
    ]

    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      if (!match?.[1]) continue
      const merchant = this.tidyMerchantCapture(match[1])
      if (!merchant || this.isJunkMerchant(merchant)) continue
      return this.normalizeMerchant(merchant)
    }

    return 'HDFC card'
  }

  private preNormalize(raw: string): string {
    return String(raw || '')
      .replace(/[\r\n\u00a0\u2028\u2029\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  private tidyMerchantCapture(raw: string): string {
    let value = String(raw || '').replace(/\s+/g, ' ').trim()
    while (value.startsWith('*')) value = value.slice(1).trim()
    while (value.endsWith('*')) value = value.slice(0, -1).trim()
    return value
  }

  private isJunkMerchant(value: string): boolean {
    if (!value) return true
    return /^\*?rs\.?$/i.test(value)
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
      source.includes('VERIFY') ||
      source.includes('AUTHORIZATION') ||
      source.includes('PREAUTH') ||
      source.includes('PRE-AUTH')
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
