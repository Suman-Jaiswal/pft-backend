import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { google } from 'googleapis'

function required(name: string): string {
  const value = process.env[name]
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`)
  }
  return String(value).trim()
}

async function main(): Promise<void> {
  const clientId = required('GOOGLE_CLIENT_ID')
  const clientSecret = required('GOOGLE_CLIENT_SECRET')
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || 'http://localhost:4000/api/v1/auth/google/callback'

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  })

  console.log('\nOpen this URL in your browser and approve access:\n')
  console.log(authUrl)
  console.log('\nAfter approval, copy the "code" query param from redirected URL.\n')

  const rl = createInterface({ input, output })
  const code = (await rl.question('Paste code: ')).trim()
  rl.close()

  if (!code) {
    throw new Error('No code entered')
  }

  const tokenResponse = await oauth2Client.getToken(code)
  const refreshToken = tokenResponse.tokens.refresh_token

  if (!refreshToken) {
    throw new Error(
      'No refresh token returned. Re-run and ensure prompt=consent, access_type=offline, and first-time consent for this scope/client.',
    )
  }

  console.log('\nSet this in your .env:\n')
  console.log(`IMPORT_GMAIL_REFRESH_TOKEN=${refreshToken}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

