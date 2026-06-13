mod capture;
mod history;
mod processing;
mod recording;
mod settings;
mod upload;

use capture::{capture_active_monitor, capture_all_monitors, capture_monitor};
use history::{HistoryItem, HistoryStore};
use processing::{ProcessImageRequest, process_image};
use recording::{RecordingRequest, record_screen};
use settings::{AppSettings, SettingsStore};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use upload::{UploadRequest, UploadResult, upload_file};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Serde(#[from] serde_json::Error),
    #[error(transparent)]
    Image(#[from] image::ImageError),
    #[error(transparent)]
    Tauri(#[from] tauri::Error),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(value: anyhow::Error) -> Self {
        AppError::Message(value.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[tauri::command]
async fn get_settings(store: tauri::State<'_, SettingsStore>) -> AppResult<AppSettings> {
    store.load().await
}

#[tauri::command]
async fn save_settings(
    settings: AppSettings,
    store: tauri::State<'_, SettingsStore>,
) -> AppResult<AppSettings> {
    store.save(&settings).await?;
    Ok(settings)
}

#[tauri::command]
async fn list_history(store: tauri::State<'_, HistoryStore>) -> AppResult<Vec<HistoryItem>> {
    store.load().await
}

#[tauri::command]
async fn clear_history(store: tauri::State<'_, HistoryStore>) -> AppResult<()> {
    store.clear().await
}

#[tauri::command]
async fn capture_all(
    app: AppHandle,
    settings: tauri::State<'_, SettingsStore>,
    history: tauri::State<'_, HistoryStore>,
) -> AppResult<HistoryItem> {
    let settings = settings.load().await?;
    let item = capture_all_monitors(&settings).await?;
    history.append(&item).await?;
    emit_history(&app, &item);
    Ok(item)
}

#[tauri::command]
async fn capture_monitor_command(
    app: AppHandle,
    index: usize,
    settings: tauri::State<'_, SettingsStore>,
    history: tauri::State<'_, HistoryStore>,
) -> AppResult<HistoryItem> {
    let settings = settings.load().await?;
    let item = capture_monitor(index, &settings).await?;
    history.append(&item).await?;
    emit_history(&app, &item);
    Ok(item)
}

#[tauri::command]
async fn capture_active_monitor_command(
    app: AppHandle,
    settings: tauri::State<'_, SettingsStore>,
    history: tauri::State<'_, HistoryStore>,
) -> AppResult<HistoryItem> {
    let settings = settings.load().await?;
    let item = capture_active_monitor(&settings).await?;
    history.append(&item).await?;
    emit_history(&app, &item);
    Ok(item)
}

#[tauri::command]
async fn record_screen_command(
    app: AppHandle,
    request: RecordingRequest,
    settings: tauri::State<'_, SettingsStore>,
    history: tauri::State<'_, HistoryStore>,
) -> AppResult<HistoryItem> {
    let settings = settings.load().await?;
    let item = record_screen(request, &settings).await?;
    history.append(&item).await?;
    emit_history(&app, &item);
    Ok(item)
}

#[tauri::command]
async fn process_image_command(
    app: AppHandle,
    request: ProcessImageRequest,
    settings: tauri::State<'_, SettingsStore>,
    history: tauri::State<'_, HistoryStore>,
) -> AppResult<HistoryItem> {
    let settings = settings.load().await?;
    let item = process_image(request, &settings).await?;
    history.append(&item).await?;
    emit_history(&app, &item);
    Ok(item)
}

#[tauri::command]
async fn upload_history_item(
    app: AppHandle,
    id: String,
    request: UploadRequest,
    history: tauri::State<'_, HistoryStore>,
) -> AppResult<UploadResult> {
    let mut items = history.load().await?;
    let item = items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::Message("未找到历史记录项。".to_string()))?;
    item.status = "uploading".to_string();
    history.save_all(&items).await?;

    let target = items
        .iter()
        .find(|item| item.id == id)
        .map(|item| item.path.clone())
        .ok_or_else(|| AppError::Message("未找到历史记录项。".to_string()))?;

    let result = upload_file(&target, request).await;
    let mut items = history.load().await?;
    if let Some(item) = items.iter_mut().find(|item| item.id == id) {
        match &result {
            Ok(result) => {
                item.status = "uploaded".to_string();
                item.url = result.url.clone();
            }
            Err(error) => {
                item.status = "failed".to_string();
                item.error = Some(error.to_string());
            }
        }
    }
    history.save_all(&items).await?;
    if let Some(item) = items.iter().find(|item| item.id == id) {
        emit_history(&app, item);
    }
    result
}

#[tauri::command]
async fn reveal_file(path: String) -> AppResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(path)
        .map_err(|error| AppError::Message(error.to_string()))
}

#[tauri::command]
async fn open_screenshots_folder(settings: tauri::State<'_, SettingsStore>) -> AppResult<()> {
    let folder = settings.load().await?.save_directory;
    tauri_plugin_opener::open_path(folder, None::<String>)
        .map_err(|error| AppError::Message(error.to_string()))
}

fn emit_history(app: &AppHandle, item: &HistoryItem) {
    let _ = app.emit("history-updated", item);
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示 ShareX Lite", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "截取所有显示器", true, None::<&str>)?;
    let folder = MenuItem::with_id(app, "folder", "打开截图文件夹", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &capture, &folder, &quit])?;

    TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "capture" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = handle.emit("tray-capture-requested", ());
                });
            }
            "folder" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(settings) = handle.try_state::<SettingsStore>() {
                        if let Ok(settings) = settings.load().await {
                            let _ = tauri_plugin_opener::open_path(
                                settings.save_directory,
                                None::<String>,
                            );
                        }
                    }
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let settings_store = SettingsStore::new(app.handle())?;
            let history_store = HistoryStore::new(app.handle())?;
            app.manage(settings_store);
            app.manage(history_store);
            setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_history,
            clear_history,
            capture_all,
            capture_monitor_command,
            capture_active_monitor_command,
            record_screen_command,
            process_image_command,
            upload_history_item,
            reveal_file,
            open_screenshots_folder
        ])
        .run(tauri::generate_context!())
        .expect("运行 ShareX Lite 时出错");
}
