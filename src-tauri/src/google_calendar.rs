//! Optional Google Calendar mirror. Tokens never cross the Tauri IPC boundary or enter SQLite.
//! Windows Credential Manager binds the refresh token to a database integration identity.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    ffi::c_void,
    io::{Read, Write},
    net::TcpListener,
    ptr::{null, null_mut},
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;
use windows_sys::Win32::{
    Foundation::GetLastError,
    Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpOpen, WinHttpOpenRequest, WinHttpQueryHeaders,
        WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest, WinHttpSetOption,
        WinHttpSetTimeouts, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_DISABLE_REDIRECTS,
        WINHTTP_FLAG_SECURE, WINHTTP_OPTION_DISABLE_FEATURE, WINHTTP_QUERY_FLAG_NUMBER,
        WINHTTP_QUERY_STATUS_CODE,
    },
    Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    },
    UI::Shell::ShellExecuteW,
};

const SCOPE: &str = "https://www.googleapis.com/auth/calendar.app.created";
const MAX_RESPONSE: usize = 256 * 1024;
type Cached = (String, Instant);
static ACCESS: OnceLock<Mutex<HashMap<String, Cached>>> = OnceLock::new();
fn cache() -> &'static Mutex<HashMap<String, Cached>> {
    ACCESS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
fn valid_identity(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn valid_client(value: &str) -> bool {
    value.len() > 35
        && value.len() < 512
        && value.ends_with(".apps.googleusercontent.com")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
}
fn target(identity: &str) -> Result<Vec<u16>, String> {
    if !valid_identity(identity) {
        return Err("invalid".into());
    }
    let namespace = if cfg!(test) {
        "RUMO-Test"
    } else {
        option_env!("RUMO_CREDENTIAL_NAMESPACE").unwrap_or("RUMO")
    };
    Ok(wide(&format!("{namespace}/google-calendar/{identity}")))
}

fn read_refresh(identity: &str) -> Result<Option<String>, String> {
    let name = target(identity)?;
    let mut pointer: *mut CREDENTIALW = null_mut();
    // SAFETY: the target is NUL-terminated, the output pointer is initialized, and CredFree
    // releases the single allocation returned by CredReadW before returning.
    unsafe {
        if CredReadW(name.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) == 0 {
            return if GetLastError() == 1168 {
                Ok(None)
            } else {
                Err("credential_store".into())
            };
        }
        if pointer.is_null() {
            return Err("credential_store".into());
        }
        let credential = &*pointer;
        let result = if credential.CredentialBlobSize > 2560 || credential.CredentialBlob.is_null()
        {
            Err("credential_store".into())
        } else {
            String::from_utf8(
                std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
                .to_vec(),
            )
            .map(Some)
            .map_err(|_| "credential_store".into())
        };
        CredFree(pointer as *const c_void);
        result
    }
}
fn write_refresh(identity: &str, refresh: &str) -> Result<(), String> {
    let mut name = target(identity)?;
    if refresh.is_empty() || refresh.len() > 2500 {
        return Err("auth".into());
    }
    let mut bytes = refresh.as_bytes().to_vec();
    let mut credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: name.as_mut_ptr(),
        CredentialBlobSize: bytes.len() as u32,
        CredentialBlob: bytes.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..CREDENTIALW::default()
    };
    // SAFETY: all pointed-to buffers remain alive until CredWriteW returns.
    if unsafe { CredWriteW(&mut credential, 0) } == 0 {
        return Err("credential_store".into());
    }
    Ok(())
}
fn delete_refresh(identity: &str) -> Result<(), String> {
    let name = target(identity)?;
    // SAFETY: the target is NUL-terminated and CredDeleteW does not retain it.
    let result = unsafe { CredDeleteW(name.as_ptr(), CRED_TYPE_GENERIC, 0) };
    if result == 0 && unsafe { GetLastError() } != 1168 {
        return Err("credential_store".into());
    }
    cache()
        .lock()
        .map_err(|_| "credential_store".to_string())?
        .remove(identity);
    Ok(())
}

struct HttpHandle(*mut c_void);
impl Drop for HttpHandle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: each handle is owned by this wrapper and closed once.
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
}
fn http(
    method: &str,
    host: &str,
    path: &str,
    body: &[u8],
    headers: &str,
) -> Result<(u32, Vec<u8>), String> {
    if !matches!(host, "oauth2.googleapis.com" | "www.googleapis.com")
        || !path.starts_with('/')
        || path.contains('\r')
        || path.contains('\n')
        || !matches!(method, "GET" | "POST" | "PATCH" | "DELETE")
        || body.len() > 100_000
    {
        return Err("invalid".into());
    }
    let agent = wide("RUMO/1.7");
    // SAFETY: WinHTTP pointers refer to live UTF-16 buffers; handles are RAII-closed.
    unsafe {
        let session = HttpHandle(WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            null(),
            null(),
            0,
        ));
        if session.0.is_null() {
            return Err("network".into());
        }
        if WinHttpSetTimeouts(session.0, 10_000, 10_000, 20_000, 30_000) == 0 {
            return Err("network".into());
        }
        let host_w = wide(host);
        let connection = HttpHandle(WinHttpConnect(session.0, host_w.as_ptr(), 443, 0));
        if connection.0.is_null() {
            return Err("network".into());
        }
        let method_w = wide(method);
        let path_w = wide(path);
        let request = HttpHandle(WinHttpOpenRequest(
            connection.0,
            method_w.as_ptr(),
            path_w.as_ptr(),
            null(),
            null(),
            null(),
            WINHTTP_FLAG_SECURE,
        ));
        if request.0.is_null() {
            return Err("network".into());
        }
        let disable: u32 = WINHTTP_DISABLE_REDIRECTS;
        if WinHttpSetOption(
            request.0,
            WINHTTP_OPTION_DISABLE_FEATURE,
            &disable as *const u32 as *const c_void,
            4,
        ) == 0
        {
            return Err("network".into());
        }
        let headers_w = wide(headers);
        if WinHttpSendRequest(
            request.0,
            headers_w.as_ptr(),
            (headers_w.len() - 1) as u32,
            body.as_ptr() as *const c_void,
            body.len() as u32,
            body.len() as u32,
            0,
        ) == 0
        {
            return Err("network".into());
        }
        if WinHttpReceiveResponse(request.0, null_mut()) == 0 {
            return Err("network".into());
        }
        let mut status: u32 = 0;
        let mut size: u32 = 4;
        if WinHttpQueryHeaders(
            request.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            null(),
            &mut status as *mut u32 as *mut c_void,
            &mut size,
            null_mut(),
        ) == 0
        {
            return Err("network".into());
        }
        let mut output = Vec::new();
        loop {
            let mut buffer = [0u8; 8192];
            let mut count: u32 = 0;
            if WinHttpReadData(
                request.0,
                buffer.as_mut_ptr() as *mut c_void,
                buffer.len() as u32,
                &mut count,
            ) == 0
            {
                return Err("network".into());
            }
            if count == 0 {
                break;
            }
            if output.len() + count as usize > MAX_RESPONSE {
                return Err("invalid".into());
            }
            output.extend_from_slice(&buffer[..count as usize]);
        }
        Ok((status, output))
    }
}
fn encode(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-._~".contains(&byte) {
            result.push(byte as char);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}
fn decode(value: &str) -> Result<String, String> {
    let mut bytes = Vec::new();
    let input = value.as_bytes();
    let mut at = 0;
    while at < input.len() {
        if input[at] == b'%' {
            if at + 2 >= input.len() {
                return Err("auth".into());
            }
            let hex = std::str::from_utf8(&input[at + 1..at + 3]).map_err(|_| "auth")?;
            bytes.push(u8::from_str_radix(hex, 16).map_err(|_| "auth")?);
            at += 3;
        } else {
            bytes.push(if input[at] == b'+' { b' ' } else { input[at] });
            at += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| "auth".into())
}
fn query_value(path: &str, key: &str) -> Result<Option<String>, String> {
    let query = path.split_once('?').map(|(_, query)| query).unwrap_or("");
    for pair in query.split('&') {
        if let Some((name, value)) = pair.split_once('=') {
            if name == key {
                return decode(value).map(Some);
            }
        }
    }
    Ok(None)
}
fn browser(url: &str) -> Result<(), String> {
    let url_w = wide(url);
    let open_w = wide("open");
    // SAFETY: ShellExecuteW sees NUL-terminated buffers, does not retain them, and opens the
    // system browser. No embedded WebView receives the Google login page.
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            open_w.as_ptr(),
            url_w.as_ptr(),
            null(),
            null(),
            1,
        )
    };
    if result as usize <= 32 {
        Err("browser".into())
    } else {
        Ok(())
    }
}
fn authorization_code(client_id: &str) -> Result<(String, String, String), String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "loopback")?;
    let port = listener.local_addr().map_err(|_| "loopback")?.port();
    listener.set_nonblocking(true).map_err(|_| "loopback")?;
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let verifier = format!(
        "{}{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let url = format!("https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&access_type=offline&prompt=consent&code_challenge={challenge}&code_challenge_method=S256&state={state}",
        encode(client_id), encode(&redirect), encode(SCOPE));
    browser(&url)?;
    let deadline = Instant::now() + Duration::from_secs(300);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut socket, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .map_err(|_| "loopback")?;
                let request_bytes = read_callback_headers(&mut socket)?;
                let request = std::str::from_utf8(&request_bytes).map_err(|_| "auth")?;
                let first = request.lines().next().ok_or("auth")?;
                let path = first
                    .strip_prefix("GET ")
                    .and_then(|line| line.split_once(" HTTP/1."))
                    .map(|(path, _)| path)
                    .ok_or("auth")?;
                let host = request
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("Host: ")
                            .or_else(|| line.strip_prefix("host: "))
                    })
                    .unwrap_or("")
                    .trim();
                if host != format!("127.0.0.1:{port}") || !path.starts_with("/callback?") {
                    continue;
                }
                let received = query_value(path, "state")?.ok_or("auth")?;
                if received != state {
                    return Err("auth".into());
                }
                if query_value(path, "error")?.is_some() {
                    return Err("auth".into());
                }
                let code = query_value(path, "code")?.ok_or("auth")?;
                let page = b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n<!doctype html><html lang=pt-BR><meta charset=utf-8><title>RUMO</title><p>Google Agenda conectado ao RUMO. Voce pode fechar esta janela.</p></html>";
                socket.write_all(page).map_err(|_| "loopback")?;
                return Ok((code, verifier, redirect));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(150))
            }
            Err(_) => return Err("loopback".into()),
        }
    }
    Err("timeout".into())
}
fn read_callback_headers(reader: &mut impl Read) -> Result<Vec<u8>, String> {
    let mut input = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while input.len() < 8192 {
        let count = reader.read(&mut chunk).map_err(|_| "loopback")?;
        if count == 0 {
            return Err("auth".into());
        }
        input.extend_from_slice(&chunk[..count]);
        if let Some(end) = input.windows(4).position(|bytes| bytes == b"\r\n\r\n") {
            if end + 4 > 8192 {
                return Err("auth".into());
            }
            input.truncate(end + 4);
            return Ok(input);
        }
    }
    Err("auth".into())
}
fn token_request(fields: &[(&str, &str)]) -> Result<Value, String> {
    let form = fields
        .iter()
        .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
        .collect::<Vec<_>>()
        .join("&");
    let (status, response) = http(
        "POST",
        "oauth2.googleapis.com",
        "/token",
        form.as_bytes(),
        "Content-Type: application/x-www-form-urlencoded\r\n",
    )?;
    if status != 200 {
        return Err(if status == 400 || status == 401 {
            "auth"
        } else if status >= 500 {
            "server"
        } else {
            "invalid"
        }
        .into());
    }
    serde_json::from_slice(&response).map_err(|_| "auth".into())
}
fn access_token(identity: &str, client_id: &str) -> Result<String, String> {
    if !valid_client(client_id) {
        return Err("invalid".into());
    }
    if let Some((token, expiry)) = cache().lock().map_err(|_| "auth")?.get(identity) {
        if Instant::now() < *expiry {
            return Ok(token.clone());
        }
    }
    let refresh = read_refresh(identity)?.ok_or("auth")?;
    let result = token_request(&[
        ("client_id", client_id),
        ("refresh_token", &refresh),
        ("grant_type", "refresh_token"),
    ])?;
    let token = result["access_token"].as_str().ok_or("auth")?.to_string();
    let seconds = result["expires_in"].as_u64().unwrap_or(3600).min(3600);
    cache().lock().map_err(|_| "auth")?.insert(
        identity.to_string(),
        (
            token.clone(),
            Instant::now() + Duration::from_secs(seconds.saturating_sub(60)),
        ),
    );
    Ok(token)
}

#[tauri::command]
pub fn google_has_credential(integration_id: String) -> Result<bool, String> {
    Ok(read_refresh(&integration_id)?.is_some())
}
#[tauri::command]
pub async fn google_connect(integration_id: String, client_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        target(&integration_id)?;
        if !valid_client(&client_id) {
            return Err("invalid".into());
        }
        let (code, verifier, redirect) = authorization_code(&client_id)?;
        let response = token_request(&[
            ("client_id", &client_id),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
            ("grant_type", "authorization_code"),
        ])?;
        let refresh = response["refresh_token"].as_str().ok_or("auth")?;
        write_refresh(&integration_id, refresh)?;
        let token = response["access_token"].as_str().ok_or("auth")?.to_string();
        let seconds = response["expires_in"].as_u64().unwrap_or(3600).min(3600);
        cache().lock().map_err(|_| "auth")?.insert(
            integration_id,
            (
                token,
                Instant::now() + Duration::from_secs(seconds.saturating_sub(60)),
            ),
        );
        Ok(())
    })
    .await
    .map_err(|_| "auth".to_string())?
}
#[tauri::command]
pub fn google_disconnect(integration_id: String) -> Result<(), String> {
    delete_refresh(&integration_id)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleRequest {
    integration_id: String,
    client_id: String,
    operation: String,
    calendar_id: Option<String>,
    event_id: Option<String>,
    body: Option<Value>,
}
fn run_request(input: GoogleRequest) -> Result<Value, String> {
    target(&input.integration_id)?;
    if !valid_client(&input.client_id) {
        return Err("invalid".into());
    }
    let calendar = input.calendar_id.as_deref().unwrap_or("");
    let event = input.event_id.as_deref().unwrap_or("");
    if calendar.len() > 512
        || event.len() > 512
        || calendar.chars().any(char::is_control)
        || event.chars().any(char::is_control)
    {
        return Err("invalid".into());
    }
    let calendar_path = format!("/calendar/v3/calendars/{}", encode(calendar));
    let (method, path, body) = match input.operation.as_str() {
        "create_calendar" if calendar.is_empty() && event.is_empty() => {
            ("POST", "/calendar/v3/calendars".to_string(), input.body)
        }
        "get_calendar" if !calendar.is_empty() && event.is_empty() => ("GET", calendar_path, None),
        "delete_calendar" if !calendar.is_empty() && event.is_empty() => {
            ("DELETE", calendar_path, None)
        }
        "create_event" if !calendar.is_empty() && event.is_empty() => {
            ("POST", format!("{calendar_path}/events"), input.body)
        }
        "get_event" if !calendar.is_empty() && !event.is_empty() => (
            "GET",
            format!("{calendar_path}/events/{}", encode(event)),
            None,
        ),
        "patch_event" if !calendar.is_empty() && !event.is_empty() => (
            "PATCH",
            format!("{calendar_path}/events/{}", encode(event)),
            input.body,
        ),
        "delete_event" if !calendar.is_empty() && !event.is_empty() => (
            "DELETE",
            format!("{calendar_path}/events/{}", encode(event)),
            None,
        ),
        _ => return Err("invalid".into()),
    };
    let body = body
        .map(|value| serde_json::to_vec(&value).map_err(|_| "invalid".to_string()))
        .transpose()?
        .unwrap_or_default();
    let mut token = access_token(&input.integration_id, &input.client_id)?;
    for attempt in 0..2 {
        let headers =
            format!("Authorization: Bearer {token}\r\nContent-Type: application/json\r\n");
        let (status, response) = http(method, "www.googleapis.com", &path, &body, &headers)?;
        if status == 401 && attempt == 0 {
            cache()
                .lock()
                .map_err(|_| "auth")?
                .remove(&input.integration_id);
            token = access_token(&input.integration_id, &input.client_id)?;
            continue;
        }
        return match status {
            200 | 201 => serde_json::from_slice(&response).map_err(|_| "invalid".into()),
            204 => Ok(json!(null)),
            401 => Err("auth".into()),
            403 => Err("forbidden".into()),
            404 => Err("not_found".into()),
            409 => Err("conflict".into()),
            429 => Err("rate_limit".into()),
            500..=599 => Err("server".into()),
            _ => Err("invalid".into()),
        };
    }
    Err("auth".into())
}
#[tauri::command]
pub async fn google_calendar_request(request: GoogleRequest) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_request(request))
        .await
        .map_err(|_| "network".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_s256_and_state_helpers_never_use_plain() {
        let verifier = format!(
            "{}{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        );
        assert_eq!(verifier.len(), 96);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge.len(), 43);
        assert_ne!(challenge, verifier);
        assert_eq!(decode("4%2Fcode").unwrap(), "4/code");
    }
    #[test]
    fn credential_identity_and_client_are_restricted() {
        assert!(valid_identity("0123456789abcdef0123456789abcdef"));
        assert!(!valid_identity("../../escape"));
        assert!(valid_client(
            "example-0123456789.apps.googleusercontent.com"
        ));
        assert!(!valid_client(
            "example.apps.googleusercontent.com\r\nHeader: evil"
        ));
    }
    #[test]
    fn credential_manager_roundtrip_uses_only_a_test_identity() {
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = delete_refresh(&self.0);
            }
        }

        let identity = Uuid::new_v4().simple().to_string();
        let _cleanup = Cleanup(identity.clone());
        assert_eq!(read_refresh(&identity).unwrap(), None);
        write_refresh(&identity, "rumo-native-test-first").unwrap();
        assert_eq!(
            read_refresh(&identity).unwrap().as_deref(),
            Some("rumo-native-test-first")
        );
        write_refresh(&identity, "rumo-native-test-replaced").unwrap();
        assert_eq!(
            read_refresh(&identity).unwrap().as_deref(),
            Some("rumo-native-test-replaced")
        );
        delete_refresh(&identity).unwrap();
        assert_eq!(read_refresh(&identity).unwrap(), None);
    }
    #[test]
    fn callback_headers_may_arrive_in_separate_tcp_reads() {
        struct Chunks(Vec<&'static [u8]>);
        impl Read for Chunks {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                if self.0.is_empty() {
                    return Ok(0);
                }
                let next = self.0.remove(0);
                output[..next.len()].copy_from_slice(next);
                Ok(next.len())
            }
        }
        let mut request = Chunks(vec![
            b"GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: ",
            b"127.0.0.1:1234\r\n\r\n",
        ]);
        let result = read_callback_headers(&mut request).unwrap();
        assert!(String::from_utf8(result).unwrap().contains("Host: 127.0.0.1:1234"));
    }
}
