-- Designer portal D11: automatic Drive sharing. Two session-less command verbs the box daemon executes;
-- payload {folder_id, email, role}. Session-less commands have no design session, so session_id becomes nullable.

-- AlterEnum
ALTER TYPE "DesignCommandVerb" ADD VALUE 'share_drive_folder';
ALTER TYPE "DesignCommandVerb" ADD VALUE 'unshare_drive_folder';

-- AlterTable
ALTER TABLE "design_commands" ALTER COLUMN "session_id" DROP NOT NULL;
