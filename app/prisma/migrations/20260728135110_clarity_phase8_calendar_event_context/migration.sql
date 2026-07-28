-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "attendees" JSONB,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "location" VARCHAR(500),
ADD COLUMN     "meet_url" VARCHAR(1000);
