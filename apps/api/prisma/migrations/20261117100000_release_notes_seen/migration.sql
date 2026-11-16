-- The newest "What's new" release notes each person has closed, so the window pops up only once.
ALTER TABLE "User" ADD COLUMN "seenReleaseNotes" TEXT;
