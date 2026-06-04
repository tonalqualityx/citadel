-- Add the "publishing" run stage between in_production and done.
ALTER TYPE "TroubadorRunStage" ADD VALUE IF NOT EXISTS 'publishing' BEFORE 'done';
