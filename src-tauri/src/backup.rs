use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const CURRENT_SCHEMA: i64 = 28;
const MAX_DB_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ATTACHMENTS: usize = 10_000;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
struct ManifestAttachment {
    relative_path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    app: String,
    app_version: String,
    schema_version: i64,
    created_at: String,
    database: String,
    sha256: String,
    kind: String,
    #[serde(default)]
    attachments: Vec<ManifestAttachment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataInfo {
    database_path: String,
    automatic_directory: String,
    app_version: String,
}

struct TemporaryDb(PathBuf);
impl Drop for TemporaryDb {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
        let _ = fs::remove_file(format!("{}-wal", self.0.display()));
        let _ = fs::remove_file(format!("{}-shm", self.0.display()));
    }
}
struct StagedBackup {
    database: TemporaryDb,
    attachments: PathBuf,
}
impl Drop for StagedBackup {
    fn drop(&mut self) {
        // The path is generated within app_config_dir, never taken from archive entries.
        let _ = fs::remove_dir_all(&self.attachments);
    }
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn now() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}
fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("rumo.db"))
}
fn backup_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(err)?.join("backups"))
}
fn temp_db(parent: &Path) -> Result<TemporaryDb, String> {
    fs::create_dir_all(&parent).map_err(err)?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(err)?
        .as_nanos();
    let path = parent.join(format!(".rumo-{}-{nanos}.db", std::process::id()));
    Ok(TemporaryDb(path))
}
fn open_readonly(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)
}
fn integrity(connection: &Connection) -> Result<(), String> {
    let result: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(err)?;
    if result != "ok" {
        return Err("A verificação de integridade do SQLite falhou.".into());
    }
    Ok(())
}
fn schema(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT MAX(version) FROM _sqlx_migrations WHERE success=1",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map_err(|_| "O arquivo não contém migrations do RUMO.".to_string())?
        .ok_or_else(|| "O arquivo não contém migrations do RUMO.".to_string())
}
fn sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(err)?;
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash).map_err(err)?;
    Ok(format!("{:x}", hash.finalize()))
}
fn sqlite_snapshot(source: &Path, destination: &Path) -> Result<(), String> {
    let src = open_readonly(source)?;
    integrity(&src)?;
    let mut dst = Connection::open(destination).map_err(err)?;
    let backup = Backup::new(&src, &mut dst).map_err(err)?;
    backup
        .run_to_completion(128, Duration::from_millis(25), None)
        .map_err(err)?;
    drop(backup);
    integrity(&dst)
}

fn listed_attachments(connection: &Connection) -> Result<Vec<ManifestAttachment>, String> {
    if schema(connection)? < 20 {
        return Ok(Vec::new());
    }
    let mut statement = connection
        .prepare("SELECT relative_path,file_size,sha256 FROM attachments ORDER BY relative_path")
        .map_err(err)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ManifestAttachment {
                relative_path: row.get(0)?,
                size: row.get(1)?,
                sha256: row.get(2)?,
            })
        })
        .map_err(err)?;
    rows.map(|item| item.map_err(err)).collect()
}
fn check_attachment_list(rows: &[ManifestAttachment], root: &Path) -> Result<(), String> {
    if rows.len() > MAX_ATTACHMENTS {
        return Err("Há anexos demais neste arquivo.".into());
    }
    let mut total = 0u64;
    let mut seen = std::collections::HashSet::new();
    for row in rows {
        if !seen.insert(&row.relative_path) {
            return Err("Anexo duplicado no manifest.".into());
        }
        crate::attachments::validated_relative(&row.relative_path)?;
        if row.size == 0 || row.size > crate::attachments::MAX_FILE_BYTES || row.sha256.len() != 64
        {
            return Err("Metadados de anexo inválidos.".into());
        }
        total = total
            .checked_add(row.size)
            .ok_or("Tamanho total inválido.")?;
        if total > MAX_ATTACHMENT_TOTAL {
            return Err("Os anexos excedem 2 GB.".into());
        }
        let file = crate::attachments::managed_file(root, &row.relative_path)?;
        if !file.is_file()
            || fs::metadata(&file).map_err(err)?.len() != row.size
            || sha256(&file)? != row.sha256
        {
            return Err("Anexo ausente ou corrompido.".into());
        }
    }
    Ok(())
}
fn create_archive(
    source: &Path,
    destination: &Path,
    workdir: &Path,
    kind: &str,
) -> Result<Manifest, String> {
    let snapshot = temp_db(workdir)?;
    sqlite_snapshot(source, &snapshot.0)?;
    let connection = open_readonly(&snapshot.0)?;
    let attachments = listed_attachments(&connection)?;
    check_attachment_list(&attachments, workdir)?;
    let manifest = Manifest {
        app: "RUMAR".into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        schema_version: schema(&connection)?,
        created_at: now(),
        database: "rumo.db".into(),
        sha256: sha256(&snapshot.0)?,
        kind: kind.into(),
        attachments,
    };
    drop(connection);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let temporary = destination.with_extension(format!("{}.partial", std::process::id()));
    let result = (|| -> Result<(), String> {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(err)?;
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive.start_file("manifest.json", options).map_err(err)?;
        archive
            .write_all(&serde_json::to_vec(&manifest).map_err(err)?)
            .map_err(err)?;
        archive.start_file("rumo.db", options).map_err(err)?;
        io::copy(&mut File::open(&snapshot.0).map_err(err)?, &mut archive).map_err(err)?;
        for item in &manifest.attachments {
            archive
                .start_file(&item.relative_path, options)
                .map_err(err)?;
            let source = crate::attachments::managed_file(workdir, &item.relative_path)?;
            let mut input = File::open(source).map_err(err)?;
            let mut digest = Sha256::new();
            let mut copied = 0u64;
            let mut buffer = [0u8; 64 * 1024];
            loop {
                let read = input.read(&mut buffer).map_err(err)?;
                if read == 0 {
                    break;
                }
                copied = copied
                    .checked_add(read as u64)
                    .ok_or("Anexo muito grande.")?;
                if copied > item.size {
                    return Err("Anexo mudou durante o backup.".into());
                }
                archive.write_all(&buffer[..read]).map_err(err)?;
                digest.update(&buffer[..read]);
            }
            if copied != item.size || format!("{:x}", digest.finalize()) != item.sha256 {
                return Err("Anexo mudou durante o backup.".into());
            }
        }
        let file = archive.finish().map_err(err)?;
        file.sync_all().map_err(err)?;
        if destination.exists() {
            return Err("Já existe um arquivo nesse destino. Escolha outro nome.".into());
        }
        fs::rename(&temporary, destination).map_err(err)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|_| manifest)
}
fn validated_archive(path: &Path, workdir: &Path) -> Result<(Manifest, StagedBackup), String> {
    let file = File::open(path).map_err(|_| "Não foi possível abrir o backup.".to_string())?;
    let mut archive =
        ZipArchive::new(file).map_err(|_| "Arquivo de backup inválido.".to_string())?;
    if archive.len() < 2 || archive.len() > MAX_ATTACHMENTS + 2 {
        return Err("Quantidade de arquivos do backup inválida.".into());
    }
    if archive.by_name("manifest.json").is_err() || archive.by_name("rumo.db").is_err() {
        return Err("O backup não contém os arquivos esperados.".into());
    }
    let mut manifest_bytes = Vec::new();
    archive
        .by_name("manifest.json")
        .map_err(err)?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut manifest_bytes)
        .map_err(err)?;
    if manifest_bytes.len() > 1024 * 1024 {
        return Err("Manifest do backup muito grande.".into());
    }
    let manifest: Manifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|_| "Manifest do backup inválido.".to_string())?;
    if !["RUMO", "RUMAR"].contains(&manifest.app.as_str())
        || manifest.database != "rumo.db"
        || manifest.schema_version < 1
        || !["manual", "automatic", "pre_restore"].contains(&manifest.kind.as_str())
    {
        return Err("Este não é um backup válido do RUMAR ou RUMO legado.".into());
    }
    if manifest.schema_version > CURRENT_SCHEMA {
        return Err("Este backup foi criado por uma versão mais recente do RUMAR. Atualize o aplicativo antes de restaurá-lo.".into());
    }
    if (manifest.schema_version < 20 && !manifest.attachments.is_empty())
        || (manifest.schema_version < 20 && manifest_bytes.len() > 16 * 1024)
    {
        return Err("Manifest do backup incompatível com o schema.".into());
    }
    if archive.len() != 2 + manifest.attachments.len() {
        return Err("Arquivos do backup não correspondem ao manifest.".into());
    }
    let expected: std::collections::HashSet<_> = std::iter::once("manifest.json".to_string())
        .chain(std::iter::once("rumo.db".to_string()))
        .chain(manifest.attachments.iter().map(|a| a.relative_path.clone()))
        .collect();
    if expected.len() != archive.len() {
        return Err("Arquivo duplicado no backup.".into());
    }
    for index in 0..archive.len() {
        let name = archive.by_index(index).map_err(err)?.name().to_string();
        if !expected.contains(&name) {
            return Err("Arquivo inesperado no backup.".into());
        }
    }
    let entry = archive.by_name("rumo.db").map_err(err)?;
    if entry.size() > MAX_DB_BYTES {
        return Err("Banco do backup excede o tamanho permitido.".into());
    }
    let temporary = temp_db(workdir)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary.0)
        .map_err(err)?;
    let copied = io::copy(&mut entry.take(MAX_DB_BYTES + 1), &mut output).map_err(err)?;
    output.sync_all().map_err(err)?;
    if copied > MAX_DB_BYTES || copied == 0 || sha256(&temporary.0)? != manifest.sha256 {
        return Err("O banco do backup está incompleto ou foi alterado.".into());
    }
    let db = open_readonly(&temporary.0)
        .map_err(|_| "O backup não contém um banco SQLite válido.".to_string())?;
    integrity(&db)?;
    if schema(&db)? != manifest.schema_version {
        return Err("A versão do schema não corresponde ao manifest.".into());
    }
    if listed_attachments(&db)? != manifest.attachments {
        return Err("Os anexos do banco não correspondem ao manifest.".into());
    }
    let staged = StagedBackup {
        database: temporary,
        attachments: workdir.join(format!(".rumo-restore-{}", uuid::Uuid::new_v4())),
    };
    fs::create_dir(&staged.attachments).map_err(err)?;
    fs::create_dir(staged.attachments.join("attachments")).map_err(err)?;
    let mut total = 0u64;
    for item in &manifest.attachments {
        let relative = crate::attachments::validated_relative(&item.relative_path)?;
        if item.size == 0 || item.size > crate::attachments::MAX_FILE_BYTES {
            return Err("Tamanho de anexo inválido.".into());
        }
        total = total
            .checked_add(item.size)
            .ok_or("Tamanho total inválido.")?;
        if total > MAX_ATTACHMENT_TOTAL {
            return Err("Os anexos excedem 2 GB.".into());
        }
        let target = staged.attachments.join(relative);
        fs::create_dir_all(target.parent().ok_or("Caminho inválido.")?).map_err(err)?;
        let mut input = archive.by_name(&item.relative_path).map_err(err)?;
        if input.size() != item.size {
            return Err("Tamanho de anexo divergente.".into());
        }
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(err)?;
        let copied = io::copy(
            &mut input.take(crate::attachments::MAX_FILE_BYTES + 1),
            &mut output,
        )
        .map_err(err)?;
        output.sync_all().map_err(err)?;
        if copied != item.size {
            return Err("Anexo incompleto.".into());
        }
    }
    check_attachment_list(&manifest.attachments, &staged.attachments)?;
    Ok((manifest, staged))
}

#[tauri::command]
pub fn data_info(app: AppHandle) -> Result<DataInfo, String> {
    Ok(DataInfo {
        database_path: database_path(&app)?.display().to_string(),
        automatic_directory: backup_directory(&app)?.display().to_string(),
        app_version: env!("CARGO_PKG_VERSION").into(),
    })
}
#[tauri::command]
pub fn check_integrity(app: AppHandle) -> Result<String, String> {
    integrity(&open_readonly(&database_path(&app)?)?)?;
    Ok("Banco íntegro (PRAGMA integrity_check: ok).".into())
}
#[tauri::command]
pub fn create_backup(app: AppHandle, destination: String) -> Result<Manifest, String> {
    create_archive(
        &database_path(&app)?,
        Path::new(&destination),
        &app.path().app_config_dir().map_err(err)?,
        "manual",
    )
}
#[tauri::command]
pub fn inspect_backup(app: AppHandle, source: String) -> Result<Manifest, String> {
    validated_archive(
        Path::new(&source),
        &app.path().app_config_dir().map_err(err)?,
    )
    .map(|(manifest, _)| manifest)
}
#[tauri::command]
pub fn restore_backup(app: AppHandle, source: String) -> Result<String, String> {
    let workdir = app.path().app_config_dir().map_err(err)?;
    let current = database_path(&app)?;
    let directory = backup_directory(&app)?;
    restore_archive(Path::new(&source), &current, &directory, &workdir)
}
#[tauri::command]
pub fn restart_after_restore(app: AppHandle) {
    app.restart();
}
fn restore_archive(
    source: &Path,
    current: &Path,
    directory: &Path,
    workdir: &Path,
) -> Result<String, String> {
    let (_manifest, staged) = validated_archive(source, workdir)?;
    fs::create_dir_all(&directory).map_err(err)?;
    let preventive = directory.join(format!("RUMAR-pre-restore-{}.zip", now()));
    create_archive(current, &preventive, workdir, "pre_restore")?;
    let current_files = workdir.join("attachments");
    let previous_files = workdir.join(format!(".rumo-before-restore-{}", uuid::Uuid::new_v4()));
    let had_files = current_files.exists();
    if had_files {
        fs::rename(&current_files, &previous_files).map_err(err)?;
    }
    let staged_files = staged.attachments.join("attachments");
    if let Err(error) = fs::rename(&staged_files, &current_files) {
        if had_files {
            fs::rename(&previous_files, &current_files).map_err(|rollback_error| {
                format!("A preparação dos anexos falhou ({error}) e a recuperação dos arquivos não foi confirmada ({rollback_error}). Backup preventivo: {}", preventive.display())
            })?;
        }
        return Err(format!("Não foi possível preparar os anexos: {error}"));
    }
    // SQL backup writes inside a destination transaction. If it fails, restore
    // both the database and its previous managed directory from the preventive state.
    if let Err(error) = sqlite_snapshot(&staged.database.0, current) {
        let files_rollback = fs::rename(&current_files, &staged_files)
            .and_then(|_| {
                if had_files { fs::rename(&previous_files, &current_files) } else { Ok(()) }
            });
        // A completed write followed by an integrity error must not leave the
        // original state inaccessible. Restore it from the validated snapshot.
        let rollback = validated_archive(&preventive, workdir)
            .and_then(|(_, previous)| sqlite_snapshot(&previous.database.0, current));
        return match (rollback, files_rollback) {
            (Ok(()), Ok(())) => Err(format!("Restauração não concluída; o estado anterior foi recuperado. {error}")),
            (database_result, file_result) => Err(format!(
                "A restauração falhou e a recuperação automática não foi confirmada. Backup preventivo: {}. Erro inicial: {error}. Banco: {:?}. Anexos: {:?}",
                preventive.display(), database_result.err(), file_result.err()
            )),
        };
    }
    if had_files {
        let _ = fs::remove_dir_all(&previous_files);
    }
    Ok(preventive.display().to_string())
}
#[tauri::command]
pub fn automatic_backup(app: AppHandle) -> Result<Option<String>, String> {
    let current = database_path(&app)?;
    let db = Connection::open(&current).map_err(err)?;
    let (frequency, keep, last): (String, i64, Option<String>) = db
        .query_row(
            "SELECT frequency,keep_count,last_auto_at FROM backup_preferences WHERE id=1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(err)?;
    let seconds = now().parse::<i64>().map_err(err)?;
    if !backup_due(&frequency, last.as_deref(), seconds) {
        return Ok(None);
    }
    let directory = backup_directory(&app)?;
    fs::create_dir_all(&directory).map_err(err)?;
    let destination = directory.join(format!("RUMAR-auto-{seconds}.zip"));
    drop(db);
    create_archive(
        &current,
        &destination,
        &app.path().app_config_dir().map_err(err)?,
        "automatic",
    )?;
    let db = Connection::open(&current).map_err(err)?;
    db.execute(
        "UPDATE backup_preferences SET last_auto_at=?1 WHERE id=1",
        [seconds.to_string()],
    )
    .map_err(err)?;
    prune_automatic(&directory, keep)?;
    Ok(Some(destination.display().to_string()))
}
fn backup_due(frequency: &str, last: Option<&str>, now: i64) -> bool {
    let interval = match frequency {
        "daily" => 86400,
        "weekly" => 7 * 86400,
        _ => return false,
    };
    !last
        .and_then(|value| value.parse::<i64>().ok())
        .is_some_and(|value| now - value < interval)
}
fn prune_automatic(directory: &Path, keep: i64) -> Result<(), String> {
    let mut managed: Vec<PathBuf> = fs::read_dir(directory)
        .map_err(err)?
        .filter_map(Result::ok)
        .map(|item| item.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| auto_backup_timestamp(name).is_some())
        })
        .filter(|path| {
            File::open(path)
                .ok()
                .and_then(|file| ZipArchive::new(file).ok())
                .and_then(|mut archive| {
                    let mut contents = String::new();
                    archive
                        .by_name("manifest.json")
                        .ok()?
                        .take(16 * 1024)
                        .read_to_string(&mut contents)
                        .ok()?;
                    serde_json::from_str::<Manifest>(&contents).ok()
                })
                .is_some_and(|manifest| {
                    ["RUMO", "RUMAR"].contains(&manifest.app.as_str())
                        && manifest.kind == "automatic"
                        && manifest.database == "rumo.db"
                })
        })
        .collect();
    managed.sort_by_key(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .and_then(auto_backup_timestamp)
            .unwrap_or_default()
    });
    for old in managed.into_iter().rev().skip(keep.clamp(1, 50) as usize) {
        fs::remove_file(old).map_err(err)?;
    }
    Ok(())
}

fn auto_backup_timestamp(name: &str) -> Option<i64> {
    let value = name
        .strip_prefix("RUMAR-auto-")
        .or_else(|| name.strip_prefix("RUMO-auto-"))?
        .strip_suffix(".zip")?;
    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    value.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Area(PathBuf);
    impl Area {
        fn new() -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            for attempt in 0..100 {
                let path = std::env::temp_dir().join(format!(
                    "rumo-backup-test-{}-{nanos}-{attempt}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("cannot create test directory: {error}"),
                }
            }
            panic!("cannot allocate a unique test directory")
        }
    }
    impl Drop for Area {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn seed(path: &Path, version: i64, value: &str) -> Connection {
        let db = Connection::open(path).unwrap();
        db.execute_batch("CREATE TABLE _sqlx_migrations(version INTEGER,success INTEGER); CREATE TABLE settings(value TEXT);").unwrap();
        if version >= 20 {
            db.execute_batch(
                "CREATE TABLE attachments(relative_path TEXT,file_size INTEGER,sha256 TEXT);",
            )
            .unwrap();
        }
        db.execute("INSERT INTO _sqlx_migrations VALUES(?1,1)", [version])
            .unwrap();
        db.execute("INSERT INTO settings VALUES(?1)", [value])
            .unwrap();
        db
    }
    fn custom_zip(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        for (name, content) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap();
    }
    #[test]
    fn snapshot_captures_wal_and_restore_preserves_pre_restore_state() {
        let area = Area::new();
        let current = area.0.join("rumo.db");
        let db = seed(&current, 4, "estado A");
        db.execute_batch("PRAGMA journal_mode=WAL; INSERT INTO settings VALUES('em WAL');")
            .unwrap();
        let archive = area.0.join("a.zip");
        create_archive(&current, &archive, &area.0, "manual").unwrap();
        assert_eq!(
            validated_archive(&archive, &area.0)
                .unwrap()
                .0
                .schema_version,
            4
        );
        drop(db);
        let db = Connection::open(&current).unwrap();
        db.execute(
            "UPDATE settings SET value='estado B' WHERE value='estado A'",
            [],
        )
        .unwrap();
        db.execute("UPDATE _sqlx_migrations SET version=8", [])
            .unwrap();
        drop(db);
        let preventive =
            restore_archive(&archive, &current, &area.0.join("backups"), &area.0).unwrap();
        let restored = open_readonly(&current).unwrap();
        let values: Vec<String> = restored
            .prepare("SELECT value FROM settings ORDER BY value")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(values, vec!["em WAL", "estado A"]);
        assert_eq!(schema(&restored).unwrap(), 4);
        assert_eq!(
            validated_archive(Path::new(&preventive), &area.0)
                .unwrap()
                .0
                .schema_version,
            8
        );
    }
    #[test]
    fn current_schema_backup_can_be_restored() {
        let area = Area::new();
        let current = area.0.join("rumo.db");
        let db = seed(&current, CURRENT_SCHEMA, "state A");
        drop(db);
        let archive = area.0.join("current.zip");
        create_archive(&current, &archive, &area.0, "manual").unwrap();
        let db = Connection::open(&current).unwrap();
        db.execute("UPDATE settings SET value='state B'", []).unwrap();
        drop(db);
        restore_archive(&archive, &current, &area.0.join("backups"), &area.0).unwrap();
        let restored = open_readonly(&current).unwrap();
        let value: String = restored
            .query_row("SELECT value FROM settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(value, "state A");
        assert_eq!(schema(&restored).unwrap(), CURRENT_SCHEMA);
    }
    #[test]
    fn invalid_and_future_backups_never_change_current_database() {
        let area = Area::new();
        let current = area.0.join("rumo.db");
        drop(seed(&current, 8, "intacto"));
        let original = sha256(&current).unwrap();
        let random = area.0.join("random.zip");
        fs::write(&random, b"not a zip").unwrap();
        assert!(restore_archive(&random, &current, &area.0.join("backups"), &area.0).is_err());
        let future = area.0.join("future.db");
        drop(seed(&future, CURRENT_SCHEMA + 1, "futuro"));
        let future_archive = area.0.join("future.zip");
        create_archive(&future, &future_archive, &area.0, "manual").unwrap();
        assert!(
            restore_archive(&future_archive, &current, &area.0.join("backups"), &area.0)
                .unwrap_err()
                .contains("mais recente")
        );
        assert_eq!(sha256(&current).unwrap(), original);
    }
    #[test]
    fn missing_corrupt_hash_and_traversal_archives_are_rejected() {
        let area = Area::new();
        let current = area.0.join("rumo.db");
        drop(seed(&current, 8, "intacto"));
        let original = sha256(&current).unwrap();
        let good = area.0.join("good.zip");
        let manifest = create_archive(&current, &good, &area.0, "manual").unwrap();
        let bytes = fs::read(&current).unwrap();
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        let cases = vec![
            vec![("rumo.db", bytes.clone())],
            vec![("manifest.json", manifest_bytes.clone())],
            vec![
                ("manifest.json", manifest_bytes.clone()),
                ("rumo.db", b"corrupt SQLite".to_vec()),
            ],
            vec![
                ("manifest.json", manifest_bytes.clone()),
                ("rumo.db", bytes.clone()),
                ("../evil", b"bad".to_vec()),
            ],
            vec![
                ("manifest.json", b"not json".to_vec()),
                ("rumo.db", bytes.clone()),
            ],
        ];
        for (index, entries) in cases.iter().enumerate() {
            let path = area.0.join(format!("bad-{index}.zip"));
            custom_zip(&path, entries);
            assert!(restore_archive(&path, &current, &area.0.join("backups"), &area.0).is_err());
            assert_eq!(sha256(&current).unwrap(), original);
        }
        let mut wrong_hash = manifest;
        wrong_hash.sha256 = "0".repeat(64);
        let path = area.0.join("wrong-hash.zip");
        custom_zip(
            &path,
            &[
                ("manifest.json", serde_json::to_vec(&wrong_hash).unwrap()),
                ("rumo.db", bytes),
            ],
        );
        assert!(restore_archive(&path, &current, &area.0.join("backups"), &area.0).is_err());
        assert_eq!(sha256(&current).unwrap(), original);
    }
    #[test]
    fn schedule_and_retention_only_manage_automatic_archives() {
        assert!(!backup_due("off", None, 100000));
        assert!(backup_due("daily", None, 100000));
        assert!(!backup_due("daily", Some("100000"), 100001));
        assert!(backup_due("daily", Some("100000"), 186400));
        assert!(!backup_due("weekly", Some("100000"), 186400));
        let area = Area::new();
        let source = area.0.join("rumo.db");
        drop(seed(&source, 8, "test"));
        let managed = area.0.join("backups");
        fs::create_dir(&managed).unwrap();
        for number in 1..=3 {
            create_archive(
                &source,
                &managed.join(format!("RUMO-auto-{number}.zip")),
                &area.0,
                "automatic",
            )
            .unwrap();
        }
        let manual = managed.join("RUMO-auto-0.zip");
        create_archive(&source, &manual, &area.0, "manual").unwrap();
        prune_automatic(&managed, 2).unwrap();
        assert!(!managed.join("RUMO-auto-1.zip").exists());
        assert!(managed.join("RUMO-auto-2.zip").exists());
        assert!(managed.join("RUMO-auto-3.zip").exists());
        assert!(manual.exists());
    }
    #[test]
    fn attachment_restore_preserves_files_and_pre_restore_copy() {
        let area = Area::new();
        let current = area.0.join("rumo.db");
        let db = seed(&current, 20, "state A");
        let relative = "attachments/11111111-1111-4111-8111-111111111111/file.pdf";
        let file = area.0.join(relative);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, b"%PDF-1.4 state A").unwrap();
        db.execute(
            "INSERT INTO attachments VALUES(?1,?2,?3)",
            rusqlite::params![relative, fs::metadata(&file).unwrap().len(), sha256(&file).unwrap()],
        ).unwrap();
        drop(db);
        let archive = area.0.join("a.zip");
        create_archive(&current, &archive, &area.0, "manual").unwrap();
        fs::write(&file, b"%PDF-1.4 state B").unwrap();
        let db = Connection::open(&current).unwrap();
        db.execute("UPDATE attachments SET file_size=?1,sha256=?2", rusqlite::params![fs::metadata(&file).unwrap().len(), sha256(&file).unwrap()]).unwrap();
        db.execute("UPDATE settings SET value='state B'", []).unwrap();
        drop(db);
        let preventive = restore_archive(&archive, &current, &area.0.join("backups"), &area.0).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"%PDF-1.4 state A");
        let restored = open_readonly(&current).unwrap();
        let value:String = restored.query_row("SELECT value FROM settings",[],|row|row.get(0)).unwrap();
        assert_eq!(value, "state A");
        let (_, before) = validated_archive(Path::new(&preventive), &area.0).unwrap();
        assert_eq!(fs::read(before.attachments.join(relative)).unwrap(), b"%PDF-1.4 state B");
    }
}
