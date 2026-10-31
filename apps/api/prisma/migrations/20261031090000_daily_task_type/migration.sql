-- Routine task types: daily work with no probable date, gap days or deadlines.
ALTER TABLE "TaskType" ADD COLUMN "isRoutine" BOOLEAN NOT NULL DEFAULT false;

-- The "Daily" type, listed after Feature and Bug.
INSERT INTO "TaskType" ("id", "name", "color", "sortOrder", "isRoutine")
VALUES (gen_random_uuid()::text, 'Daily', '#0f766e', 3, true)
ON CONFLICT ("name") DO UPDATE SET "isRoutine" = true;
