import 'reflect-metadata'
import 'dotenv/config'
import { setDefaultResultOrder } from 'node:dns'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from 'helmet'
import { AppModule } from '@/app.module'

async function bootstrap(): Promise<void> {
  // Prefer IPv4 first for outbound OAuth calls; avoids intermittent fetch failures
  // on environments where IPv6 resolution succeeds but routing fails.
  setDefaultResultOrder('ipv4first')
  const app = await NestFactory.create(AppModule)
  app.use(helmet())
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:5173']
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  })
  app.setGlobalPrefix('api')
  const expressApp = app.getHttpAdapter().getInstance() as {
    get: (path: string, handler: (req: { originalUrl: string }, res: { redirect: (status: number, url: string) => void }) => void) => void
  }
  expressApp.get('/v1/auth/google/callback', (req, res) => {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''
    res.redirect(307, `/api/v1/auth/google/callback${qs}`)
  })
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))

  const config = new DocumentBuilder()
    .setTitle('PFT Backend Template')
    .setDescription('Cards, statements, transactions')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build()
  const document = SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api/docs', app, document)

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000)
}

void bootstrap()
