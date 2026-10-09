use sqlx::{
    migrate::Migrator,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    borrow::Cow,
    env,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const LEGACY_VERSION: i64 = 11;
const TARGET_VERSION: i64 = 29;

fn temporary_database(label: &str) -> PathBuf {
    env::temp_dir().join(format!("rumar-{label}-{}.sqlite", Uuid::new_v4()))
}

async fn connect(path: &Path) -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("open SQLite test database")
}

async fn migrator() -> Migrator {
    Migrator::new(Path::new("migrations"))
        .await
        .expect("load product migrations")
}

async fn migrate_through(pool: &SqlitePool, version: i64) {
    let mut selected = migrator().await;
    selected.migrations = Cow::Owned(
        selected
            .iter()
            .filter(|migration| migration.version <= version)
            .cloned()
            .collect(),
    );
    selected.run(pool).await.expect("run SQLx migrations");
}

async fn assert_database_health(pool: &SqlitePool, expected_version: i64) {
    let version: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
        .expect("read migration version");
    assert_eq!(version, expected_version);

    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(pool)
        .await
        .expect("run integrity_check");
    assert_eq!(integrity, "ok");

    let violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await
        .expect("run foreign_key_check");
    assert!(
        violations.is_empty(),
        "foreign key violations: {}",
        violations.len()
    );
}

async fn schema_signature(pool: &SqlitePool) -> Vec<(String, String, String, String)> {
    sqlx::query(
        "SELECT type,name,tbl_name,COALESCE(sql,'') AS sql FROM sqlite_master \
         WHERE name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations' \
         ORDER BY type,name",
    )
    .fetch_all(pool)
    .await
    .expect("read schema")
    .into_iter()
    .map(|row| {
        (
            row.get("type"),
            row.get("name"),
            row.get("tbl_name"),
            row.get("sql"),
        )
    })
    .collect()
}

#[tokio::test]
async fn fresh_database_migrates_to_current_schema() {
    let path = temporary_database("fresh");
    let pool = connect(&path).await;
    migrator()
        .await
        .run(&pool)
        .await
        .expect("migrate fresh database");
    assert_database_health(&pool, TARGET_VERSION).await;
    pool.close().await;
    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn schema_11_upgrade_uses_real_sqlx_migrator_and_preserves_fixture() {
    let legacy_path = temporary_database("legacy");
    let fresh_path = temporary_database("comparison");
    let legacy = connect(&legacy_path).await;
    migrate_through(&legacy, LEGACY_VERSION).await;
    assert_database_health(&legacy, LEGACY_VERSION).await;

    sqlx::query(
        "INSERT INTO thoughts(id,title,content,created_at,updated_at) \
         VALUES('migration-test-thought','TESTE RUMAR','synthetic','2026-01-02T03:04:05Z','2026-01-02T03:04:05Z')",
    )
    .execute(&legacy)
    .await
    .expect("insert synthetic legacy fixture");

    migrator()
        .await
        .run(&legacy)
        .await
        .expect("upgrade schema 11 database");
    assert_database_health(&legacy, TARGET_VERSION).await;
    let fixture_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM thoughts WHERE id='migration-test-thought' AND title='TESTE RUMAR'",
    )
    .fetch_one(&legacy)
    .await
    .expect("verify synthetic fixture");
    assert_eq!(fixture_count, 1);

    let fresh = connect(&fresh_path).await;
    migrator()
        .await
        .run(&fresh)
        .await
        .expect("migrate comparison database");
    assert_eq!(
        schema_signature(&legacy).await,
        schema_signature(&fresh).await
    );

    legacy.close().await;
    fresh.close().await;
    let _ = std::fs::remove_file(legacy_path);
    let _ = std::fs::remove_file(fresh_path);
}

#[tokio::test]
async fn external_schema_11_copy_migrates_when_explicitly_configured() {
    let Ok(path) = env::var("RUMAR_MIGRATION_DRY_RUN_DB") else {
        return;
    };
    let pool = connect(Path::new(&path)).await;
    assert_database_health(&pool, LEGACY_VERSION).await;
    migrator()
        .await
        .run(&pool)
        .await
        .expect("upgrade authorized dry-run copy");
    assert_database_health(&pool, TARGET_VERSION).await;
    pool.close().await;
}
