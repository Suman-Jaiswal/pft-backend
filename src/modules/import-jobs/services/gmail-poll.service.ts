import { Injectable, Logger } from '@nestjs/common'
import { gmail_v1, google } from 'googleapis'
import { appConfig } from '@/config/app.config'
import { PolledMessage } from '@/modules/import-jobs/types/import-contracts'

@Injectable()
export class GmailPollService {
  private readonly logger = new Logger(GmailPollService.name)

  async pollByLabel(labelName: string, afterDate: string): Promise<PolledMessage[]> {
    const clientId = appConfig.googleClientId
    const clientSecret = appConfig.googleClientSecret
    const refreshToken = appConfig.importGmailRefreshToken
    const userId = appConfig.importGmailUser || 'me'

    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.warn(
        'Gmail import credentials not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, IMPORT_GMAIL_REFRESH_TOKEN.',
      )
      return []
    }

    const gmail = this.getGmailClient(clientId, clientSecret, refreshToken)
    const query = `label:"${labelName}" after:${afterDate.replace(/-/g, '/')}`

    const messageIds = await this.listMessageIdsWithRetry(gmail, userId, query, appConfig.importGmailMaxResults)
    if (!messageIds.length) return []

    const messages = await Promise.all(
      messageIds.map((id) => this.fetchMessageWithRetry(gmail, userId, id)),
    )

    return messages
      .filter((msg): msg is NonNullable<typeof msg> => Boolean(msg))
      .map((msg) => this.mapToPolledMessage(msg))
      .filter((m): m is PolledMessage => Boolean(m))
  }

  async fetchByMessageId(messageId: string): Promise<PolledMessage | null> {
    const clientId = appConfig.googleClientId
    const clientSecret = appConfig.googleClientSecret
    const refreshToken = appConfig.importGmailRefreshToken
    const userId = appConfig.importGmailUser || 'me'

    if (!clientId || !clientSecret || !refreshToken) {
      this.logger.warn(
        'Gmail import credentials not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, IMPORT_GMAIL_REFRESH_TOKEN.',
      )
      return null
    }

    const gmail = this.getGmailClient(clientId, clientSecret, refreshToken)
    const message = await this.fetchMessageWithRetry(gmail, userId, messageId)
    if (!message) return null

    return this.mapToPolledMessage(message)
  }

  private async listMessageIdsWithRetry(
    gmail: ReturnType<typeof google.gmail>,
    userId: string,
    query: string,
    maxResults: number,
  ): Promise<string[]> {
    const pages: string[] = []
    let nextPageToken: string | undefined
    let remaining = Math.max(1, maxResults)

    while (remaining > 0) {
      const pageSize = Math.min(remaining, 500)
      const response = await this.withRetry(async () =>
        gmail.users.messages.list({
          userId,
          q: query,
          maxResults: pageSize,
          pageToken: nextPageToken,
        }),
      )
      const ids = (response.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
      pages.push(...ids)
      remaining -= ids.length
      nextPageToken = response.data.nextPageToken ?? undefined
      if (!nextPageToken || ids.length === 0) break
    }

    return pages
  }

  private async fetchMessageWithRetry(
    gmail: ReturnType<typeof google.gmail>,
    userId: string,
    id: string,
  ) {
    const response = await this.withRetry(async () =>
      gmail.users.messages.get({
        userId,
        id,
        format: 'full',
      }),
    )
    return response.data
  }

  private getGmailClient(clientId: string, clientSecret: string, refreshToken: string) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, appConfig.googleRedirectUri || undefined)
    oauth2Client.setCredentials({ refresh_token: refreshToken })
    return google.gmail({ version: 'v1', auth: oauth2Client })
  }

  private mapToPolledMessage(msg: gmail_v1.Schema$Message): PolledMessage | null {
    const body = this.extractBody(msg.payload)
    const headers = msg.payload?.headers ?? []
    const from = headers.find((h) => h.name?.toLowerCase() === 'from')?.value ?? ''
    const subject = headers.find((h) => h.name?.toLowerCase() === 'subject')?.value ?? ''
    const receivedAtMs = Number(msg.internalDate ?? '0')
    const id = msg.id ?? ''
    if (!id) return null

    return { id, receivedAtMs, from, subject, body }
  }

  private extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return ''
    const direct = payload.body?.data ? this.decodeBase64Url(payload.body.data) : ''
    if (direct) return direct

    const parts = payload.parts ?? []
    for (const part of parts) {
      if (part?.mimeType === 'text/plain' && part?.body?.data) {
        return this.decodeBase64Url(part.body.data)
      }
    }
    for (const part of parts) {
      if (part?.mimeType === 'text/html' && part?.body?.data) {
        return this.stripHtml(this.decodeBase64Url(part.body.data))
      }
    }
    for (const part of parts) {
      const nested = this.extractBody(part)
      if (nested) return nested
    }
    return ''
  }

  private decodeBase64Url(input: string): string {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(normalized, 'base64').toString('utf8')
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        if (i < attempts - 1) {
          const delayMs = 250 * Math.pow(2, i)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }
    throw lastError
  }
}
