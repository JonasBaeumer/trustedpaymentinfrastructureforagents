-- AlterTable
ALTER TABLE "User" ADD COLUMN     "apiKeyPrefix" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_apiKeyPrefix_key" ON "User"("apiKeyPrefix");
