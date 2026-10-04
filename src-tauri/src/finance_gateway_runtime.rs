//! Owns the personal loopback gateway. The app never starts a public listener or a service.
use base64::Engine;
use serde_json::{json, Value};
use std::{
    ffi::c_void,
    fs,
    net::TcpListener,
    os::windows::process::CommandExt,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::Duration,
};
use tauri::{App, AppHandle, Manager};
use uuid::Uuid;
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB},
};

const PORT: u16 = 8787;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
static STOPPED: AtomicBool = AtomicBool::new(false);
static CHILD: Mutex<Option<ManagedGateway>> = Mutex::new(None);
static START_LOCK: Mutex<()> = Mutex::new(());
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

struct ManagedGateway {
    process: Child,
    instance_id: String,
}

pub fn managed_build() -> bool {
    option_env!("RUMO_FINANCE_GATEWAY_URL").is_none()
}

fn decrypt(encoded: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "gateway_credentials")?;
    if bytes.is_empty() || bytes.len() > 4096 {
        return Err("gateway_credentials".into());
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            &mut output,
        )
    };
    if ok == 0 || output.pbData.is_null() {
        return Err("gateway_credentials".into());
    }
    let result = String::from_utf8(unsafe {
        std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
    })
    .map_err(|_| "gateway_credentials".to_string());
    unsafe {
        LocalFree(output.pbData as *mut c_void);
    }
    result
}

fn personal_credentials(path: &Path) -> Result<(String, String), String> {
    let record: Value = serde_json::from_slice(&fs::read(path).map_err(|_| "gateway_credentials")?)
        .map_err(|_| "gateway_credentials")?;
    if record.get("mode").and_then(Value::as_str) != Some("personal") {
        return Err("gateway_credentials_mode".into());
    }
    let id = record
        .get("clientId")
        .and_then(Value::as_str)
        .ok_or("gateway_credentials")?;
    let secret = record
        .get("clientSecret")
        .and_then(Value::as_str)
        .ok_or("gateway_credentials")?;
    Ok((decrypt(id)?, decrypt(secret)?))
}

fn launch(app: &AppHandle) -> Result<(), String> {
    let _starting = START_LOCK.lock().map_err(|_| "gateway_start")?;
    if STOPPED.load(Ordering::SeqCst) {
        return Ok(());
    }
    if CHILD.lock().map_err(|_| "gateway_start")?.is_some() {
        return Ok(());
    }
    let data_dir = app.path().app_config_dir().map_err(|_| "gateway_path")?;
    let credential_path = data_dir.join("pluggy-personal-credentials.dpapi.json");
    if !credential_path.is_file() {
        return Ok(());
    }
    let (client_id, client_secret) = personal_credentials(&credential_path)?;
    let resource_dir = app.path().resource_dir().map_err(|_| "gateway_path")?;
    let runtime_dir = resource_dir.join("finance-gateway");
    let node = runtime_dir.join("node.exe");
    let server = runtime_dir.join("src").join("server.mjs");
    if !node.is_file() || !server.is_file() {
        return Err("gateway_runtime_missing".into());
    }
    // A pre-existing listener is never trusted or paired, even if it answers /health.
    let listener = TcpListener::bind(("127.0.0.1", PORT)).map_err(|_| "gateway_port_busy")?;
    fs::create_dir_all(&data_dir).map_err(|_| "gateway_path")?;
    let instance_id = Uuid::new_v4().to_string();
    let pair_code = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let webhook_secret = format!("{}{}", Uuid::new_v4(), Uuid::new_v4());
    let mut command = Command::new(node);
    command
        .arg(server)
        .current_dir(runtime_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .env_clear()
        .env("PLUGGY_CLIENT_ID", client_id)
        .env("PLUGGY_CLIENT_SECRET", client_secret)
        .env("GATEWAY_MODE", "personal")
        .env("GATEWAY_DEPLOYMENT", "local")
        .env("GATEWAY_PUBLIC_URL", format!("http://127.0.0.1:{PORT}"))
        .env("GATEWAY_PORT", PORT.to_string())
        .env("GATEWAY_DATABASE_PATH", data_dir.join("finance-gateway.db"))
        .env("GATEWAY_WEBHOOK_SECRET", webhook_secret)
        .env("GATEWAY_ALLOW_LIVE", "false")
        .env("GATEWAY_LIVE_PILOT_APPROVED", "false")
        .env("GATEWAY_INSTANCE_ID", &instance_id)
        .env("GATEWAY_BOOTSTRAP_PAIR_CODE", &pair_code)
        .env("GATEWAY_PARENT_STDIN", "1");
    for key in [
        "SystemRoot",
        "WINDIR",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
    ] {
        if let Ok(value) = std::env::var(key) {
            command.env(key, value);
        }
    }
    drop(listener);
    let mut child = command.spawn().map_err(|_| "gateway_start")?;
    let mut ready = false;
    for _ in 0..30 {
        if STOPPED.load(Ordering::SeqCst)
            || child.try_wait().map_err(|_| "gateway_start")?.is_some()
        {
            break;
        }
        if let Ok(health) = super::finance_gateway::raw_request("GET", "/health", &json!({}), None)
        {
            if health.get("instanceId").and_then(Value::as_str) == Some(instance_id.as_str()) {
                ready = true;
                break;
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    if !ready || STOPPED.load(Ordering::SeqCst) {
        let _ = child.kill();
        let _ = child.wait();
        return Err("gateway_start".into());
    }
    if super::finance_gateway::existing_device_works().is_err() {
        let response = super::finance_gateway::raw_request(
            "POST",
            "/v1/device/pair",
            &json!({"code": pair_code}),
            None,
        )?;
        super::finance_gateway::save_device_response(&response)?;
    }
    *CHILD.lock().map_err(|_| "gateway_start")? = Some(ManagedGateway {
        process: child,
        instance_id,
    });
    Ok(())
}

pub fn setup(app: &mut App) {
    if !managed_build() {
        return;
    }
    let handle = app.handle().clone();
    let _ = APP_HANDLE.set(handle.clone());
    thread::spawn(move || {
        let _ = launch(&handle);
    });
}

pub fn ensure_ready() -> Result<(), String> {
    if !managed_build() {
        return Ok(());
    }
    {
        let mut guard = CHILD.lock().map_err(|_| "gateway_offline")?;
        if guard
            .as_mut()
            .is_some_and(|managed| managed.process.try_wait().ok().flatten().is_some())
        {
            *guard = None;
        }
    }
    if CHILD.lock().map_err(|_| "gateway_offline")?.is_none() {
        let app = APP_HANDLE.get().ok_or("gateway_offline")?;
        launch(app)?;
    }
    let instance = CHILD
        .lock()
        .map_err(|_| "gateway_offline")?
        .as_ref()
        .map(|managed| managed.instance_id.clone())
        .ok_or("gateway_offline")?;
    let health = super::finance_gateway::raw_request("GET", "/health", &json!({}), None)?;
    if health.get("instanceId").and_then(Value::as_str) == Some(instance.as_str()) {
        Ok(())
    } else {
        Err("gateway_identity".into())
    }
}

pub fn shutdown() {
    STOPPED.store(true, Ordering::SeqCst);
    let _starting = START_LOCK.lock();
    if let Ok(mut guard) = CHILD.lock() {
        if let Some(mut gateway) = guard.take() {
            gateway.process.stdin.take();
            for _ in 0..20 {
                if gateway.process.try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
            let _ = gateway.process.kill();
            let _ = gateway.process.wait();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN};

    fn protect(value: &str) -> String {
        let input = CRYPT_INTEGER_BLOB {
            cbData: value.len() as u32,
            pbData: value.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        assert_ne!(
            unsafe {
                CryptProtectData(
                    &input,
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut output,
                )
            },
            0
        );
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) });
        unsafe {
            LocalFree(output.pbData as *mut c_void);
        }
        encoded
    }

    #[test]
    fn personal_credentials_use_current_user_dpapi_and_reject_other_modes() {
        let path =
            std::env::temp_dir().join(format!("rumo-personal-dpapi-{}.json", Uuid::new_v4()));
        let record = json!({
            "mode": "personal",
            "clientId": protect("fake-client-id"),
            "clientSecret": protect("fake-client-secret"),
        });
        fs::write(&path, record.to_string()).unwrap();
        assert_eq!(
            personal_credentials(&path).unwrap(),
            ("fake-client-id".into(), "fake-client-secret".into())
        );
        fs::write(&path, json!({"mode":"live", "clientId":record["clientId"], "clientSecret":record["clientSecret"]}).to_string()).unwrap();
        assert_eq!(
            personal_credentials(&path).unwrap_err(),
            "gateway_credentials_mode"
        );
        fs::remove_file(path).unwrap();
    }
}
