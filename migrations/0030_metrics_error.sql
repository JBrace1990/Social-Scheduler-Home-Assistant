-- A failed metrics request waits for an explicit refresh rather than polling forever.
ALTER TABLE publications ADD COLUMN metrics_error TEXT;
