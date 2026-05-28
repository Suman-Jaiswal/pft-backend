import { BaseEntity } from '@/shared/domain/base.entity'

export class PftSettingEntity extends BaseEntity {
  constructor(
    id: string,
    tenantId: string,
    createdAt: Date,
    updatedAt: Date,
    createdBy: string,
    updatedBy: string,
    public readonly currency: string,
    public readonly defaultSalary: number,
    public readonly defaultOtherSources: number,
    public readonly defaultRent: number,
    public readonly defaultCook: number,
    public readonly defaultLoanRepayment: number,
    public readonly defaultSipMf: number,
    public readonly defaultStocks: number,
    public readonly defaultFd: number,
    public readonly defaultSavings: number,
    public readonly defaultBills: number,
    public readonly defaultBasicExpenses: number,
    public readonly defaultOtherExpenses: number,
    public readonly prevLiquidBalance: number,
    public readonly prevInvestmentBalance: number,
    public readonly stashBalance: number,
    public readonly dashboardYearRange: string | null,
    public readonly dashboardBaselineVersion: number,
    public readonly importGmailRefreshToken: string | null,
    public readonly importGmailEmail: string | null,
    public readonly importGmailScope: string | null,
    public readonly importGmailTokenUpdatedAt: Date | null,
  ) {
    super(id, tenantId, createdAt, updatedAt, createdBy, updatedBy)
  }
}
