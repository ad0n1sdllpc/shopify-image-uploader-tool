import "server-only";
import fs from "node:fs";
import initSqlJs, { Database } from "sql.js";
import path from "node:path";
import type { UploadJob } from "@/types";

let dbPromise: Promise<{ db: Database; dbPath: string }> | null = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const dbPath = path.resolve(process.cwd(), process.env.IMAGE_UPLOAD_DB_PATH || "./image-uploader.db");
      const SQL = await initSqlJs();
      const db = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
      db.exec(`
      CREATE TABLE IF NOT EXISTS upload_jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        mode TEXT NOT NULL,
        dry_run INTEGER NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `);
      persist(db, dbPath);
      return { db, dbPath };
    })();
  }

  return dbPromise;
}

function persist(db: Database, dbPath: string) {
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

export async function saveUploadJob(job: UploadJob) {
  const { db, dbPath } = await getDb();
  db.run(
    `INSERT INTO upload_jobs (id, created_at, mode, dry_run, status, payload)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload = excluded.payload`,
    [job.id, job.createdAt, job.mode, job.dryRun ? 1 : 0, job.status, JSON.stringify(job)]
  );
  persist(db, dbPath);
}

export async function getUploadJob(id: string): Promise<UploadJob | null> {
  const { db } = await getDb();
  const statement = db.prepare("SELECT payload FROM upload_jobs WHERE id = ?");
  statement.bind([id]);
  const row = statement.step() ? (statement.getAsObject() as { payload: string }) : null;
  statement.free();
  return row ? (JSON.parse(row.payload) as UploadJob) : null;
}

export async function listUploadJobs(limit = 50): Promise<UploadJob[]> {
  const { db } = await getDb();
  const statement = db.prepare("SELECT payload FROM upload_jobs ORDER BY created_at DESC LIMIT ?");
  statement.bind([limit]);
  const rows: UploadJob[] = [];
  while (statement.step()) {
    const row = statement.getAsObject() as { payload: string };
    rows.push(JSON.parse(row.payload) as UploadJob);
  }
  statement.free();
  return rows;
}
