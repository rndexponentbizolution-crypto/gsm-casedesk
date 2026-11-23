-- AlterTable
ALTER TABLE "InboundWebhookEvent" ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "InboundWebhookEvent_status_nextAttemptAt_idx" ON "InboundWebhookEvent"("status", "nextAttemptAt");
