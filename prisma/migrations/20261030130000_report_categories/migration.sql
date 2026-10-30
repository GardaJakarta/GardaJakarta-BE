CREATE TABLE "ReportCategory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportCategory_name_key" ON "ReportCategory"("name");
