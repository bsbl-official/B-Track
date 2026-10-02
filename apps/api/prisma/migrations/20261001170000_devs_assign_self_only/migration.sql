-- Developers only assign tasks to themselves or leave them unassigned (reverts 20261001150000).
-- Moving a task from one person to another is for roles with "Assign to anyone" (Admin, BA).
UPDATE "Role" SET "permissions" = array_remove("permissions", 'task.assign_any') WHERE "name" = 'Developer';
