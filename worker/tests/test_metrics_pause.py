import sqlite3
import unittest
from datetime import datetime, timezone
from worker.metrics import _note_failure, _clear_failures, publications_needing_metrics


class MetricsPauseTests(unittest.TestCase):
    def test_failure_pauses_manual_refresh_retries_and_success_resumes(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.executescript('''
          CREATE TABLE channels(id INTEGER, platform TEXT);
          INSERT INTO channels VALUES(1,'facebook');
          CREATE TABLE publications(id INTEGER, channel_id INTEGER, status TEXT,
            is_dry_run INTEGER, remote_post_id TEXT, published_at TEXT, surface TEXT,
            remote_missing_at TEXT, remote_missing_reason TEXT, metrics_failure_streak INTEGER,
            metrics_refresh_requested_at TEXT, metrics_error TEXT);
          CREATE TABLE post_metrics(publication_id INTEGER, fetched_at TEXT);
          INSERT INTO publications VALUES(1,1,'posted',0,'remote','2026-10-20T00:00:00+00:00',
            'feed',NULL,NULL,0,NULL,NULL);
        ''')
        now = datetime(2026,10,20,12,tzinfo=timezone.utc)
        due = lambda: publications_needing_metrics(conn,now,30,6)
        self.assertEqual(len(due()),1)
        _note_failure(conn,due()[0],RuntimeError('Permission denied'),now.isoformat(),None)
        self.assertEqual(len(due()),0)
        conn.execute("UPDATE publications SET metrics_refresh_requested_at=?",(now.isoformat(),))
        self.assertEqual(len(due()),1)
        _clear_failures(conn,due()[0])
        conn.execute('UPDATE publications SET metrics_refresh_requested_at=NULL')
        self.assertIsNone(conn.execute('SELECT metrics_error FROM publications').fetchone()[0])
        self.assertEqual(len(due()),1)
        conn.close()
