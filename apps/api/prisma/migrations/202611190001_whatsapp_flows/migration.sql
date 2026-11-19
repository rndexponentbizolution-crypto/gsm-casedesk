-- AlterTable
ALTER TABLE "FieldAgent" ADD COLUMN     "shopType" TEXT,
ADD COLUMN     "storeName" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "botState" TEXT NOT NULL DEFAULT 'IDLE',
ADD COLUMN     "botUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "details" JSONB,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "queryType" TEXT,
ADD COLUMN     "slaDueAt" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "interactive" JSONB,
ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "sender" TEXT,
ADD COLUMN     "templateId" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_queryType_status_idx" ON "Ticket"("queryType", "status");

