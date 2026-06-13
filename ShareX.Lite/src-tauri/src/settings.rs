use crate::AppResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub save_directory: String,
    pub filename_pattern: String,
    pub image_format: ImageFormat,
    pub after_capture: AfterCaptureSettings,
    pub upload_targets: Vec<UploadTargetSettings>,
    pub shortcuts: ShortcutSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageFormat {
    Png,
    Jpeg,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AfterCaptureSettings {
    pub copy_image: bool,
    pub save_file: bool,
    pub upload: bool,
    pub open_after_capture: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadTargetSettings {
    pub id: String,
    pub name: String,
    pub kind: UploadTargetKind,
    pub enabled: bool,
    pub endpoint: Option<String>,
    pub method: Option<String>,
    pub directory: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UploadTargetKind {
    LocalFolder,
    CustomHttp,
    S3Compatible,
    Ftp,
    Sftp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutSettings {
    pub capture_all: String,
    pub capture_region: String,
    pub upload_clipboard: String,
    pub open_main_window: String,
}

pub struct SettingsStore {
    path: PathBuf,
    cache: Mutex<Option<AppSettings>>,
}

impl SettingsStore {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let dir = app.path().app_config_dir()?;
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            path: dir.join("settings.json"),
            cache: Mutex::new(None),
        })
    }

    pub async fn load(&self) -> AppResult<AppSettings> {
        let mut cache = self.cache.lock().await;
        if let Some(settings) = cache.clone() {
            return Ok(settings);
        }

        if !self.path.exists() {
            let settings = AppSettings::default();
            self.save_inner(&settings).await?;
            *cache = Some(settings.clone());
            return Ok(settings);
        }

        let content = tokio::fs::read_to_string(&self.path).await?;
        let settings: AppSettings = serde_json::from_str(&content)?;
        *cache = Some(settings.clone());
        Ok(settings)
    }

    pub async fn save(&self, settings: &AppSettings) -> AppResult<()> {
        self.save_inner(settings).await?;
        *self.cache.lock().await = Some(settings.clone());
        Ok(())
    }

    async fn save_inner(&self, settings: &AppSettings) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let content = serde_json::to_string_pretty(settings)?;
        tokio::fs::write(&self.path, content).await?;
        Ok(())
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        let pictures = default_pictures_dir();
        let save_directory = pictures.join("ShareX Lite");

        Self {
            save_directory: save_directory.to_string_lossy().to_string(),
            filename_pattern: "Screenshot-%Y-%m-%d-%H%M%S".to_string(),
            image_format: ImageFormat::Png,
            after_capture: AfterCaptureSettings {
                copy_image: true,
                save_file: true,
                upload: false,
                open_after_capture: false,
            },
            upload_targets: vec![
                UploadTargetSettings {
                    id: "local-folder".to_string(),
                    name: "Local folder".to_string(),
                    kind: UploadTargetKind::LocalFolder,
                    enabled: true,
                    endpoint: None,
                    method: None,
                    directory: None,
                },
                UploadTargetSettings {
                    id: "custom-http".to_string(),
                    name: "Custom HTTP".to_string(),
                    kind: UploadTargetKind::CustomHttp,
                    enabled: false,
                    endpoint: Some("https://example.com/upload".to_string()),
                    method: Some("POST".to_string()),
                    directory: None,
                },
            ],
            shortcuts: ShortcutSettings {
                capture_all: "CommandOrControl+Shift+1".to_string(),
                capture_region: "CommandOrControl+Shift+2".to_string(),
                upload_clipboard: "CommandOrControl+Shift+U".to_string(),
                open_main_window: "CommandOrControl+Shift+X".to_string(),
            },
        }
    }
}

fn default_pictures_dir() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home).join("Pictures");
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        return PathBuf::from(profile).join("Pictures");
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}
