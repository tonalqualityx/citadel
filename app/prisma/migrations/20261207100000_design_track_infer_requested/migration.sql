-- "Infer the rest" tapped while a build runs is held on the track and queued when that build ends.
ALTER TABLE "design_tracks" ADD COLUMN "infer_requested_at" TIMESTAMP(3);
