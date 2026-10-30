-- Backfill the catalog without changing existing reports or accounts.
INSERT INTO "ReportCategory" ("id", "name", "updatedAt")
SELECT gen_random_uuid()::text, "category", CURRENT_TIMESTAMP
FROM "IncidentReport" GROUP BY "category"
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "ReportCategory" ("id", "name", "updatedAt")
SELECT gen_random_uuid()::text, name, CURRENT_TIMESTAMP FROM (VALUES
  ('Pelecehan verbal atau catcalling'),
  ('Pelecehan atau kekerasan seksual'),
  ('Pencurian atau perampasan'),
  ('Begal atau perampokan'),
  ('Kekerasan fisik'),
  ('Tawuran atau kerumunan berbahaya'),
  ('Penipuan atau pemerasan'),
  ('Gangguan penerangan atau fasilitas yang berdampak pada keamanan'),
  ('Lainnya')
) AS defaults(name)
ON CONFLICT ("name") DO NOTHING;
