SELECT 'monthlyPlans' AS metric, COUNT(*) AS row_count, NULL::numeric AS tx_sum FROM public."MonthlyPlan"
UNION ALL SELECT 'bills', COUNT(*), NULL::numeric FROM public."Bill"
UNION ALL SELECT 'loans', COUNT(*), NULL::numeric FROM public."Loan"
UNION ALL SELECT 'cards', COUNT(*), NULL::numeric FROM public."Card"
UNION ALL SELECT 'statements', COUNT(*), NULL::numeric FROM public."Statement"
UNION ALL SELECT 'transactions', COUNT(*), COALESCE(SUM(amount),0)::numeric FROM public."Transaction"
UNION ALL SELECT 'pftSetting', COUNT(*), NULL::numeric FROM public."PftSetting"
ORDER BY 1;
