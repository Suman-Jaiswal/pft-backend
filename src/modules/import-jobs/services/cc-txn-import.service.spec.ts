import { CcTxnImportService } from '@/modules/import-jobs/services/cc-txn-import.service'

describe('CcTxnImportService run persistence', () => {
  it('stores tenantId on import run rows', async () => {
    const prisma = {
      importJobRun: {
        create: jest.fn().mockResolvedValue(null),
      },
    }
    const service = new CcTxnImportService(
      prisma as never,
      {} as never,
      { sendFailureEmail: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )

    const summary = await service.runImport({
      tenantId: 'tenant-42',
      dryRun: true,
      bankKeys: ['UNKNOWN_BANK'],
    })

    expect(summary.status).toBe('OK')
    expect(prisma.importJobRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobKey: 'cc_txn_import',
          tenantId: 'tenant-42',
        }),
      }),
    )
  })
})
