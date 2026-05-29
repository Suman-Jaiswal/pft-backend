import { Injectable } from '@nestjs/common'
import { ParsedBankTransaction, PolledMessage } from '@/modules/import-jobs/types/import-contracts'

@Injectable()
export class IciciParser {
  parse(message: PolledMessage): ParsedBankTransaction | null {
    const source = `${message.subject}\n${message.body}`
    const amount = this.extractTransactionAmount(source)
    if (!Number.isFinite(amount)) return null

    if (this.shouldSkipNonPostedTxn(source, amount)) return null

    const merchant =
      (
        source.match(/at\s+([A-Z0-9*._\-/ ]+?)(?:\son|\.)/i)?.[1] ??
        source.match(/on\s+([A-Z0-9*._\-/ ]+?)(?:\sat|\.)/i)?.[1] ??
        source.match(/merchant[:\s-]*([A-Z0-9*._\-/ ]+?)(?:\.|\n|$)/i)?.[1] ??
        source.match(/towards\s+([A-Z0-9*._\-/ ]+?)(?:\son|\.)/i)?.[1] ??
        'ICICI TXN'
      ).trim()
    const referenceNo =
      (
        source.match(/reference\s*(?:number|no)?[:\s-]*([A-Z0-9]+)/i)?.[1] ??
        source.match(/rrn[:\s-]*([A-Z0-9]+)/i)?.[1] ??
        source.match(/(?:Ref|Reference)\s*[:#-]?\s*([A-Za-z0-9-]+)/i)?.[1] ??
        ''
      ).trim()
    const last4 =
      (
        source.match(/Credit Card\s*(?:ending|xx|XX|\*+)?\s*([0-9]{4})/i)?.[1] ??
        source.match(/(?:XX|xx)(\d{4})/)?.[1] ??
        source.match(/card\s*([0-9]{4})/i)?.[1] ??
        ''
      ).trim()
    if (!last4) return null

    const ts = new Date(message.receivedAtMs).toISOString()
    return {
      txnDate: ts.slice(0, 10),
      txnTimestamp: ts,
      account: 'ICICI',
      cardLast4: last4,
      amount,
      merchant: this.normalizeMerchant(merchant),
      channel: this.detectChannel(source),
      referenceNo: referenceNo || undefined,
      bankKey: `ICICI_XX${last4}`,
      emailId: message.id,
      importedAt: new Date().toISOString(),
    }
  }

  private extractTransactionAmount(source: string): number {
    const amountMatch =
      source.match(
        /(?:used\s+for\s+a\s+transaction\s+of|transaction\s+of)\s*(?:INR|Rs\.?|USD)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      ) ||
      source.match(
        /(?:has\s+been\s+used\s+for\s+a\s+transaction\s+of)\s*(?:INR|Rs\.?|USD)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
      ) ||
      source.match(/(?:used\s+for|has\s+been\s+used\s+for)\s*(?:INR|Rs\.?|USD)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      source.match(/(?:debited|charged)\s*(?:INR|Rs\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      source.match(/(?:INR|Rs\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:debited|spent|charged)/i) ||
      source.match(/(?:INR|Rs\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)\s+using\s+your\s+ICICI/i)

    if (!amountMatch) return Number.NaN
    return Number(amountMatch[1].replace(/,/g, ''))
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
      source.includes('COULD NOT BE COMPLETED') ||
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
