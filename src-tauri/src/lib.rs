#[cfg(target_os = "windows")]
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};
mod attachments;
mod backup;
mod export;
#[cfg(target_os = "windows")]
mod finance_gateway;
#[cfg(target_os = "windows")]
mod finance_gateway_runtime;
#[cfg(target_os = "windows")]
mod google_calendar;
mod windows;

pub fn run() {
    let mut autostart = tauri_plugin_autostart::Builder::new().arg("--rumo-autostart");
    if let Some(smoke_name) = option_env!("RUMO_AUTOSTART_NAME") {
        autostart = autostart.app_name(smoke_name);
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("rumo-tray-open", ());
        }))
        .plugin(autostart.build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            windows::setup(app)?;
            #[cfg(target_os = "windows")]
            finance_gateway_runtime::setup(app);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            windows::native_exit,
            backup::data_info,
            backup::create_backup,
            backup::inspect_backup,
            backup::restore_backup,
            backup::restart_after_restore,
            backup::check_integrity,
            backup::quick_health_check,
            backup::automatic_backup,
            backup::pre_migration_backup,
            backup::health_check,
            backup::set_backup_directory,
            backup::open_backup_directory,
            attachments::attachment_add,
            attachments::attachment_list,
            attachments::attachment_remove,
            attachments::attachment_check,
            attachments::attachment_stats,
            attachments::attachment_cleanup,
            attachments::attachment_open,
            export::export_write,
            finance_gateway::finance_gateway_configuration,
            finance_gateway::finance_gateway_pair,
            finance_gateway::finance_gateway_unpair,
            finance_gateway::finance_gateway_request,
            google_calendar::google_has_credential,
            google_calendar::google_connect,
            google_calendar::google_disconnect,
            google_calendar::google_calendar_request,
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:rumo.db",
                    vec![
                        Migration {
                            version: 1,
                            description: "foundation",
                            sql: include_str!("../migrations/0001_foundation.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 2,
                            description: "organization",
                            sql: include_str!("../migrations/0002_organization.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 3,
                            description: "workouts",
                            sql: include_str!("../migrations/0003_workouts.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 4,
                            description: "nutrition",
                            sql: include_str!("../migrations/0004_nutrition.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 5,
                            description: "nutrition_units",
                            sql: include_str!("../migrations/0005_nutrition_units.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 6,
                            description: "finance",
                            sql: include_str!("../migrations/0006_finance.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 7,
                            description: "finance_integrity",
                            sql: include_str!("../migrations/0007_finance_integrity.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 8,
                            description: "release",
                            sql: include_str!("../migrations/0008_release.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 9,
                            description: "body_progress",
                            sql: include_str!("../migrations/0009_body_progress.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 10,
                            description: "planning_energy",
                            sql: include_str!("../migrations/0010_planning_energy.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 11,
                            description: "activity_overlap",
                            sql: include_str!("../migrations/0011_activity_overlap.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 12,
                            description: "exercise_library",
                            sql: include_str!("../migrations/0012_exercise_library.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 13,
                            description: "continuity",
                            sql: include_str!("../migrations/0013_continuity.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 14,
                            description: "objectives_timeline",
                            sql: include_str!("../migrations/0014_objectives_timeline.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 15,
                            description: "daily_planner",
                            sql: include_str!("../migrations/0015_daily_planner.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 16,
                            description: "focus_occurrence",
                            sql: include_str!("../migrations/0016_focus_occurrence.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 17,
                            description: "automations_recurrence",
                            sql: include_str!("../migrations/0017_automations_recurrence.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 18,
                            description: "objective_milestones_reviews",
                            sql: include_str!(
                                "../migrations/0018_objective_milestones_reviews.sql"
                            ),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 19,
                            description: "automation_milestone_events",
                            sql: include_str!("../migrations/0019_automation_milestone_events.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 20,
                            description: "attachments",
                            sql: include_str!("../migrations/0020_attachments.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 21,
                            description: "data_imports",
                            sql: include_str!("../migrations/0021_data_imports.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 22,
                            description: "external_calendar_filters",
                            sql: include_str!("../migrations/0022_external_calendar_filters.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 23,
                            description: "import_conflicts",
                            sql: include_str!("../migrations/0023_import_conflicts.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 24,
                            description: "finance_csv_mapping",
                            sql: include_str!("../migrations/0024_finance_csv_mapping.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 25,
                            description: "google_calendar",
                            sql: include_str!("../migrations/0025_google_calendar.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 26,
                            description: "google_calendar_sources",
                            sql: include_str!("../migrations/0026_google_calendar_sources.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 27,
                            description: "google_calendar_bootstrap",
                            sql: include_str!("../migrations/0027_google_calendar_bootstrap.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 28,
                            description: "financial_connections",
                            sql: include_str!("../migrations/0028_financial_connections.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 29,
                            description: "planning_foundation",
                            sql: include_str!("../migrations/0029_planning_foundation.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 30,
                            description: "activity_home_reviews",
                            sql: include_str!("../migrations/0030_activity_home_reviews.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 31,
                            description: "productivity_intelligence",
                            sql: include_str!("../migrations/0031_productivity_intelligence.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 32,
                            description: "advanced_hardening",
                            sql: include_str!("../migrations/0032_advanced_hardening.sql"),
                            kind: MigrationKind::Up,
                        },
                        Migration {
                            version: 33,
                            description: "objectives_projects_safety",
                            sql: include_str!("../migrations/0033_objectives_projects_safety.sql"),
                            kind: MigrationKind::Up,
                        },
                    ],
                )
                .build(),
        )
        .build(tauri::generate_context!())
        .expect("Não foi possível iniciar o RUMO")
        .run(|app, event| {
            #[cfg(target_os = "windows")]
            match event {
                tauri::RunEvent::WindowEvent {
                    label,
                    event: tauri::WindowEvent::CloseRequested { api, .. },
                    ..
                } if label == "main" => {
                    // The window's X only hides it. Explicit app.exit() from Sair shuts down the gateway.
                    api.prevent_close();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                        let _ = app.emit("rumo-tray-hidden", ());
                    }
                }
                tauri::RunEvent::Exit => finance_gateway_runtime::shutdown(),
                _ => {}
            }
            #[cfg(not(target_os = "windows"))]
            let _ = (app, event);
        });
}
