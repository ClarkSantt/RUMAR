use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager,
};

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("rumo-tray-open", ());
}

fn start_minimized(app: &App) -> bool {
    if !std::env::args().any(|arg| arg == "--rumo-autostart") {
        return false;
    }
    let Ok(dir) = app.path().app_config_dir() else {
        return false;
    };
    let Ok(db) = rusqlite::Connection::open_with_flags(
        dir.join("rumo.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return false;
    };
    db.query_row(
        "SELECT value FROM settings WHERE key='windows_start_minimized'",
        [],
        |row| row.get::<_, String>(0),
    )
    .is_ok_and(|value| value == "1")
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open", "Abrir RUMAR", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick Add", true, None::<&str>)?;
    let focus = MenuItem::with_id(app, "focus", "Abrir Focus", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "focus-pause", "Pausar Focus", true, None::<&str>)?;
    let resume = MenuItem::with_id(app, "focus-resume", "Retomar Focus", true, None::<&str>)?;
    let finish = MenuItem::with_id(app, "focus-finish", "Finalizar Focus", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sincronizar Google Agenda", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open, &quick, &focus, &pause, &resume, &finish, &sync, &quit,
        ],
    )?;
    let mut tray = TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app),
            "quick" => {
                let _ = app.emit("rumo-tray-command", "quick");
            }
            "focus" => {
                show_main(app);
                let _ = app.emit("rumo-tray-command", event.id().as_ref());
            }
            "focus-pause" | "focus-resume" | "focus-finish" | "sync" => {
                let _ = app.emit("rumo-tray-command", event.id().as_ref());
            }
            "quit" => {
                let _ = app.emit("rumo-tray-command", "quit");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    if start_minimized(app) {
        if let Some(window) = app.get_webview_window("main") {
            window.hide()?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn native_exit(app: AppHandle) {
    app.exit(0);
}
