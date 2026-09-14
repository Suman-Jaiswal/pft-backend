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
        {} as never,
        prisma as never,
      ),
      prisma,
      lockService,
      ccTxnImportService,
    }
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve))

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
        where: { jobKey: 'cc_txn_import', tenantId: 'tenant-1', status: { not: 'RUNNING' } },
      }),
    )
    expect(result.reauthRequired).toBe(true)
    expect(result.reason).toBe('last_run_reauth_required')
  })

  it('starts txn import in background and returns a RUNNING run id immediately', async () => {
    const { service, prisma, lockService, ccTxnImportService } = makeService()
    prisma.importJobRun.create.mockResolvedValue({ id: 'run-9' })
    lockService.acquire.mockResolvedValue(true)
    let resolveImport: (value: unknown) => void = () => {}
    ccTxnImportService.runImport.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve
      }),
    )

    const result = await service.startCcTxnImport({ tenantId: 'tenant-1', owner: 'api:1' })

    expect(result).toEqual({
      jobRunId: 'run-9',
      status: 'RUNNING',
      startedAt: expect.any(String),
    })
    await flush()
    expect(ccTxnImportService.runImport).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', runId: 'run-9' }),
    )
    expect(lockService.release).not.toHaveBeenCalled()

    resolveImport({})
    await flush()
    expect(lockService.release).toHaveBeenCalledWith('cc_txn_import')
  })

  it('marks the pre-created txn run SKIPPED_LOCKED when the lock is held', async () => {
    const { service, prisma, lockService, ccTxnImportService } = makeService()
    prisma.importJobRun.create.mockResolvedValue({ id: 'run-10' })
    lockService.acquire.mockResolvedValue(false)

    await service.startCcTxnImport({ tenantId: 'tenant-1', owner: 'api:2' })
    await flush()

    expect(ccTxnImportService.runImport).not.toHaveBeenCalled()
    expect(prisma.importJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-10' },
        data: expect.objectContaining({ status: 'SKIPPED_LOCKED' }),
      }),
    )
  })

  it('marks the txn run FAILURE and releases the lock when the import throws', async () => {
    const { service, prisma, lockService, ccTxnImportService } = makeService()
    prisma.importJobRun.create.mockResolvedValue({ id: 'run-11' })
    lockService.acquire.mockResolvedValue(true)
    ccTxnImportService.runImport.mockRejectedValue(new Error('gmail exploded'))

    await service.startCcTxnImport({ tenantId: 'tenant-1', owner: 'api:3' })
    await flush()

    expect(prisma.importJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-11' },
        data: expect.objectContaining({ status: 'FAILURE' }),
      }),
    )
    expect(lockService.release).toHaveBeenCalledWith('cc_txn_import')
  })

  it('queries txn run detail by tenant and run id', async () => {
    const { service, prisma } = makeService()
    prisma.importJobRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'RUNNING',
      createdAt: new Date('2026-06-02T00:00:00.000Z'),
      updatedAt: new Date('2026-06-02T00:01:00.000Z'),
      payload: { status: 'RUNNING' },
    })

    const snapshot = await service.getCcTxnImportRun('tenant-2', 'run-1')

    expect(prisma.importJobRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', jobKey: 'cc_txn_import', tenantId: 'tenant-2' },
      }),
    )
    expect(snapshot?.completedAt).toBeNull()
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
