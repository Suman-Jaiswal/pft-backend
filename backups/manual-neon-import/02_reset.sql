BEGIN;
SET CONSTRAINTS ALL DEFERRED;

TRUNCATE TABLE
  public."Transaction",
  public."Statement",
  public."MonthlyPlan",
  public."Bill",
  public."Loan",
  public."Card",
  public."PftSetting"
RESTART IDENTITY CASCADE;
-- Optional:
-- TRUNCATE TABLE public."User" RESTART IDENTITY;

COMMIT;
