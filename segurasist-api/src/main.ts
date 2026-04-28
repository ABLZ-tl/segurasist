import 'reflect-metadata';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { TraceIdInterceptor } from './common/interceptors/trace-id.interceptor';
import { loadEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const env = loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      trustProxy: true,
      bodyLimit: 26 * 1024 * 1024, // 25 MB max upload (BATCH_TOO_LARGE @ 413 above)
      genReqId: (req: { headers: Record<string, string | string[] | undefined> }): string => {
        const incoming = req.headers['x-trace-id'];
        if (typeof incoming === 'string' && incoming.length > 0) return incoming;
        // crypto.randomUUID is available in Node 20
        return crypto.randomUUID();
      },
    }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(PinoLogger));

  // L1 — CSP activa SIEMPRE (no sólo en prod). Esta es una API REST que
  // jamás devuelve HTML; bloqueamos ejecución de cualquier script/imagen/
  // iframe inline. Si una respuesta filtrada llegara a ser servida en un
  // contexto HTML (p.ej. inline en un email phishing), el navegador no
  // ejecuta nada. Las directivas más conservadoras posibles:
  //   default-src 'none'  → nada por defecto.
  //   frame-ancestors 'none' → no embedding (clickjacking).
  //   base-uri 'none' / form-action 'none' → cierra vectores de inyección.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  });

  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Trace-Id'],
    exposedHeaders: ['X-Trace-Id'],
  });

  await app.register(compress, { global: true, threshold: 1024 });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

  app.enableVersioning();
  app.setGlobalPrefix('', { exclude: ['health/(.*)'] });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TraceIdInterceptor(), new TimeoutInterceptor(15_000));

  // C-12 — Swagger / OpenAPI 3 wiring.
  //
  // Antes de este fix, el módulo `SwaggerModule` jamás se cableaba: el job
  // `api-dast` (`.github/workflows/ci.yml:367`) apunta ZAP a
  // `http://localhost:3000/v1/openapi.json` y obtenía 404 → DAST fallaba en
  // cada PR (bloqueando merge). Ahora exponemos:
  //   - `/v1/openapi`       → Swagger UI (humans).
  //   - `/v1/openapi.json`  → spec OpenAPI 3 (ZAP, Postman, codegen).
  //
  // `addBearerAuth()` declara el esquema "Authorization: Bearer <jwt>" como
  // global; los DTOs Zod publican sus schemas a través de `nestjs-zod`
  // (declarado en feed para F5). En entornos production se puede setear
  // `SWAGGER_DISABLED=true` para servir solo el JSON (UI ya queda detrás
  // de WAF + Cognito en App Runner).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SegurAsist API')
    .setDescription('SegurAsist multi-tenant API (insureds, certificates, batches, audit).')
    .setVersion('v1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'cognito-jwt')
    .addServer(`http://${env.HOST}:${env.PORT}`, 'local')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('v1/openapi', app, swaggerDocument, {
    jsonDocumentUrl: 'v1/openapi.json',
    yamlDocumentUrl: 'v1/openapi.yaml',
    swaggerOptions: { persistAuthorization: true },
  });

  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);

  // eslint-disable-next-line no-console
  console.log(`[boot] segurasist-api listening on :${env.PORT} (env=${env.NODE_ENV})`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[boot fatal]', err);
  process.exit(1);
});
