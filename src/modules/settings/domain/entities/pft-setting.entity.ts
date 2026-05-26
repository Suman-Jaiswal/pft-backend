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
    public readonly defaultOtherIncome: number,
    public readonly defaultRent: number,
    public readonly defaultCook: number,
    public readonly defaultLoanRepayment: number,
    public readonly defaultSip: number,
    public readonly defaultInvestment: number,
    public readonly defaultLiquidSaved: number,
    public readonly defaultBills: number,
    public readonly defaultBasicExpenses: number,
    public readonly defaultOtherExpenses: number,
    public readonly prevLiquidBalance: number,
    public readonly prevInvestmentBalance: number,
    public readonly stashBalance: number,
    public readonly dashboardYearRange: string | null,
    public readonly dashboardBaselineVersion: number,
  ) {
    super(id, tenantId, createdAt, updatedAt, createdBy, updatedBy)
  }
}
