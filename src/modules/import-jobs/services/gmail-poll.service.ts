import { Injectable, Logger } from '@nestjs/common'
import { gmail_v1, google } from 'googleapis'
import { appConfig } from '@/config/app.config'
import { PolledMessage } from '@/modules/import-jobs/types/import-contracts'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { isGoogleAuthError } from '@/modules/import-jobs/services/import-auth-error.util'
import {
  listDirectChildLabels,
  prepareGeminiBody as clipGeminiBody,
  stripHtml,
} from '@/modules/import-jobs/services/gmail-label.util'

export { listDirectChildLabels, prepareGeminiBody } from '@/modules/import-jobs/services/gmail-label.util'

type GmailCredential = {
  refreshToken: string
  email: string | null
}

@Injectable()
export class GmailPollService {
  private readonly logger = new Logger(GmailPollService.name)
  constructor(private readonly prisma: PrismaService) {}

  async pollByLabel(tenantId: string, labelName: string, afterDate: string): Promise<PolledMessage[]> {
    const clientId = appConfig.googleClientId
    const clientSecret = appConfig.googleClientSecret
    const userId = appConfig.importGmailUser || 'me'
    const credential = await this.loadImportCredential(tenantId)

    if (!clientId || !clientSecret) {
      this.logger.warn('Gmail import credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')
      throw new Error('reauth_required: google_client_credentials_missing')
    }

    const gmail = this.getGmailClient(clientId, clientSecret, credential.refreshToken)
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

  async fetchByMessageId(tenantId: string, messageId: string): Promise<PolledMessage | null> {
    const clientId = appConfig.googleClientId
    const clientSecret = appConfig.googleClientSecret
    const userId = appConfig.importGmailUser || 'me'
    const credential = await this.loadImportCredential(tenantId)

    if (!clientId || !clientSecret) {
      this.logger.warn('Gmail import credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')
      throw new Error('reauth_required: google_client_credentials_missing')
    }

    const gmail = this.getGmailClient(clientId, clientSecret, credential.refreshToken)
    const message = await this.fetchMessageWithRetry(gmail, userId, messageId)
    if (!message) return null

    return this.mapToPolledMessage(message)
  }

  async listChildLabels(
    tenantId: string,
    parentName: string,
  ): Promise<Array<{ id: string; name: string; leaf: string }>> {
    const clientId = appConfig.googleClientId
    const clientSecret = appConfig.googleClientSecret
    const userId = appConfig.importGmailUser || 'me'
    const credential = await this.loadImportCredential(tenantId)

    if (!clientId || !clientSecret) {
      this.logger.warn('Gmail import credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')
      throw new Error('reauth_required: google_client_credentials_missing')
    }

    const gmail = this.getGmailClient(clientId, clientSecret, credential.refreshToken)
    const response = await this.withRetry(async () => gmail.users.labels.list({ userId }))
    const labels = (response.data.labels ?? []).filter(
      (label): label is gmail_v1.Schema$Label & { id: string; name: string } =>
        Boolean(label.id && label.name),
    )
    const children = listDirectChildLabels(
      labels.map((label) => label.name),
      parentName,
    )
    const idByName = new Map(labels.map((label) => [label.name, label.id]))

    return children.flatMap(({ name, leaf }) => {
      const id = idByName.get(name)
      return id ? [{ id, name, leaf }] : []
    })
  }

  prepareGeminiBody(raw: string, maxLen: number): string {
    return clipGeminiBody(raw, maxLen)
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

  private async loadImportCredential(tenantId: string): Promise<GmailCredential> {
    const row = await this.prisma.pftSetting.findUnique({
      where: { tenantId },
      select: { importGmailRefreshToken: true, importGmailEmail: true },
    })
    const refreshToken = row?.importGmailRefreshToken?.trim()
    if (!refreshToken) {
      throw new Error('reauth_required: import_gmail_refresh_token_missing')
    }
    return { refreshToken, email: row?.importGmailEmail ?? null }
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
        return stripHtml(this.decodeBase64Url(part.body.data))
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

  /**
   * googleapis has no default request timeout, and a stalled token refresh or
   * socket will otherwise hang the whole import run indefinitely.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    if (ms <= 0) return promise
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`gmail_timeout: no response in ${ms}ms`)), ms)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    const timeoutMs = appConfig.importGmailTimeoutMs
    let lastError: unknown
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.withTimeout(fn(), timeoutMs)
      } catch (error) {
        lastError = error
        if (isGoogleAuthError(error)) {
          this.logger.warn('Google auth error (invalid_grant / token revoked) — skipping retries')
          throw error
        }
        if (i < attempts - 1) {
          const delayMs = 250 * Math.pow(2, i)
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }
    throw lastError
  }
}
