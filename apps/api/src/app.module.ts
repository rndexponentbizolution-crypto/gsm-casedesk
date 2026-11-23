import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthGuard, TokenVerifier } from './auth';
import { PrismaService } from './prisma.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService,
    TokenVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
