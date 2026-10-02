-- Developers can assign their own tasks (created by or assigned to them) to any developer or BA.
-- Other people's tasks stay locked by the per-task rules in taskAccess.
UPDATE "Role" SET "permissions" = array_append("permissions", 'task.assign_any')
WHERE "name" = 'Developer' AND NOT ('task.assign_any' = ANY ("permissions"));
