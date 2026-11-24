-- AlterTable
ALTER TABLE "User" ADD COLUMN     "grantedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "revokedPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
