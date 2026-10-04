use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

pub const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024;
const TYPES: &[(&str, &str)] = &[
    ("pdf", "application/pdf"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("txt", "text/plain"),
    ("csv", "text/csv"),
    ("json", "application/json"),
    (
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    (
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
];
#[derive(Serialize)]
pub struct Attachment {
    id: String,
    entity_type: String,
    entity_id: String,
    original_name: String,
    stored_name: String,
    relative_path: String,
    mime_type: String,
    file_size: u64,
    sha256: String,
    created_at: String,
}
#[derive(Serialize)]
pub struct StorageReport {
    pub database_bytes: u64,
    pub attachment_bytes: u64,
    pub attachment_count: u64,
    pub missing: u64,
    pub mismatched: u64,
    pub orphan_files: u64,
}
#[derive(Serialize)]
pub struct StorageSummary {
    pub database_bytes: u64,
    pub attachment_bytes: u64,
    pub attachment_count: u64,
    pub backup_bytes: u64,
}
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}
fn database(app: &AppHandle) -> Result<Connection, String> {
    Connection::open(data_dir(app)?.join("rumo.db")).map_err(|e| e.to_string())
}
pub fn validated_relative(value: &str) -> Result<PathBuf, String> {
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() != 3
        || parts[0] != "attachments"
        || uuid::Uuid::parse_str(parts[1]).is_err()
        || !parts[2].starts_with("file.")
        || !TYPES
            .iter()
            .any(|(ext, _)| parts[2] == format!("file.{ext}"))
    {
        return Err("Caminho interno do anexo inválido.".into());
    }
    Ok(PathBuf::from(parts[0]).join(parts[1]).join(parts[2]))
}
pub fn managed_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let safe = validated_relative(relative)?;
    let mut current = root.to_path_buf();
    for component in safe.components() {
        current.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current)
            .map_err(|_| "Anexo ausente ou inacessível.".to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("Link simbólico não permitido no armazenamento de anexos.".into());
        }
    }
    if !current.is_file() {
        return Err("Anexo ausente ou inacessível.".into());
    }
    Ok(current)
}
fn kind(path: &Path, head: &[u8]) -> Result<(&'static str, &'static str), String> {
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let &(extension, mime) = TYPES
        .iter()
        .find(|(v, _)| *v == ext)
        .ok_or("Tipo de arquivo não permitido.")?;
    if head.starts_with(b"MZ") || head.starts_with(b"\x7fELF") {
        return Err("Arquivo executável recusado.".into());
    }
    let valid = match extension {
        "pdf" => head.starts_with(b"%PDF-"),
        "png" => head.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => head.starts_with(b"\xff\xd8\xff"),
        "webp" => head.len() >= 12 && &head[..4] == b"RIFF" && &head[8..12] == b"WEBP",
        "docx" | "xlsx" => head.starts_with(b"PK\x03\x04"),
        _ => std::str::from_utf8(head).is_ok(),
    };
    if !valid {
        return Err("O conteúdo não corresponde ao tipo de arquivo.".into());
    }
    Ok((extension, mime))
}
fn is_entity(db: &Connection, entity_type: &str, entity_id: &str) -> Result<bool, String> {
    let table = match entity_type {
        "project" => "projects",
        "thought" => "thoughts",
        "objective" => "objectives",
        "moment" => "timeline_notes",
        "finance_transaction" => "finance_transactions",
        _ => return Err("Tipo de vínculo não permitido.".into()),
    };
    db.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id=?1)"),
        [entity_id],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n == 1)
    .map_err(|e| e.to_string())
}
fn attachment(db: &Connection, id: &str) -> Result<Attachment, String> {
    db.query_row("SELECT id,entity_type,entity_id,original_name,stored_name,relative_path,mime_type,file_size,sha256,created_at FROM attachments WHERE id=?1",[id],|r|Ok(Attachment{id:r.get(0)?,entity_type:r.get(1)?,entity_id:r.get(2)?,original_name:r.get(3)?,stored_name:r.get(4)?,relative_path:r.get(5)?,mime_type:r.get(6)?,file_size:r.get(7)?,sha256:r.get(8)?,created_at:r.get(9)?})).map_err(|_|"Anexo não encontrado.".into())
}
#[tauri::command]
pub fn attachment_add(
    app: AppHandle,
    entity_type: String,
    entity_id: String,
    source: String,
) -> Result<Attachment, String> {
    let db = database(&app)?;
    if !is_entity(&db, &entity_type, &entity_id)? {
        return Err("Registro vinculado não encontrado.".into());
    }
    let path = Path::new(&source);
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_FILE_BYTES {
        return Err("Arquivo vazio ou maior que 100 MB.".into());
    }
    let original = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Nome de arquivo inválido.")?
        .to_string();
    if original.chars().count() > 255 {
        return Err("Nome de arquivo muito longo.".into());
    }
    let mut input = File::open(path).map_err(|e| e.to_string())?;
    let mut head = [0u8; 16];
    let n = input.read(&mut head).map_err(|e| e.to_string())?;
    let (ext, mime) = kind(path, &head[..n])?;
    input.rewind().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let stored_name = format!("file.{ext}");
    let relative_path = format!("attachments/{id}/{stored_name}");
    let root = data_dir(&app)?;
    let managed = root.join("attachments");
    if managed.exists()
        && fs::symlink_metadata(&managed)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
    {
        return Err("Link simbólico não permitido no armazenamento de anexos.".into());
    }
    let directory = managed.join(&id);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let target = directory.join(&stored_name);
    let result = (|| -> Result<Attachment, String> {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
        let mut digest = Sha256::new();
        let mut bytes = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let n = input.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            bytes += n as u64;
            if bytes > MAX_FILE_BYTES {
                return Err("Arquivo maior que 100 MB.".into());
            }
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            digest.update(&buffer[..n]);
        }
        output.sync_all().map_err(|e| e.to_string())?;
        if bytes != metadata.len() {
            return Err("Arquivo mudou durante a cópia.".into());
        }
        let hash = format!("{:x}", digest.finalize());
        db.execute("INSERT INTO attachments(id,entity_type,entity_id,original_name,stored_name,relative_path,mime_type,file_size,sha256,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",params![id,entity_type,entity_id,original,stored_name,relative_path,mime,bytes,hash]).map_err(|e|e.to_string())?;
        attachment(&db, &id)
    })();
    if result.is_err() {
        let _ = db.execute("DELETE FROM attachments WHERE id=?1", [&id]);
        let _ = fs::remove_dir_all(&directory);
    }
    result
}
#[tauri::command]
pub fn attachment_list(
    app: AppHandle,
    entity_type: String,
    entity_id: String,
) -> Result<Vec<Attachment>, String> {
    let db = database(&app)?;
    if !is_entity(&db, &entity_type, &entity_id)? {
        return Err("Registro vinculado não encontrado.".into());
    }
    let mut stmt=db.prepare("SELECT id FROM attachments WHERE entity_type=?1 AND entity_id=?2 ORDER BY created_at,id").map_err(|e|e.to_string())?;
    let ids = stmt
        .query_map(params![entity_type, entity_id], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    ids.map(|v| attachment(&db, &v.map_err(|e| e.to_string())?))
        .collect()
}
#[tauri::command]
pub fn attachment_remove(app: AppHandle, id: String) -> Result<(), String> {
    let db = database(&app)?;
    attachment(&db, &id)?;
    db.execute("DELETE FROM attachments WHERE id=?1", [&id])
        .map_err(|e| e.to_string())?;
    cleanup(&db, &data_dir(&app)?)?;
    Ok(())
}
fn cleanup(db: &Connection, root: &Path) -> Result<(), String> {
    let mut stmt = db
        .prepare("SELECT relative_path FROM attachment_cleanup")
        .map_err(|e| e.to_string())?;
    let paths = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for path in paths {
        let relative = path.map_err(|e| e.to_string())?;
        let safe = validated_relative(&relative)?;
        let absolute = root.join(&safe);
        if absolute.exists() {
            let safe_file = managed_file(root, &relative)?;
            fs::remove_file(&safe_file).map_err(|e| e.to_string())?;
        }
        if let Some(parent) = absolute.parent() {
            let _ = fs::remove_dir(parent);
        }
        db.execute(
            "DELETE FROM attachment_cleanup WHERE relative_path=?1",
            [relative],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
pub fn attachment_cleanup(app: AppHandle) -> Result<(), String> {
    let db = database(&app)?;
    cleanup(&db, &data_dir(&app)?)
}
#[tauri::command]
pub fn attachment_stats(app: AppHandle) -> Result<StorageSummary, String> {
    let db = database(&app)?;
    let root = data_dir(&app)?;
    let (attachment_count, attachment_bytes): (u64, u64) = db
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(file_size),0) FROM attachments",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let mut backup_bytes = 0u64;
    let backup_dir = root.join("backups");
    if backup_dir.is_dir() {
        for entry in fs::read_dir(backup_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if entry.file_type().map_err(|error| error.to_string())?.is_file() {
                backup_bytes = backup_bytes.saturating_add(
                    entry.metadata().map_err(|error| error.to_string())?.len(),
                );
            }
        }
    }
    Ok(StorageSummary {
        database_bytes: fs::metadata(root.join("rumo.db")).map(|m| m.len()).unwrap_or(0),
        attachment_bytes,
        attachment_count,
        backup_bytes,
    })
}
#[tauri::command]
pub fn attachment_check(app: AppHandle) -> Result<StorageReport, String> {
    let db = database(&app)?;
    let root = data_dir(&app)?;
    let mut report = StorageReport {
        database_bytes: fs::metadata(root.join("rumo.db"))
            .map(|m| m.len())
            .unwrap_or(0),
        attachment_bytes: 0,
        attachment_count: 0,
        missing: 0,
        mismatched: 0,
        orphan_files: 0,
    };
    let mut stmt = db
        .prepare("SELECT relative_path,file_size,sha256 FROM attachments")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, u64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (path, size, hash) = row.map_err(|e| e.to_string())?;
        report.attachment_count += 1;
        report.attachment_bytes += size;
        let file = managed_file(&root, &path);
        if file.is_err() {
            report.missing += 1;
        } else {
            let file = file?;
            if fs::metadata(&file).map_err(|e| e.to_string())?.len() != size
                || hash_file(&file)? != hash
            {
                report.mismatched += 1;
            }
        }
    }
    let dir = root.join("attachments");
    if dir.exists() {
        if fs::symlink_metadata(&dir)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Link simbólico não permitido no armazenamento de anexos.".into());
        }
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
                report.orphan_files += 1;
                continue;
            }
            for file in fs::read_dir(entry.path()).map_err(|e| e.to_string())? {
                let file = file.map_err(|e| e.to_string())?;
                let relative = format!(
                    "attachments/{}/{}",
                    entry.file_name().to_string_lossy(),
                    file.file_name().to_string_lossy()
                );
                let found: i64 = db
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM attachments WHERE relative_path=?1)",
                        [relative],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if found == 0 {
                    report.orphan_files += 1;
                }
            }
        }
    }
    Ok(report)
}
pub fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}
#[tauri::command]
pub fn attachment_open(app: AppHandle, id: String, reveal: bool) -> Result<(), String> {
    let db = database(&app)?;
    let row = attachment(&db, &id)?;
    let target = managed_file(&data_dir(&app)?, &row.relative_path)?;
    if fs::metadata(&target).map_err(|e| e.to_string())?.len() != row.file_size
        || hash_file(&target)? != row.sha256
    {
        return Err("A integridade do arquivo mudou.".into());
    }
    let mut command = Command::new("explorer.exe");
    if reveal {
        command.arg("/select,");
    }
    command.arg(&target);
    command.spawn().map_err(|e| e.to_string())?;
    Ok(())
}
