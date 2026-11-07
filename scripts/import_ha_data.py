#!/usr/bin/env python3
"""Import a one-time Social Scheduler data archive during app startup."""

from __future__ import annotations

import datetime as dt
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tarfile
import tempfile

DATA = Path("/data")
ARCHIVE = Path(sys.argv[1]) if len(sys.argv) > 1 else DATA / "socialscheduler-migration.tar"
DB_NAME = "data/socialscheduler.db"
SKIP_DIRS = {"bin", "logs", "run"}
SKIP_SUFFIXES = {"-wal", "-shm"}


def safe_name(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        raise ValueError(f"Unsafe archive path: {name!r}")
    return path


def is_runtime_file(path: PurePosixPath) -> bool:
    return any(part in SKIP_DIRS for part in path.parts) or path.name.endswith(tuple(SKIP_SUFFIXES))


def main() -> int:
    marker = DATA / ".migration-imported"
    if marker.exists():
        print("A prior migration was already imported; skipping.")
        return 0
    if not ARCHIVE.is_file():
        return 0

    with tarfile.open(ARCHIVE, mode="r:") as archive:
        members = archive.getmembers()
        names = {safe_name(member.name).as_posix(): member for member in members if member.isfile()}
        if DB_NAME not in names:
            raise ValueError(f"Archive does not contain {DB_NAME}.")
        if "source/.env" not in names:
            print("Archive has no source .env; Home Assistant app options will be used.")

        DATA.mkdir(parents=True, exist_ok=True)
        fd, check_name = tempfile.mkstemp(prefix=".migration-check-", suffix=".db", dir=DATA)
        os.close(fd)
        check_db = Path(check_name)
        try:
            with archive.extractfile(names[DB_NAME]) as source, check_db.open("wb") as output:
                if source is None:
                    raise ValueError("Database archive entry could not be read.")
                shutil.copyfileobj(source, output, length=1024 * 1024)
            with sqlite3.connect(check_db) as conn:
                result = conn.execute("PRAGMA quick_check").fetchone()
                if not result or result[0] != "ok":
                    raise ValueError(f"Source database integrity check failed: {result!r}")
                channels = conn.execute("SELECT count(*) FROM channels").fetchone()[0]
                posts = conn.execute("SELECT count(*) FROM posts").fetchone()[0]
                publications = conn.execute("SELECT count(*) FROM publications").fetchone()[0]
            if channels < 1:
                raise ValueError("Source database contains no channels; refusing an empty migration.")

            timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup_dir = DATA / "migration-backups" / timestamp
            backup_dir.mkdir(parents=True, exist_ok=True)
            current_db = DATA / "socialscheduler.db"
            if current_db.exists() and current_db.stat().st_size:
                shutil.copy2(current_db, backup_dir / "socialscheduler.db")

            for name, member in names.items():
                item = safe_name(name)
                if item.parts[0] == "source":
                    if item.as_posix() == "source/.env":
                        env = archive.extractfile(member)
                        if env is not None:
                            with env, (DATA / "source.env").open("wb") as output:
                                shutil.copyfileobj(env, output, length=1024 * 1024)
                    continue
                if item.parts[0] != "data" or is_runtime_file(item):
                    continue
                if item.as_posix() == DB_NAME:
                    continue
                relative = Path(*item.parts[1:])
                if not relative.parts:
                    continue
                destination = DATA / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                source = archive.extractfile(member)
                if source is None:
                    continue
                temporary = destination.with_name(destination.name + ".migration-tmp")
                with source, temporary.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                os.replace(temporary, destination)

            os.replace(check_db, current_db)
            marker.write_text(
                f"Imported {timestamp}: {channels} channel(s), {posts} post(s), "
                f"{publications} publication(s).\n",
                encoding="utf-8",
            )
        finally:
            check_db.unlink(missing_ok=True)

    ARCHIVE.unlink()
    print(f"Imported {channels} channel(s), {posts} post(s), {publications} publication(s).")
    print("Transient log, lock, runtime binary and SQLite WAL/SHM files were not imported.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
