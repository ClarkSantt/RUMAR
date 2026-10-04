//! Financial gateway bridge. The per-device secret remains in Windows Credential Manager.
//! The frontend can request only fixed gateway routes; it never receives the device credential.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    ffi::c_void,
    ptr::{null, null_mut},
};
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
};

const MAX_RESPONSE: usize = 4 * 1024 * 1024;
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
struct Handle(*mut c_void);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe {
                WinHttpCloseHandle(self.0);
            }
        }
    }
}
fn endpoint() -> Result<(String, u16, bool), String> {
    let configured = option_env!("RUMO_FINANCE_GATEWAY_URL").unwrap_or("http://127.0.0.1:8787");
    let (host, port, secure) = if let Some(host) = configured.strip_prefix("https://") {
        (host, 443, true)
    } else if let Some(port) = configured.strip_prefix("http://127.0.0.1:") {
        let port = port.parse::<u16>().map_err(|_| "gateway_config")?;
        if port == 0 {
            return Err("gateway_config".into());
        }
        return Ok(("127.0.0.1".into(), port, false));
    } else {
        return Err("gateway_unconfigured".into());
    };
    if host.len() < 4
        || host.len() > 253
        || host.contains('/')
        || host.contains(':')
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
    {
        return Err("gateway_config".into());
    }
    Ok((host.to_string(), port, secure))
}
fn credential_target() -> Result<Vec<u16>, String> {
    let (host, port, secure) = endpoint()?;
    let origin = format!("{}://{host}:{port}", if secure { "https" } else { "http" });
    let namespace = option_env!("RUMO_CREDENTIAL_NAMESPACE").unwrap_or("RUMO");
    Ok(wide(&format!(
        "{namespace}/finance-gateway/device/{:x}",
        Sha256::digest(origin.as_bytes())
    )))
}
pub(crate) fn credential() -> Result<Option<Value>, String> {
    let target = credential_target()?;
    let mut pointer: *mut CREDENTIALW = null_mut();
    unsafe {
        if CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) == 0 {
            return if GetLastError() == 1168 {
                Ok(None)
            } else {
                Err("credential_store".into())
            };
        }
        if pointer.is_null() {
            return Err("credential_store".into());
        }
        let cred = &*pointer;
        let result = if cred.CredentialBlobSize > 2048 || cred.CredentialBlob.is_null() {
            Err("credential_store".into())
        } else {
            serde_json::from_slice(std::slice::from_raw_parts(
                cred.CredentialBlob,
                cred.CredentialBlobSize as usize,
            ))
            .map(Some)
            .map_err(|_| "credential_store".into())
        };
        CredFree(pointer as *const c_void);
        result
    }
}
pub(crate) fn save_credential(value: &Value) -> Result<(), String> {
    let mut target = credential_target()?;
    let mut bytes = serde_json::to_vec(value).map_err(|_| "credential_store")?;
    if bytes.len() > 2048 {
        return Err("credential_store".into());
    }
    let mut cred = CREDENTIALW {
        Type: CRED_TYPE_GENERIC,
        TargetName: target.as_mut_ptr(),
        CredentialBlobSize: bytes.len() as u32,
        CredentialBlob: bytes.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        ..CREDENTIALW::default()
    };
    if unsafe { CredWriteW(&mut cred, 0) } == 0 {
        return Err("credential_store".into());
    }
    Ok(())
}
fn remove_credential() -> Result<(), String> {
    let target = credential_target()?;
    if unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) } == 0
        && unsafe { GetLastError() } != 1168
    {
        return Err("credential_store".into());
    }
    Ok(())
}
pub(crate) fn raw_request(
    method: &str,
    path: &str,
    body: &Value,
    authorization: Option<&str>,
) -> Result<Value, String> {
    if !matches!(method, "GET" | "POST" | "DELETE")
        || !path.starts_with('/')
        || path.contains("..")
        || path.contains('\r')
        || path.contains('\n')
        || path.len() > 4096
    {
        return Err("invalid_request".into());
    }
    let (host, port, secure) = endpoint()?;
    let payload = if method == "POST" {
        serde_json::to_vec(body).map_err(|_| "invalid_request")?
    } else {
        Vec::new()
    };
    if payload.len() > 16_384 {
        return Err("invalid_request".into());
    }
    let mut headers = String::from("Content-Type: application/json\r\n");
    if let Some(auth) = authorization {
        if auth.len() > 256
            || !auth
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b))
        {
            return Err("credential_store".into());
        }
        headers.push_str(&format!("Authorization: Bearer {auth}\r\n"));
    }
    unsafe {
        let agent = wide("RUMO/finance-gateway");
        let session = Handle(WinHttpOpen(
            agent.as_ptr(),
            WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
            null(),
            null(),
            0,
        ));
        if session.0.is_null() || WinHttpSetTimeouts(session.0, 10_000, 10_000, 20_000, 30_000) == 0
        {
            return Err("gateway_offline".into());
        }
        let host_w = wide(&host);
        let connection = Handle(WinHttpConnect(session.0, host_w.as_ptr(), port, 0));
        if connection.0.is_null() {
            return Err("gateway_offline".into());
        }
        let method_w = wide(method);
        let path_w = wide(path);
        let call = Handle(WinHttpOpenRequest(
            connection.0,
            method_w.as_ptr(),
            path_w.as_ptr(),
            null(),
            null(),
            null(),
            if secure { WINHTTP_FLAG_SECURE } else { 0 },
        ));
        if call.0.is_null() {
            return Err("gateway_offline".into());
        }
        let disable: u32 = WINHTTP_DISABLE_REDIRECTS;
        if WinHttpSetOption(
            call.0,
            WINHTTP_OPTION_DISABLE_FEATURE,
            &disable as *const u32 as *const c_void,
            4,
        ) == 0
        {
            return Err("gateway_offline".into());
        }
        let header_w = wide(&headers);
        if WinHttpSendRequest(
            call.0,
            header_w.as_ptr(),
            (header_w.len() - 1) as u32,
            payload.as_ptr() as *const c_void,
            payload.len() as u32,
            payload.len() as u32,
            0,
        ) == 0
            || WinHttpReceiveResponse(call.0, null_mut()) == 0
        {
            return Err("gateway_offline".into());
        }
        let mut status: u32 = 0;
        let mut status_size = 4u32;
        if WinHttpQueryHeaders(
            call.0,
            WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
            null(),
            &mut status as *mut u32 as *mut c_void,
            &mut status_size,
            null_mut(),
        ) == 0
        {
            return Err("gateway_offline".into());
        }
        let mut output = Vec::new();
        loop {
            let mut buffer = [0u8; 8192];
            let mut count = 0u32;
            if WinHttpReadData(
                call.0,
                buffer.as_mut_ptr() as *mut c_void,
                buffer.len() as u32,
                &mut count,
            ) == 0
            {
                return Err("gateway_offline".into());
            }
            if count == 0 {
                break;
            }
            if output.len() + count as usize > MAX_RESPONSE {
                return Err("gateway_response_too_large".into());
            }
            output.extend_from_slice(&buffer[..count as usize]);
        }
        if !(200..300).contains(&status) {
            return Err(match status {
                401 => "gateway_auth",
                404 => "gateway_not_found",
                429 | 503 => "gateway_retry",
                _ => "gateway_error",
            }
            .into());
        }
        serde_json::from_slice(&output).map_err(|_| "gateway_response".into())
    }
}

pub(crate) fn existing_device_works() -> Result<(), String> {
    let cred = credential()?.ok_or("gateway_unpaired")?;
    let id = cred
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or("credential_store")?;
    let secret = cred
        .get("deviceSecret")
        .and_then(Value::as_str)
        .ok_or("credential_store")?;
    raw_request(
        "GET",
        "/v1/open-finance/connections",
        &json!({}),
        Some(&format!("{id}.{secret}")),
    )?;
    Ok(())
}

pub(crate) fn save_device_response(response: &Value) -> Result<(), String> {
    let id = response
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or("gateway_response")?;
    let secret = response
        .get("deviceSecret")
        .and_then(Value::as_str)
        .ok_or("gateway_response")?;
    if id.len() != 36 || secret.len() < 40 {
        return Err("gateway_response".into());
    }
    save_credential(response)
}

#[tauri::command]
pub fn finance_gateway_configuration() -> Result<Value, String> {
    let ready = super::finance_gateway_runtime::ensure_ready().is_ok();
    Ok(
        json!({ "configured": endpoint().is_ok(), "paired": ready && credential()?.is_some(), "available": ready, "mode": if super::finance_gateway_runtime::managed_build() { "personal" } else { "external" } }),
    )
}
#[tauri::command]
pub fn finance_gateway_pair(code: String) -> Result<Value, String> {
    if code.len() < 20 || code.len() > 256 {
        return Err("pair_code_invalid".into());
    }
    super::finance_gateway_runtime::ensure_ready()?;
    let response = raw_request("POST", "/v1/device/pair", &json!({"code":code}), None)?;
    let id = response
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or("gateway_response")?;
    let secret = response
        .get("deviceSecret")
        .and_then(Value::as_str)
        .ok_or("gateway_response")?;
    if id.len() != 36 || secret.len() < 40 {
        return Err("gateway_response".into());
    }
    save_device_response(&response)?;
    Ok(json!({ "deviceId": id }))
}
#[tauri::command]
pub fn finance_gateway_unpair() -> Result<(), String> {
    remove_credential()
}
#[tauri::command]
pub fn finance_gateway_request(
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    super::finance_gateway_runtime::ensure_ready()?;
    if !path.starts_with("/v1/open-finance/") {
        return Err("invalid_request".into());
    }
    let cred = credential()?.ok_or("gateway_unpaired")?;
    let id = cred
        .get("deviceId")
        .and_then(Value::as_str)
        .ok_or("credential_store")?;
    let secret = cred
        .get("deviceSecret")
        .and_then(Value::as_str)
        .ok_or("credential_store")?;
    raw_request(
        &method,
        &path,
        &body.unwrap_or_else(|| json!({})),
        Some(&format!("{id}.{secret}")),
    )
}
