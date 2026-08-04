// Shared shape of the export-stats table, used by the writer (/api/track) and
// the reader (/stats).
//
// Both need it, and they must not drift: the reader selects columns the writer
// defines, and the reader has to be able to bring the table into existence on
// its own. Leaving the schema in the writer meant the dashboard showed zeroes
// until someone happened to export something — the table it queried did not
// exist yet, the query threw, and an empty result reads exactly like a site
// with no history.
//
// Underscore-prefixed files in functions/ are not routed, so this is a module
// rather than an endpoint.

// style and template are part of the KEY, not just columns: a flat-lay and an
// on-model export that agree on day/event/quality are different facts and must
// not collapse into one row. SQLite cannot widen a primary key in place, hence
// a new table rather than ALTER TABLE on the original.
export const SCHEMA = `CREATE TABLE IF NOT EXISTS export_stats_v2 (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  garment TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT '',
  quality TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, style, garment, template, mode, quality)
)`;

// Carries the original table's rows across so the dashboard keeps its history.
// They predate the style/template split, so both are left blank and read as
// "not recorded" rather than being guessed at.
//
// INSERT OR IGNORE makes this safe to run any number of times. It cannot
// double-count either: every row it writes has a blank style, and every row
// written since carries 'flatlay' or 'onmodel', so the two can never share a
// primary key.
export const COPY_FORWARD = `INSERT OR IGNORE INTO export_stats_v2
  (day, event, style, garment, template, mode, quality, count, images)
  SELECT day, event, '', garment, '', mode, quality, count, images FROM export_stats`;

// Once per isolate. The copy is idempotent, so the worst case of a fresh
// isolate repeating it is one wasted scan of a small table.
let historyCopied = false;

// Creates the table if needed and carries the old one's rows across. Called by
// BOTH the beacon and the dashboard: whichever runs first brings the history
// with it, so the numbers never depend on which one the day happened to start
// with. Throws only if the table cannot be created — a missing v1 table is the
// normal case on a fresh database and is not an error.
export async function ensureExportStats(db) {
  await db.prepare(SCHEMA).run();
  if (historyCopied) return;
  // Set before the attempt, so a permanently absent v1 table costs one try per
  // isolate rather than one per request.
  historyCopied = true;
  try {
    await db.prepare(COPY_FORWARD).run();
  } catch {
    /* no v1 table — nothing to carry over */
  }
}
