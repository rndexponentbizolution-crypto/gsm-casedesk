// Must run before anything that reads process.env (e.g. the auth guard).
import { loadEnv } from './load-env';
loadEnv();

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateConfig } from './config';
import { allowedOrigins } from './cors';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  // Fail fast on unsafe or incomplete configuration, before taking traffic.
  const { mode, warnings } = validateConfig();
  warnings.forEach((warning) => log.warn(warning));

  // rawBody: the Meta webhook signature is computed over the exact bytes received.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const production = process.env.NODE_ENV === 'production';

  // Behind a load balancer the client IP (used for rate limiting) is in
  // X-Forwarded-For. Hosted platforms add one hop; set TRUST_PROXY to change it.
  const trustProxy = process.env.TRUST_PROXY ?? (production ? '1' : '');
  if (trustProxy)
    app.set(
      'trust proxy',
      /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
    );

  const origins = allowedOrigins();
  app.enableCors({ origin: origins });
  log.log(`CORS allowed origins: ${origins.join(', ')}`);
  log.log(`Messaging mode: ${mode}`);
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  if (!production || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('GSM CaseDesk API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT ?? process.env.APP_PORT ?? 3001),
    '0.0.0.0',
  );
}
void bootstrap();
