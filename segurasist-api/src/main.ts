import 'reflect-metadata';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
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

  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
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
