-- AlterTable
ALTER TABLE "home_keeper_settings" ADD COLUMN     "book_blocks" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "home_owed_thread" ADD COLUMN     "book_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "book_error" VARCHAR(300),
ADD COLUMN     "book_requested_at" TIMESTAMP(3),
ADD COLUMN     "book_undo_requested_at" TIMESTAMP(3),
ADD COLUMN     "booked_at" TIMESTAMP(3),
ADD COLUMN     "booked_end" TIMESTAMP(3),
ADD COLUMN     "booked_event_id" VARCHAR(255),
ADD COLUMN     "booked_start" TIMESTAMP(3);

