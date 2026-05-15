#!/usr/bin/env python3
"""
Memory System v1.0 - Schema Migration
Adds confidence/time-decay columns to the chunks table.
"""

import sqlite3
import sys

DB_PATH = '/home/lionsol/.openclaw/memory/main.sqlite'

COLUMNS = [
    ('initial_confidence', 'REAL', 0.5),
    ('confidence', 'REAL', 0.5),
    ('last_confidence_update', 'INTEGER', None),
    ('base_tau', 'REAL', 7.0),
    ('hit_count', 'INTEGER', 0),
    ('is_archived', 'INTEGER', 0),
    ('is_protected', 'INTEGER', 0),
    ('conflict_flag', 'INTEGER', 0),
    ('category', 'TEXT', 'raw_log'),
    ('kg_data', 'TEXT', None),
]


def run_migration(dry_run=False):
    db = sqlite3.connect(DB_PATH if not dry_run else ':memory:')
    c = db.cursor()

    # Get existing columns
    c.execute('PRAGMA table_info(chunks)')
    existing = {row[1] for row in c.fetchall()}
    print(f'Existing columns: {", ".join(sorted(existing))}')

    added = []
    for col_name, col_type, default in COLUMNS:
        if col_name in existing:
            print(f'  ✓ {col_name} already exists')
            continue
        sql = f'ALTER TABLE chunks ADD COLUMN {col_name} {col_type}'
        if default is not None:
            if isinstance(default, str):
                sql += f" DEFAULT '{default}'"
            else:
                sql += f' DEFAULT {default}'
        if dry_run:
            print(f'  → Would execute: {sql}')
        else:
            c.execute(sql)
            print(f'  ✓ Added: {sql}')
        added.append(col_name)

    # Initialize historical data: set last_confidence_update = updated_at for existing records
    if not dry_run and added:
        c.execute("""
            UPDATE chunks 
            SET last_confidence_update = updated_at / 1000
            WHERE last_confidence_update IS NULL
        """)
        updated = c.rowcount
        print(f'  ✓ Initialized last_confidence_update for {updated} existing chunks')

    if not dry_run:
        db.commit()
        print('\n✅ Migration complete')

        # Verify
        c.execute('PRAGMA table_info(chunks)')
        cols = {row[1]: row for row in c.fetchall()}
        for col_name, _, _ in COLUMNS:
            if col_name in cols:
                print(f'  ✅ {col_name} verified')
            else:
                print(f'  ❌ {col_name} MISSING')

        # Show a sample
        c.execute("""
            SELECT id, category, confidence, base_tau, hit_count, 
                   is_archived, is_protected, conflict_flag
            FROM chunks LIMIT 3
        """)
        print('\nSample data:')
        for row in c.fetchall():
            print(f'  {row[0][:16]} cat={row[1]} conf={row[2]} tau={row[3]} hits={row[4]} arch={row[5]} prot={row[6]} confl={row[7]}')

    db.close()


if __name__ == '__main__':
    dry = '--dry-run' in sys.argv
    if dry:
        print('=== DRY RUN ===')
    run_migration(dry_run=dry)
