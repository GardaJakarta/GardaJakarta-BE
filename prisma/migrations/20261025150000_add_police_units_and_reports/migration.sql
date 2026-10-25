-- CreateEnum
CREATE TYPE "ReportSeverity" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'VERIFIED', 'IN_PROGRESS', 'RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PoliceUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "photoUrl" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PoliceUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentReport" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "ReportSeverity" NOT NULL DEFAULT 'P2',
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "reporterId" TEXT NOT NULL,
    "policeUnitId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IncidentReport_pkey" PRIMARY KEY ("id")
);

-- Add optional unit scope for police staff accounts.
ALTER TABLE "User" ADD COLUMN "policeUnitId" TEXT;

-- CreateIndex
CREATE INDEX "PoliceUnit_district_idx" ON "PoliceUnit"("district");
CREATE INDEX "PoliceUnit_isPublished_idx" ON "PoliceUnit"("isPublished");
CREATE UNIQUE INDEX "IncidentReport_ticketNumber_key" ON "IncidentReport"("ticketNumber");
CREATE INDEX "IncidentReport_reporterId_createdAt_idx" ON "IncidentReport"("reporterId", "createdAt");
CREATE INDEX "IncidentReport_policeUnitId_status_idx" ON "IncidentReport"("policeUnitId", "status");
CREATE INDEX "IncidentReport_status_createdAt_idx" ON "IncidentReport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentReport" ADD CONSTRAINT "IncidentReport_policeUnitId_fkey" FOREIGN KEY ("policeUnitId") REFERENCES "PoliceUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_policeUnitId_fkey" FOREIGN KEY ("policeUnitId") REFERENCES "PoliceUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_policeUnitId_idx" ON "User"("policeUnitId");
