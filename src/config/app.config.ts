export const appConfig = {
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  jwtExpiry: process.env.JWT_EXPIRY ?? '1h',
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? '',
  authSuccessRedirect: process.env.AUTH_SUCCESS_REDIRECT ?? 'http://localhost:5173/auth/callback',
  importGmailUser: process.env.IMPORT_GMAIL_USER ?? 'me',
  importGoogleRedirectUri:
    process.env.IMPORT_GOOGLE_REDIRECT_URI ?? process.env.GOOGLE_REDIRECT_URI ?? '',
  importGmailScope:
    process.env.IMPORT_GMAIL_SCOPE ?? 'https://www.googleapis.com/auth/gmail.readonly',
  importReauthSuccessRedirect: process.env.IMPORT_REAUTH_SUCCESS_REDIRECT ?? 'http://localhost:5173/settings',
  importReauthErrorRedirect: process.env.IMPORT_REAUTH_ERROR_REDIRECT ?? 'http://localhost:5173/settings',
  importGmailMaxResults: Number(process.env.IMPORT_GMAIL_MAX_RESULTS ?? '500'),
  importLabelSbi: process.env.IMPORT_LABEL_SBI ?? 'CC Transactions/SBI',
  importLabelHdfc: process.env.IMPORT_LABEL_HDFC ?? 'CC Transactions/HDFC',
  importLabelIcici: process.env.IMPORT_LABEL_ICICI ?? 'CC Transactions/ICICI',
  importDebugParserInput: process.env.IMPORT_DEBUG_PARSER_INPUT === 'true',
  importDebugBodyMaxLen: Number(process.env.IMPORT_DEBUG_BODY_MAX_LEN ?? '1200'),
}
