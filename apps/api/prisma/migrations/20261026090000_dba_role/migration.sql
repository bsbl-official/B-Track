-- DBA (database administrator): same access as a Developer, copied from the Developer role.
-- Not the default role for new sign-ups; Developer stays the default.
INSERT INTO "Role" ("id", "name", "description", "permissions", "isAssignable", "canTest", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'DBA', 'Database administrator; same access as a developer',
       "permissions", "isAssignable", "canTest", false, now(), now()
FROM "Role"
WHERE "name" = 'Developer'
ON CONFLICT ("name") DO NOTHING;
