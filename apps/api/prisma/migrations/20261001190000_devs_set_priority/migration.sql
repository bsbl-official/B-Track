-- Developers can set priority on their own tasks (created by or assigned to them).
-- Per-task rules in taskAccess keep other people's tasks locked.
UPDATE "Role" SET "permissions" = array_append("permissions", 'task.set_priority')
WHERE "name" = 'Developer' AND NOT ('task.set_priority' = ANY ("permissions"));
