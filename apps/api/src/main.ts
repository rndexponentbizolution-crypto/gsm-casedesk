import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { allowedOrigins } from './cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = allowedOrigins();
  app.enableCors({ origin: origins });
  console.log(`CORS allowed origins: ${origins.join(', ')}`);
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const config = new DocumentBuilder()
    .setTitle('GSM CaseDesk API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  await app.listen(
    Number(process.env.PORT ?? process.env.APP_PORT ?? 3001),
    '0.0.0.0',
  );
}
bootstrap();
