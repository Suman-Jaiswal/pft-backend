import { PftSettingEntity } from '@/modules/settings/domain/entities/pft-setting.entity'
import { IPftSettingRepository } from '@/modules/settings/domain/repositories/pft-setting.repository'
import { SettingsService } from '@/modules/settings/settings.service'
import { FdLedgerService } from '@/modules/fd-ledger/fd-ledger.service'
import { InvestmentsService } from '@/modules/investments/investments.service'

function currentSetting(): PftSettingEntity {
  const now = new Date('2026-01-01T00:00:00.000Z')
  return new PftSettingEntity(
    'setting-1',
    'tenant-1',
    now,
    now,
    'user-1',
    'user-1',
    'INR',
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    { amount: 0, quantity: 0 },
    [],
    0,
    0,
    0,
    0,
    0,
    0,
    10_000,
    0,
    null,
    1,
    null,
    null,
    null,
    null,
    null,
  )
}

describe('SettingsService investment opening balance updates', () => {
  const transaction = {}
  const transactionalUpsert = jest.fn()
  const repository = {
    findByTenantId: jest.fn(),
    upsert: jest.fn(),
    runInTransaction: jest.fn(),
  }
  const fdLedger = {
    normalizePacket: jest.fn((value) => value),
  }
  const investments = {
    lockAndValidateOpeningBalance: jest.fn(),
  }
  const service = new SettingsService(
    repository as unknown as IPftSettingRepository,
    {} as never,
    fdLedger as unknown as FdLedgerService,
    investments as unknown as InvestmentsService,
  )

  beforeEach(() => {
    jest.clearAllMocks()
    repository.findByTenantId.mockResolvedValue(currentSetting())
    repository.upsert.mockImplementation(async (setting) => setting)
    transactionalUpsert.mockImplementation(async (setting) => setting)
    repository.runInTransaction.mockImplementation(async (callback) =>
      callback({ transaction, upsert: transactionalUpsert }),
    )
    investments.lockAndValidateOpeningBalance.mockResolvedValue(undefined)
  })

  it('validates and writes an opening balance under one repository transaction', async () => {
    await service.updatePftSettings('tenant-1', 'user-2', {
      prevInvestmentBalance: 4_000,
    })

    expect(repository.runInTransaction).toHaveBeenCalledTimes(1)
    expect(investments.lockAndValidateOpeningBalance).toHaveBeenCalledWith(
      'tenant-1',
      4_000,
      transaction,
    )
    expect(
      investments.lockAndValidateOpeningBalance.mock.invocationCallOrder[0],
    ).toBeLessThan(transactionalUpsert.mock.invocationCallOrder[0])
    expect(transactionalUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ prevInvestmentBalance: 4_000 }),
    )
    expect(repository.upsert).not.toHaveBeenCalled()
  })

  it('does not add an investment transaction for unrelated settings updates', async () => {
    await service.updatePftSettings('tenant-1', 'user-2', {
      defaultSalary: 125_000,
    })

    expect(repository.runInTransaction).not.toHaveBeenCalled()
    expect(investments.lockAndValidateOpeningBalance).not.toHaveBeenCalled()
    expect(repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ defaultSalary: 125_000 }),
    )
  })
})
