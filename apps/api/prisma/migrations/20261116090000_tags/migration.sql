-- Tags on tasks. Some tags ask for details: the tables, form files or screens the issue touches.
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#5f6673',
    "detailLabel" TEXT,
    "detailHint" TEXT,
    "detailExtensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detailUppercase" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskTag" (
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "details" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("taskId","tagId")
);

CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
CREATE INDEX "TaskTag_tagId_idx" ON "TaskTag"("tagId");

ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The tags the team asked for, with the details each one needs.
INSERT INTO "Tag" ("id", "name", "color", "detailLabel", "detailHint", "detailExtensions", "detailUppercase") VALUES
    ('tag_database', 'Database/DB', '#2563eb', 'Tables', 'CR_INFO', ARRAY[]::TEXT[], true),
    ('tag_forms', 'Forms', '#7c3aed', 'Form files', 'PAYROLL_MENU_HO.fmb', ARRAY['fmb', 'fmx', 'rdf'], false),
    ('tag_apex', 'Apex', '#0f766e', 'Screens', 'Dashboard Screen 1', ARRAY[]::TEXT[], false),
    ('tag_java', 'Java', '#ca8a04', 'Screens', 'Dashboard Screen 1', ARRAY[]::TEXT[], false),
    ('tag_flutter', 'Flutter', '#0891b2', 'Screens', 'Dashboard Screen 1', ARRAY[]::TEXT[], false);

-- The new "Manage tags" permission goes to roles that already manage access (Admin).
UPDATE "Role"
SET "permissions" = array_append("permissions", 'tag.manage'), "updatedAt" = now()
WHERE 'access.manage' = ANY("permissions") AND NOT ('tag.manage' = ANY("permissions"));
