export abstract class BaseEntity {
  protected constructor(
    public readonly id: string,
    public readonly tenantId: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly createdBy: string,
    public readonly updatedBy: string,
  ) {}
}
