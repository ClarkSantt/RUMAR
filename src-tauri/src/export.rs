use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};

const MAX_EXPORT_BYTES: usize = 100 * 1024 * 1024;

#[tauri::command]
pub fn export_write(destination: String, content: String) -> Result<u64, String> {
    let path = Path::new(&destination);
    if !matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("csv" | "json" | "ics")
    ) {
        return Err("Formato de exportação não permitido.".into());
    }
    if content.is_empty() || content.len() > MAX_EXPORT_BYTES {
        return Err("Exportação vazia ou maior que 100 MB.".into());
    }
    if path.exists() {
        return Err("O arquivo já existe. Escolha outro nome para evitar sobrescrever dados.".into());
    }
    let parent = path.parent().ok_or("Destino inválido.")?;
    if !parent.is_dir() {
        return Err("Pasta de destino não encontrada.".into());
    }
    let temp = parent.join(format!(".rumo-export-{}.partial", uuid::Uuid::new_v4()));
    let result = (|| -> Result<u64, String> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| error.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        // Hard-linking within the same directory publishes a fully synced file
        // without replacing an existing destination in a save-dialog race.
        fs::hard_link(&temp, path).map_err(|error| error.to_string())?;
        let _ = fs::remove_file(&temp);
        Ok(content.len() as u64)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
