import { ImportJobsService } from '@/modules/import-jobs/import-jobs.service'

describe('ImportJobsService tenant-scoped status', () => {
  const makeService = () => {
    const lockService = {
      acquire: jest.fn(),
      release: jest.fn(),
    }
    const ccTxnImportService = {
      runImport: jest.fn(),
      listFailures: jest.fn(),
      retryFailures: jest.fn(),
      rebaseWatermark: jest.fn(),
    }
    const ccStatementsImportService = {
      runImport: jest.fn(),
    }
    const prisma = {
      pftSetting: {
        findUnique: jest.fn(),
      },
      importJobRun: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    }

    return {
      service: new ImportJobsService(
        lockService as never,
        ccTxnImportService as never,
        ccStatementsImportService as never,
        prisma as never,
      ),
      prisma,
    }
  }

  it('queries txn status run by tenant', async () => {
    const { service, prisma } = makeService()
    prisma.pftSetting.findUnique.mockResolvedValue({
      importGmailRefreshToken: 'token',
      importGmailTokenUpdatedAt: new Date('2026-06-01T00:00:00.000Z'),
      importGmailEmail: 't1@example.com',
    })
    prisma.importJobRun.findFirst.mockResolvedValue({
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      status: 'FAILURE',
      payload: { errorCode: 'REAUTH_REQUIRED' },
    })

    const result = await service.getCcTxnImportStatus('tenant-1')

    expect(prisma.importJobRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobKey: 'cc_txn_import', tenantId: 'tenant-1' },
      }),
    )
    expect(result.reauthRequired).toBe(true)
    expect(result.reason).toBe('last_run_reauth_required')
  })

  it('queries statements status run by tenant', async () => {
    const { service, prisma } = makeService()
    prisma.pftSetting.findUnique.mockResolvedValue({
      importGmailRefreshToken: 'token',
      importGmailTokenUpdatedAt: new Date('2026-06-01T00:00:00.000Z'),
      importGmailEmail: 't1@example.com',
    })
    prisma.importJobRun.findFirst.mockResolvedValue({
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      status: 'OK',
      payload: {},
    })

    await service.getCcStatementsImportStatus('tenant-1')

    expect(prisma.importJobRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobKey: 'cc_statements_import', tenantId: 'tenant-1' },
      }),
    )
  })

  it('queries statements run detail by tenant and run id', async () => {
    const { service, prisma } = makeService()
    prisma.importJobRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'RUNNING',
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:01:00.000Z'),
      payload: { status: 'RUNNING' },
    })

    await service.getCcStatementsImportRun('tenant-2', 'run-1')

    expect(prisma.importJobRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', jobKey: 'cc_statements_import', tenantId: 'tenant-2' },
      }),
    )
  })
})
