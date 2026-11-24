import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AppController } from './app.controller';
import { KeycloakAdmin } from './keycloak-admin';
import { AppService } from './app.service';
import { AuditService } from './audit.service';
import { AuthGuard, TokenVerifier } from './auth';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { PrismaService } from './prisma.service';
import { ScannerService } from './scanner';
import { StorageService } from './storage';
import { MetaClient } from './whatsapp';

@Module({
  imports: [
    // Per client IP, per instance. The Meta webhook and /health skip it.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 300),
      },
    ]),
  ],
  controllers: [AppController, AdminController, MessagingController],
  providers: [
    AdminService,
    AppService,
    KeycloakAdmin,
    AuditService,
    MessagingService,
    PrismaService,
    ScannerService,
    StorageService,
    TokenVerifier,
    { provide: MetaClient, useFactory: () => new MetaClient() },
    // Throttle first so floods are rejected before token verification work.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
