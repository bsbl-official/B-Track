-- KPI report: history rows can carry the ids behind their display values (user ids for "Assignee"),
-- because two people may share a name.
ALTER TABLE "TaskHistory" ADD COLUMN "oldRef" TEXT,
ADD COLUMN "newRef" TEXT;

-- The new "See KPI reports" permission goes to roles that already manage access (Admin).
UPDATE "Role"
SET "permissions" = array_append("permissions", 'kpi.view'), "updatedAt" = now()
WHERE 'access.manage' = ANY("permissions") AND NOT ('kpi.view' = ANY("permissions"));
