import 'reflect-metadata'
import * as bcrypt from 'bcrypt'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env: ${name}`)
  }
  return String(value).trim()
}

async function main(): Promise<void> {
  const tenantId = required('SEED_OWNER_TENANT_ID', 'tenant_default')
  const email = required('SEED_OWNER_EMAIL')
  const password = required('SEED_OWNER_PASSWORD')
  const role = (process.env.SEED_OWNER_ROLE ?? 'USER').trim().toUpperCase()
  if (!['ADMIN', 'USER'].includes(role)) {
    throw new Error('SEED_OWNER_ROLE must be ADMIN or USER')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { tenantId, role, passwordHash },
    })
    console.log(`Updated existing user: ${email} (${role})`)
  } else {
    await prisma.user.create({
      data: {
        tenantId,
        email,
        role,
        passwordHash,
      },
    })
    console.log(`Created owner user: ${email} (${role})`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
