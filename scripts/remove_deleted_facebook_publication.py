"""Remove the specifically identified deleted Facebook send, with a SQLite backup."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
conn = sqlite3.connect(root / 'data/socialscheduler.db')
conn.execute('PRAGMA foreign_keys=ON')
remote_id = '1461250987067210_122113624785500216'
backup = root / 'data/backups' / ('before-remove-publication-122-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.db')
backup.parent.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(backup) as dest:
    conn.backup(dest)
with conn:
    row = conn.execute('SELECT channel_id FROM publications WHERE id=122 AND remote_post_id=?', (remote_id,)).fetchone()
    if not row:
        raise SystemExit('Expected publication not found; no deletion performed.')
    # Stop the independent imported-media metrics path from retrying the same ID.
    conn.execute('UPDATE remote_media SET is_deleted=1 WHERE channel_id=? AND remote_post_id=?', (row[0], remote_id))
    conn.execute('DELETE FROM publications WHERE id=122 AND remote_post_id=?', (remote_id,))
assert conn.execute('SELECT COUNT(*) FROM publications WHERE id=122').fetchone()[0] == 0
assert conn.execute('SELECT COUNT(*) FROM remote_media WHERE channel_id=? AND remote_post_id=? AND is_deleted=0', (row[0], remote_id)).fetchone()[0] == 0
print('Removed publication 122 and disabled imported-media refresh for the same remote ID.')
print('Backup:', backup)
