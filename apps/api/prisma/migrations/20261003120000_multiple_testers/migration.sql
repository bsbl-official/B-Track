-- "Tested by" becomes a list: a task can have several testers (or none).
-- CreateTable
CREATE TABLE "_TaskTesters" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskTesters_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_TaskTesters_B_index" ON "_TaskTesters"("B");

-- AddForeignKey
ALTER TABLE "_TaskTesters" ADD CONSTRAINT "_TaskTesters_A_fkey" FOREIGN KEY ("A") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskTesters" ADD CONSTRAINT "_TaskTesters_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep every existing tester: copy the single "Tested by" into the new list before dropping it.
INSERT INTO "_TaskTesters" ("A", "B")
SELECT "id", "testedById" FROM "Task" WHERE "testedById" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Task" DROP CONSTRAINT "Task_testedById_fkey";

-- DropIndex
DROP INDEX "Task_testedById_idx";

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "testedById";
