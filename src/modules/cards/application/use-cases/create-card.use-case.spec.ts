import { CreateCardUseCase } from '@/modules/cards/application/use-cases/create-card.use-case'
import { ICardRepository } from '@/modules/cards/domain/repositories/card.repository'

describe('CreateCardUseCase', () => {
  it('creates card with repository', async () => {
    const repo: ICardRepository = {
      create: jest.fn(async (x) => x),
      findById: jest.fn(),
      findByCardKey: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
    }
    const uc = new CreateCardUseCase(repo)
    const out = await uc.execute({
      tenantId: 't1',
      actorId: 'u1',
      cardKey: 'hdfc_xx9335',
      issuer: 'HDFC',
    })
    expect(out.cardKey.value).toBe('HDFC_XX9335')
  })
})
