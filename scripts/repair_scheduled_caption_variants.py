"""Repair stale imported variants using the edited main captions; never touches posted-only posts."""
import sqlite3
from pathlib import Path
from datetime import datetime, timezone


def main():
    root = Path(__file__).resolve().parents[1]
    conn = sqlite3.connect(root / 'data/socialscheduler.db')
    conn.row_factory = sqlite3.Row
    backup = root / 'data/backups' / ('before-caption-variant-repair-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.db')
    backup.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(backup) as dest:
        conn.backup(dest)
    with conn:
        rows = conn.execute("SELECT DISTINCT p.id,p.caption FROM posts p JOIN publications pub ON pub.post_id=p.id WHERE pub.status='scheduled'").fetchall()
        assert rows and all(r['caption'] and r['caption'].strip() for r in rows)
        assert len({r['caption'].strip().casefold() for r in rows}) == len(rows)
        changed = 0
        for row in rows:
            changed += conn.execute("UPDATE caption_variants SET body=? WHERE post_id=? AND (platform='facebook' OR platform IS NULL) AND body<>?", (row['caption'], row['id'], row['caption'])).rowcount
        from worker.publisher import _select_caption
        selected = [_select_caption(conn, r['id'], 'facebook', 0) for r in rows]
        assert len(set(selected)) == len(rows)
        assert all('would you wear' not in text.casefold() for text in selected)
        assert all(_select_caption(conn, r['id'], 'facebook', n) == r['caption'] for r in rows for n in range(3))
    print(f'Updated {changed} variants across {len(rows)} scheduled posts; verified worker caption selection and uniqueness.')
    print(f'Backup: {backup}')


if __name__ == '__main__':
    main()
