use crate::storage::db::{Connection, DbError, Param};
use crate::storage::{StorageResult, now_unix};

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial_schema",
        sql: include_str!("../../migrations/V1__initial_schema.sql"),
    },
    Migration {
        version: 2,
        name: "watched_channels_broadcaster_id",
        sql: include_str!("../../migrations/V2__watched_channels_broadcaster_id.sql"),
    },
];

pub fn run_migrations(conn: &Connection) -> StorageResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        );
        "#,
    )?;

    for migration in MIGRATIONS {
        if migration_applied(conn, migration.version)? {
            continue;
        }

        apply_migration(conn, migration)?;
    }

    Ok(())
}

fn migration_applied(conn: &Connection, version: i64) -> StorageResult<bool> {
    Ok(conn
        .query_one(
            "SELECT version FROM schema_migrations WHERE version = ? LIMIT 1",
            &[Param::Integer(version)],
        )?
        .is_some())
}

fn apply_migration(conn: &Connection, migration: &Migration) -> StorageResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    match apply_migration_inner(conn, migration) {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(error) => {
            if let Err(rollback_error) = conn.execute_batch("ROLLBACK;") {
                eprintln!(
                    "[storage/migration] failed to rollback migration v{} after error: {}",
                    migration.version, rollback_error
                );
            }
            Err(error)
        }
    }
}

fn apply_migration_inner(conn: &Connection, migration: &Migration) -> StorageResult<()> {
    match conn.execute_batch(migration.sql) {
        Ok(()) => {}
        Err(DbError::Sqlite(message))
            if migration.version == 2 && is_duplicate_column(&message) => {}
        Err(error) => return Err(error.into()),
    }

    conn.execute(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        &[
            Param::Integer(migration.version),
            Param::Text(migration.name),
            Param::Integer(now_unix()),
        ],
    )?;
    Ok(())
}

fn is_duplicate_column(message: &str) -> bool {
    message.to_lowercase().contains("duplicate column")
}
