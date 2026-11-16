-- The "Weekly" type, for routine work done every week. Like "Daily": no probable date, gap days or deadlines.
INSERT INTO "TaskType" ("id", "name", "color", "sortOrder", "isRoutine")
VALUES (gen_random_uuid()::text, 'Weekly', '#0369a1', 4, true)
ON CONFLICT ("name") DO UPDATE SET "isRoutine" = true;
