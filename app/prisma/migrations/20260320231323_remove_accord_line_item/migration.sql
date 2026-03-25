/*
  Warnings:

  - You are about to drop the column `accord_line_item_id` on the `charter_wares` table. All the data in the column will be lost.
  - You are about to drop the `accord_line_items` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "accord_line_items" DROP CONSTRAINT "accord_line_items_accord_id_fkey";

-- DropForeignKey
ALTER TABLE "accord_line_items" DROP CONSTRAINT "accord_line_items_addendum_id_fkey";

-- DropForeignKey
ALTER TABLE "accord_line_items" DROP CONSTRAINT "accord_line_items_charter_id_fkey";

-- DropForeignKey
ALTER TABLE "accord_line_items" DROP CONSTRAINT "accord_line_items_commission_id_fkey";

-- DropForeignKey
ALTER TABLE "accord_line_items" DROP CONSTRAINT "accord_line_items_ware_id_fkey";

-- DropForeignKey
ALTER TABLE "charter_wares" DROP CONSTRAINT "charter_wares_accord_line_item_id_fkey";

-- AlterTable
ALTER TABLE "charter_wares" DROP COLUMN "accord_line_item_id";

-- DropTable
DROP TABLE "accord_line_items";
