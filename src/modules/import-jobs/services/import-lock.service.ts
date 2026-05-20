import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

@Injectable()
export class ImportLockService {
  constructor(private readonly prisma: PrismaService) {}

  async acquire(jobKey: string, owner: string, ttlMs: number): Promise<boolean> {
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlMs)

    await this.prisma.importJobLock.deleteMany({
      where: {
        jobKey,
        expiresAt: { lt: now },
      },
    })

    try {
      await this.prisma.importJobLock.create({
        data: { jobKey, owner, expiresAt },
      })
      return true
    } catch {
      return false
    }
  }

  async release(jobKey: string, owner: string): Promise<void> {
    await this.prisma.importJobLock.deleteMany({
      where: { jobKey, owner },
    })
  }
}
