import 'reflect-metadata'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`
  console.log('Database connection OK')
}

main()
  .catch((error) => {
    console.error('Database connection FAILED')
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
