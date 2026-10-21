-- Portal A5: staff flag a comment as the question shown to the client. Additive, default false.
ALTER TABLE "comments" ADD COLUMN "client_question" BOOLEAN NOT NULL DEFAULT false;
