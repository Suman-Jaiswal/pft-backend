/*
  Warnings:

  - You are about to alter the column `amount` on the `Bill` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `creditLimit` on the `Card` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `principal` on the `Loan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `emi` on the `Loan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `rate` on the `Loan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `rent` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `cook` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `sip` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `bills` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `basicCcSpent` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `investment` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `liquidSaved` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `otherExpenses` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `salary` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `otherIncome` on the `MonthlyPlan` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultSalary` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultOtherIncome` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultRent` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultCook` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultLoanRepayment` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultSip` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultInvestment` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultLiquidSaved` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultBills` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultBasicExpenses` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `defaultOtherExpenses` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `prevLiquidBalance` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `prevInvestmentBalance` on the `PftSetting` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `minimumAmountDue` on the `Statement` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `totalAmountDue` on the `Statement` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.
  - You are about to alter the column `amount` on the `Transaction` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Decimal(65,30)`.

*/
-- DropForeignKey
ALTER TABLE "Statement" DROP CONSTRAINT "fk_statement_card";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "fk_transaction_card";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "fk_transaction_statement";

-- AlterTable
ALTER TABLE "Bill" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Card" ALTER COLUMN "creditLimit" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Loan" ALTER COLUMN "principal" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "emi" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "rate" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "startDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MonthlyPlan" ALTER COLUMN "rent" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "cook" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "sip" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "bills" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "basicCcSpent" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "investment" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "liquidSaved" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "otherExpenses" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "salary" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "otherIncome" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PftBaseline" ALTER COLUMN "lockedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PftSetting" ALTER COLUMN "defaultSalary" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultOtherIncome" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultRent" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultCook" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultLoanRepayment" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultSip" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultInvestment" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultLiquidSaved" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultBills" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultBasicExpenses" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "defaultOtherExpenses" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "prevLiquidBalance" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "prevInvestmentBalance" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Statement" ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "minimumAmountDue" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "totalAmountDue" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "txnDate" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "txnTimestamp" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "importedAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT,
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "Statement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
