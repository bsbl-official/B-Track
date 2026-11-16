-- Testing sign-off: a task stays in Testing until every tester (the "User" placeholder doesn't count)
-- has given a verdict for the current round: passed, or sent back with a reason.
CREATE TABLE "TestVerdict" (
    "taskId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestVerdict_pkey" PRIMARY KEY ("taskId","testerId")
);

ALTER TABLE "TestVerdict" ADD CONSTRAINT "TestVerdict_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestVerdict" ADD CONSTRAINT "TestVerdict_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The new "Override testing" permission goes to roles that already manage access (Admin).
UPDATE "Role"
SET "permissions" = array_append("permissions", 'task.override_testing'), "updatedAt" = now()
WHERE 'access.manage' = ANY("permissions") AND NOT ('task.override_testing' = ANY("permissions"));
