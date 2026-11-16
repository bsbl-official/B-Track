-- The "User" entry in Tested by (confirmation from the user's side) is a placeholder, not a person:
-- it can't sign in, and the testing sign-off never waits for it, whatever role it has.
ALTER TABLE "User" ADD COLUMN "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "isPlaceholder" = true WHERE "email" = 'user-confirmation@b-track.invalid';
