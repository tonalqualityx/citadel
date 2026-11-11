-- Home screen Slice 7c: display-only effort, unknowns and drain guesses on the owner's home_item_state rows.
ALTER TABLE "home_item_state" ADD COLUMN "effort_minutes" INTEGER,
ADD COLUMN "effort_source" VARCHAR(10),
ADD COLUMN "effort_basis_n" INTEGER,
ADD COLUMN "unknowns" VARCHAR(10),
ADD COLUMN "drain" VARCHAR(10),
ADD COLUMN "guessed_at" TIMESTAMP(3);
