#![cfg_attr(target_os = "windows", allow(linker_messages))]

pub mod commands;
pub mod database;
pub mod knowledge;
pub mod state;

#[path = "../model_resource_manifest.rs"]
pub(crate) mod model_resource_manifest;

use commands::relations::{
    enqueue_note_indexing, get_related_notes, get_relation_status, pause_relation_indexing,
    rebuild_knowledge_relations, reject_automatic_relation, remove_note_from_knowledge_index,
    restore_automatic_relation, resume_relation_indexing, sync_knowledge_notes,
};
use state::build_app_state;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(target_os = "windows")]
            if let Some(main_window) = app.get_webview_window("main") {
                // O ícone do bundle identifica o executável e os atalhos, mas
                // o Windows usa o ícone da janela para a barra de tarefas.
                // Defini-lo aqui evita o fallback visual do Tauri/WebView2.
                let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
                main_window.set_icon(icon)?;
            }
            let state = build_app_state(app.handle().clone())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sync_knowledge_notes,
            enqueue_note_indexing,
            get_related_notes,
            get_relation_status,
            rebuild_knowledge_relations,
            pause_relation_indexing,
            resume_relation_indexing,
            reject_automatic_relation,
            restore_automatic_relation,
            remove_note_from_knowledge_index,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<crate::state::AppState>()
                    .relation_service
                    .queue
                    .shutdown();
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}
