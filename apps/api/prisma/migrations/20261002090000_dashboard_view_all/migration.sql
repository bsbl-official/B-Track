-- Only Admin sees the team-wide dashboard by default; others see their own metrics
-- unless an admin grants "dashboard.view_all".
UPDATE "Role" SET "permissions" = array_append("permissions", 'dashboard.view_all')
WHERE "name" = 'Admin' AND NOT ('dashboard.view_all' = ANY ("permissions"));
