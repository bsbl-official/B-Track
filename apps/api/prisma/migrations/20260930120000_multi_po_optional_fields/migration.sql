-- A task can now concern several POs. Existing tasks keep their single PO.
CREATE TABLE "_ClientToTask" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ClientToTask_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_ClientToTask_B_index" ON "_ClientToTask"("B");
ALTER TABLE "_ClientToTask" ADD CONSTRAINT "_ClientToTask_A_fkey" FOREIGN KEY ("A") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_ClientToTask" ADD CONSTRAINT "_ClientToTask_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "_ClientToTask" ("A", "B") SELECT "clientId", "id" FROM "Task";

ALTER TABLE "Task" DROP CONSTRAINT "Task_clientId_fkey";
DROP INDEX "Task_clientId_idx";
ALTER TABLE "Task" DROP COLUMN "clientId";

-- Type and priority may be blank, as in the team sheet.
ALTER TABLE "Task" DROP CONSTRAINT "Task_priorityId_fkey";
ALTER TABLE "Task" DROP CONSTRAINT "Task_typeId_fkey";
ALTER TABLE "Task" ALTER COLUMN "typeId" DROP NOT NULL,
ALTER COLUMN "priorityId" DROP NOT NULL;
ALTER TABLE "Task" ADD CONSTRAINT "Task_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TaskType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_priorityId_fkey" FOREIGN KEY ("priorityId") REFERENCES "Priority"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New tasks from people who can't set priority now stay blank for a BA/Admin to fill in.
ALTER TABLE "Priority" DROP COLUMN "isDefault";

-- Roles whose users appear in "Tested by" lists. Business Analysts test tasks.
ALTER TABLE "Role" ADD COLUMN "canTest" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Role" SET "canTest" = true WHERE "name" = 'Business Analyst';
