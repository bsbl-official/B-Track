-- Business Analysts can be assigned tasks again (reverts 20261001090000 for BA).
UPDATE "Role" SET "isAssignable" = true WHERE "name" = 'Business Analyst';

-- Developers can see every task; the sheet just opens filtered to their own name.
UPDATE "Role" SET "permissions" = array_append("permissions", 'task.view_all')
WHERE "name" = 'Developer' AND NOT ('task.view_all' = ANY ("permissions"));
