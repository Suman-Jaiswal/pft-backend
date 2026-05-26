import { AppModule } from "@/app.module";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { setDefaultResultOrder } from "node:dns";
import "reflect-metadata";

function normalizeOrigin(value: string): string {
  const cleaned = value.trim().replace(/^"+|"+$/g, "").replace(/\/+$/, "");
  try {
    return new URL(cleaned).origin;
  } catch {
    return cleaned;
  }
}

async function bootstrap(): Promise<void> {
  // Prefer IPv4 first for outbound OAuth calls; avoids intermittent fetch failures
  // on environments where IPv6 resolution succeeds but routing fails.
  setDefaultResultOrder("ipv4first");
  const app = await NestFactory.create(AppModule);
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.originalUrl.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
    }
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
    });
    next();
  });
  const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN
        .split(",")
        .map((origin) => normalizeOrigin(origin))
        .filter(Boolean)
    : ["http://localhost:5173"];
  console.log("[CORS] Allowed origins:", allowedOrigins.join(", "));

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests without Origin header (curl, server-to-server, health checks).
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      const isAllowed = allowedOrigins.includes(normalizedOrigin);
      if (!isAllowed) {
        console.warn(`[CORS] Blocked origin: ${origin} (normalized: ${normalizedOrigin})`);
      }
      return callback(isAllowed ? null : new Error("Not allowed by CORS"), isAllowed);
    },
    credentials: true,
  });
  app.setGlobalPrefix("api");
  const expressApp = app.getHttpAdapter().getInstance() as {
    get: (
      path: string,
      handler: (
        req: { originalUrl: string },
        res: { redirect: (status: number, url: string) => void },
      ) => void,
    ) => void;
  };
  expressApp.get("/v1/auth/google/callback", (req, res) => {
    const qs = req.originalUrl.includes("?")
      ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
      : "";
    res.redirect(307, `/api/v1/auth/google/callback${qs}`);
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const docsVersion = process.env.APP_VERSION || process.env.RELEASE_ID || "1.0.0";
  const config = new DocumentBuilder()
    .setTitle("PFT Backend Template")
    .setDescription("Cards, statements, transactions")
    .setVersion(docsVersion)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3000);
}

void bootstrap();
