import { appConfig } from '@/config/app.config'
import { GmailPollService } from '@/modules/import-jobs/services/gmail-poll.service'

type RetryInternals = {
  withRetry: <T>(fn: () => Promise<T>, attempts?: number) => Promise<T>
}

describe('GmailPollService request timeout', () => {
  const originalTimeout = appConfig.importGmailTimeoutMs

  const makeService = () =>
    new GmailPollService({ pftSetting: { findUnique: jest.fn() } } as never) as unknown as RetryInternals

  beforeEach(() => {
    jest.useFakeTimers()
    appConfig.importGmailTimeoutMs = 30_000
  })

  afterEach(() => {
    jest.useRealTimers()
    appConfig.importGmailTimeoutMs = originalTimeout
  })

  it('fails a hanging Gmail call instead of waiting forever', async () => {
    const service = makeService()
    const pending = service.withRetry(() => new Promise(() => {}), 1)
    const assertion = expect(pending).rejects.toThrow('gmail_timeout: no response in 30000ms')

    await jest.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('retries after a timeout and returns the value once a call responds', async () => {
    const service = makeService()
    const fn = jest
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => Promise.resolve('ok'))

    const pending = service.withRetry(fn, 2)
    await jest.advanceTimersByTimeAsync(30_250)

    await expect(pending).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('does not time out a call that responds in time', async () => {
    const service = makeService()
    const pending = service.withRetry(() => Promise.resolve('fast'), 1)

    await expect(pending).resolves.toBe('fast')
  })
})
