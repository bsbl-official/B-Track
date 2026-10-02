-- "Assigned dev" lists developers only; "Tested by" lists developers and Business Analysts.
UPDATE "Role" SET "isAssignable" = false WHERE "name" = 'Business Analyst';
UPDATE "Role" SET "canTest" = true WHERE "name" = 'Developer';
