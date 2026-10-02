-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "color" TEXT NOT NULL DEFAULT '#7c3aed';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "testedById" TEXT;

-- CreateIndex
CREATE INDEX "Task_testedById_idx" ON "Task"("testedById");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: align the workflow with the team's Daily Troubleshoot sheet:
-- New -> In Progress -> Testing -> Completed. Tasks in removed statuses move to In Progress.
UPDATE "Status" SET "name" = 'Testing', "color" = '#ca8a04', "sortOrder" = 3 WHERE "name" = 'In QA';
UPDATE "Status" SET "name" = 'Completed', "color" = '#16a34a', "sortOrder" = 4 WHERE "name" = 'Delivered';
UPDATE "Status" SET "color" = '#ea580c', "sortOrder" = 2 WHERE "name" = 'In Progress';
UPDATE "Task" SET "statusId" = (SELECT "id" FROM "Status" WHERE "name" = 'In Progress')
  WHERE "statusId" IN (SELECT "id" FROM "Status" WHERE "name" IN ('On Hold', 'Reopened'));
DELETE FROM "Status" WHERE "name" IN ('On Hold', 'Reopened');

DELETE FROM "StatusTransition";
INSERT INTO "StatusTransition" ("id", "fromStatusId", "toStatusId")
SELECT gen_random_uuid()::text, f."id", t."id"
FROM (VALUES
  ('New', 'In Progress'), ('New', 'Testing'), ('New', 'Completed'),
  ('In Progress', 'New'), ('In Progress', 'Testing'), ('In Progress', 'Completed'),
  ('Testing', 'In Progress'), ('Testing', 'Completed'),
  ('Completed', 'In Progress')
) AS p("fromName", "toName")
JOIN "Status" f ON f."name" = p."fromName"
JOIN "Status" t ON t."name" = p."toName";

-- Data: priorities are numbered 1 (most urgent) to 4, as in the sheet.
UPDATE "Priority" SET "name" = '1', "color" = '#dc2626', "rank" = 1 WHERE "name" = 'Critical';
UPDATE "Priority" SET "name" = '2', "color" = '#ea580c', "rank" = 2 WHERE "name" = 'High';
UPDATE "Priority" SET "name" = '3', "color" = '#ca8a04', "rank" = 3 WHERE "name" = 'Medium';
UPDATE "Priority" SET "name" = '4', "color" = '#64748b', "rank" = 4 WHERE "name" = 'Low';

-- Data: give existing POs distinct chip colours.
WITH numbered AS (
  SELECT "id", (row_number() OVER (ORDER BY "createdAt", "name") - 1) % 8 AS i FROM "Client"
)
UPDATE "Client" c
SET "color" = (ARRAY['#7c3aed', '#16a34a', '#2563eb', '#0f766e', '#dc2626', '#ca8a04', '#db2777', '#475569'])[n.i + 1]
FROM numbered n
WHERE c."id" = n."id";
