import 'reflect-metadata'
import * as dotenv from 'dotenv'
dotenv.config()

import { PrismaClient } from '@prisma/client'
import { google } from 'googleapis'

const prisma = new PrismaClient()

const BATCH_SIZE = 20
const DELAY_MS = 300

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env: ${name}`)
  return value
}

function getGmailClient(clientId: string, clientSecret: string, refreshToken: string) {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || undefined
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
  oauth2Client.setCredentials({ refresh_token: refreshToken })
  return google.gmail({ version: 'v1', auth: oauth2Client })
}

function extractBody(payload: any): string {
  if (!payload) return ''
  const direct = payload.body?.data ? decodeBase64Url(payload.body.data) : ''
  if (direct) return direct

  const parts = payload.parts ?? []
  for (const part of parts) {
    if (part?.mimeType === 'text/plain' && part?.body?.data) {
      return decodeBase64Url(part.body.data)
    }
  }
  for (const part of parts) {
    if (part?.mimeType === 'text/html' && part?.body?.data) {
      return stripHtml(decodeBase64Url(part.body.data))
    }
  }
  for (const part of parts) {
    const nested = extractBody(part)
    if (nested) return nested
  }
  return ''
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchMessage(gmail: ReturnType<typeof google.gmail>, messageId: string, attempt = 1): Promise<any> {
  const TIMEOUT_MS = 30000
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Gmail fetch timeout (${TIMEOUT_MS / 1000}s)`)), TIMEOUT_MS),
  )
  try {
    const response = await Promise.race([
      gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' }),
      timeout,
    ])
    return (response as any).data
  } catch (error: any) {
    if (error?.response?.status === 404) return null
    if (attempt < 2 && error?.message?.includes('timeout')) {
      console.log(' RETRY...')
      await sleep(2000)
      return fetchMessage(gmail, messageId, attempt + 1)
    }
    throw error
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const clientId = required('GOOGLE_CLIENT_ID')
  const clientSecret = required('GOOGLE_CLIENT_SECRET')

  const setting = await prisma.pftSetting.findFirst({
    select: { importGmailRefreshToken: true, tenantId: true },
  })
  if (!setting?.importGmailRefreshToken) {
    throw new Error('No import Gmail refresh token found in PftSetting')
  }

  const refreshToken = setting.importGmailRefreshToken
  console.log(`Client ID: ${clientId.slice(0, 12)}...`)
  console.log(`Client Secret: ${clientSecret.slice(0, 6)}...`)
  console.log(`Refresh Token: ${refreshToken.slice(0, 12)}...`)
  console.log(`Redirect URI: ${process.env.GOOGLE_REDIRECT_URI ?? '(not set)'}`)
  console.log('')

  const gmail = getGmailClient(clientId, clientSecret, refreshToken)

  console.log('Warming up Gmail API connection (token exchange)...')
  try {
    const warmupTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Warm-up timeout (20s) — Gmail unreachable from this machine')), 20000),
    )
    const profile = await Promise.race([
      gmail.users.getProfile({ userId: 'me' }),
      warmupTimeout,
    ])
    console.log(`Gmail connection OK — ${(profile as any).data?.emailAddress}\n`)
  } catch (error: any) {
    console.error('\nGmail warm-up failed:', error?.message ?? error)
    console.error('\nPossible causes:')
    console.error('  - Network issue (try curl https://gmail.googleapis.com)')
    console.error('  - Refresh token expired (re-run gmail:token)')
    console.error('  - Wrong credentials in .env')
    console.error('\nIf imports work on RPi, run this script there instead.')
    return
  }

  const total = await prisma.transaction.count({
    where: {
      emailId: { not: null },
      emailBody: null,
    },
  })

  console.log(`Found ${total} transactions to backfill`)
  if (total === 0) {
    console.log('Nothing to do.')
    return
  }

  let processed = 0
  let fetched = 0
  let notFound = 0
  let errors = 0
  let authFailed = false

  console.log(`Starting backfill (batch size=${BATCH_SIZE}, delay=${DELAY_MS}ms)...\n`)

  while (!authFailed) {
    const batch = await prisma.transaction.findMany({
      where: {
        emailId: { not: null },
        emailBody: null,
      },
      select: { id: true, emailId: true, merchant: true },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    })

    if (batch.length === 0) break

    for (const txn of batch) {
      processed++
      const label = `[${processed}/${total}]`
      process.stdout.write(`${label} Fetching ${txn.emailId} (${txn.merchant})...`)

      try {
        const msg = await fetchMessage(gmail, txn.emailId!)
        if (!msg) {
          notFound++
          await prisma.transaction.update({
            where: { id: txn.id },
            data: { emailSubject: '[NOT_FOUND]', emailBody: '[NOT_FOUND]' },
          })
          console.log(' NOT FOUND')
          continue
        }

        const headers = msg.payload?.headers ?? []
        const subject = headers.find((h: any) => h.name?.toLowerCase() === 'subject')?.value ?? ''
        const body = extractBody(msg.payload)

        await prisma.transaction.update({
          where: { id: txn.id },
          data: { emailSubject: subject, emailBody: body },
        })
        fetched++
        console.log(` OK (${body.length} chars)`)
      } catch (error: any) {
        errors++
        const errMsg = error?.message ?? String(error)
        console.log(` ERROR: ${errMsg}`)

        if (errMsg.includes('invalid_grant') || errMsg.includes('Token has been revoked')) {
          console.error('\nAuth error — stopping. Re-authenticate and retry.')
          authFailed = true
          break
        }
      }

      await sleep(DELAY_MS)
    }
  }

  console.log(`\nBackfill complete:`)
  console.log(`  Total processed: ${processed}`)
  console.log(`  Fetched & stored: ${fetched}`)
  console.log(`  Not found in Gmail: ${notFound}`)
  console.log(`  Errors: ${errors}`)
}

main()
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
