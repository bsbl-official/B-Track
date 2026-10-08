-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "reminderKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_reminderKey_key" ON "Notification"("userId", "reminderKey");
