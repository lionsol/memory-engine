#!/usr/bin/env python3
"""
Memory System v2.0 - Schema Migration
Creates a parallel memory_confidence table (chunks table is owned by OpenClaw).
"""

import sqlite3

DB_PATH = '/home/lionsol/.openclaw/memory/main.sqlite'

SCHEMA = """
CREATE TABLE IF NOT EXISTS memory_confidence (
    chunk_id TEXT PRIMARY KEY,
    initial_confidence REAL NOT NULL DEFAULT 0.5,
    confidence REAL NOT NULL DEFAULT 0.5,
    last_confidence_update INTEGER,
    base_tau REAL NOT NULL DEFAULT 7.0,
    hit_count INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    is_protected INTEGER NOT NULL DEFAULT 0,
    conflict_flag INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'raw_log',
    kg_data TEXT
);
"""

INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_mc_archived ON memory_confidence(is_archived)",
    "CREATE INDEX IF NOT EXISTS idx_mc_category ON memory_confidence(category)",
    "CREATE INDEX IF NOT EXISTS idx_mc_protected ON memory_confidence(is_protected)",
]


def run_migration():
    db = sqlite3.connect(DB_PATH)
    c = db.cursor()

    # Check if table exists
    c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_confidence'")
    exists = c.fetchone() is not None

    if not exists:
        c.execute(SCHEMA)
        print('✅ Created memory_confidence table')
        for idx in INDEXES:
            c.execute(idx)
        print('✅ Created indexes')

        # Initialize existing chunks with default values
        c.execute("SELECT id FROM chunks")
        chunk_ids = [row[0] for row in c.fetchall()]
        if chunk_ids:
            now = int(__import__('time').time())
            db.executemany(
                "INSERT OR IGNORE INTO memory_confidence "
                "(chunk_id, initial_confidence, confidence, last_confidence_update, "
                " base_tau, hit_count, is_archived, is_protected, conflict_flag, category) "
                "VALUES (?, 0.5, 0.5, ?, 7.0, 0, 0, 0, 0, 'raw_log')",
                [(cid, now) for cid in chunk_ids]
            )
            print(f'✅ Initialized {len(chunk_ids)} existing chunks')
    else:
        print('Table memory_confidence already exists')
        c.execute("SELECT COUNT(*) FROM memory_confidence")
        count = c.fetchone()[0]
        print(f'  Current rows: {count}')

    db.commit()

    # Verify
    c.execute("PRAGMA table_info(memory_confidence)")
    cols = c.fetchall()
    print('\nTable columns:')
    for col in cols:
        print(f'  {col[1]:25s} {col[2]:15s} nullable={col[3]} default={str(col[4]):10s}')

    c.execute("SELECT COUNT(*) FROM memory_confidence")
    total = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM chunks")
    chunks = c.fetchone()[0]
    print(f'\nmemory_confidence: {total} rows | chunks: {chunks} rows')

    db.close()


if __name__ == '__main__':
    run_migration()
