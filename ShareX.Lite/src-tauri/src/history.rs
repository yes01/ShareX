use crate::AppResult;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub created_at: DateTime<Utc>,
    pub kind: String,
    pub title: String,
    pub path: String,
    pub url: Option<String>,
    pub status: String,
    pub width: u32,
    pub height: u32,
    pub size_bytes: u64,
    pub error: Option<String>,
}

pub struct HistoryStore {
    path: PathBuf,
    lock: Mutex<()>,
}

impl HistoryStore {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let dir = app.path().app_data_dir()?;
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            path: dir.join("history.json"),
            lock: Mutex::new(()),
        })
    }

    pub async fn load(&self) -> AppResult<Vec<HistoryItem>> {
        let _guard = self.lock.lock().await;
        self.load_unlocked().await
    }

    pub async fn append(&self, item: &HistoryItem) -> AppResult<()> {
        let _guard = self.lock.lock().await;
        let mut items = self.load_unlocked().await?;
        items.insert(0, item.clone());
        items.truncate(500);
        self.save_unlocked(&items).await
    }

    pub async fn save_all(&self, items: &[HistoryItem]) -> AppResult<()> {
        let _guard = self.lock.lock().await;
        self.save_unlocked(items).await
    }

    pub async fn clear(&self) -> AppResult<()> {
        let _guard = self.lock.lock().await;
        self.save_unlocked(&[]).await
    }

    async fn load_unlocked(&self) -> AppResult<Vec<HistoryItem>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let content = tokio::fs::read_to_string(&self.path).await?;
        Ok(serde_json::from_str(&content)?)
    }

    async fn save_unlocked(&self, items: &[HistoryItem]) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let content = serde_json::to_string_pretty(items)?;
        tokio::fs::write(&self.path, content).await?;
        Ok(())
    }
}
