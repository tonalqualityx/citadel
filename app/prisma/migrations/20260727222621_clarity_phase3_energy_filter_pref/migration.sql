-- CreateEnum
CREATE TYPE "EnergyFilter" AS ENUM ('all', 'low_energy', 'deep_work');

-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN     "energy_filter" "EnergyFilter" NOT NULL DEFAULT 'all';
