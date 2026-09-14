import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'

export type StatementSyncFlow = 'direct' | 'cloudPdf'

export interface StatementSourceConfig {
  cardKey: string
  labelName: string
  flow: StatementSyncFlow
  pdfPassword?: string
}

/**
 * Parses the tenant-owned `PftSetting.statementSourceConfig` JSON blob into
 * typed statement sources. This is the single source of truth for "which
 * cards does statement sync/backfill run for" — configured entirely from the
 * Settings page, no code changes or redeploy needed to add a card.
 */
function parseStatementSourceConfig(raw: unknown): StatementSourceConfig[] {
  if (!Array.isArray(raw)) return []
  const out: StatementSourceConfig[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const cardKey = typeof row.cardKey === 'string' ? row.cardKey.trim().toUpperCase() : ''
    const labelName = typeof row.labelName === 'string' ? row.labelName.trim() : ''
    const flow = row.flow === 'cloudPdf' ? 'cloudPdf' : row.flow === 'direct' ? 'direct' : null
    if (!cardKey || !labelName || !flow) continue
    const pdfPassword = typeof row.pdfPassword === 'string' && row.pdfPassword.trim() ? row.pdfPassword.trim() : undefined
    out.push({ cardKey, labelName, flow, pdfPassword })
  }
  return out
}

@Injectable()
export class StatementSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async loadForTenant(tenantId: string, cardKeys?: string[]): Promise<StatementSourceConfig[]> {
    const setting = await this.prisma.pftSetting.findUnique({
      where: { tenantId },
      select: { statementSourceConfig: true },
    })
    const configured = parseStatementSourceConfig(setting?.statementSourceConfig)
    if (!cardKeys?.length) return configured
    const wanted = new Set(cardKeys.map((k) => k.trim().toUpperCase()).filter(Boolean))
    return configured.filter((src) => wanted.has(src.cardKey))
  }
}
