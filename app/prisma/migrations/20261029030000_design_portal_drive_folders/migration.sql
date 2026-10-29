-- Designer portal: Google Drive folder ids the design worker may read (design D11).

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "drive_folder_id" VARCHAR(128);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "drive_folder_id" VARCHAR(128);
