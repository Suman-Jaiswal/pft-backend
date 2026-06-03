import { ImportErrorCode } from '@/modules/import-jobs/types/import-contracts'

const REAUTH_REQUIRED_CODE: ImportErrorCode = 'REAUTH_REQUIRED'

export function resolveImportErrorCode(error: unknown): ImportErrorCode | undefined {
  if (isReauthRequiredError(error)) return REAUTH_REQUIRED_CODE
  return undefined
}

function isReauthRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const maybeError = error as {
    message?: unknown
    response?: { data?: { error?: unknown; error_description?: unknown } | unknown }
  }

  const message = String(maybeError.message ?? '').toLowerCase()
  if (message.includes('invalid_grant')) return true
  if (message.includes('reauth_required')) return true

  const responseData = maybeError.response?.data
  if (!responseData) return false

  if (typeof responseData === 'string') {
    return responseData.toLowerCase().includes('invalid_grant')
  }

  if (typeof responseData === 'object') {
    const errorCode = String((responseData as { error?: unknown }).error ?? '').toLowerCase()
    const errorDescription = String(
      (responseData as { error_description?: unknown }).error_description ?? '',
    ).toLowerCase()
    return errorCode.includes('invalid_grant') || errorDescription.includes('invalid_grant')
  }

  return false
}
