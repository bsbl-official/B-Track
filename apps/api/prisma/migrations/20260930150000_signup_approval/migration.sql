-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "link" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "grantedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "revokedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'APPROVED';


-- Data: split existing display names into first/last names.
UPDATE "User" SET
  "firstName" = split_part("name", ' ', 1),
  "lastName" = NULLIF(substr("name", length(split_part("name", ' ', 1)) + 2), '');
