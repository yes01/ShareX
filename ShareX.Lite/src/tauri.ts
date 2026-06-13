import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

export type ImageFormat = "Png" | "Jpeg";
export type UploadTargetKind = "LocalFolder" | "CustomHttp" | "S3Compatible" | "Ftp" | "Sftp";

export interface AfterCaptureSettings {
  copyImage: boolean;
  saveFile: boolean;
  upload: boolean;
  openAfterCapture: boolean;
}

export interface UploadTargetSettings {
  id: string;
  name: string;
  kind: UploadTargetKind;
  enabled: boolean;
  endpoint?: string | null;
  method?: string | null;
  directory?: string | null;
}

export interface ShortcutSettings {
  captureAll: string;
  captureRegion: string;
  uploadClipboard: string;
  openMainWindow: string;
}

export interface AppSettings {
  saveDirectory: string;
  filenamePattern: string;
  imageFormat: ImageFormat;
  afterCapture: AfterCaptureSettings;
  uploadTargets: UploadTargetSettings[];
  shortcuts: ShortcutSettings;
}

export interface HistoryItem {
  id: string;
  createdAt: string;
  kind: string;
  title: string;
  path: string;
  url?: string | null;
  status: string;
  width: number;
  height: number;
  sizeBytes: number;
  error?: string | null;
}

export interface UploadRequest {
  targetId: string;
  kind: UploadTargetKind;
  endpoint?: string | null;
  method?: string | null;
  directory?: string | null;
}

export interface UploadResult {
  url?: string | null;
  destination: string;
  statusCode?: number | null;
}

const isTauriRuntime = "__TAURI_INTERNALS__" in window;
const mockSettings: AppSettings = {
  saveDirectory: "~/Pictures/ShareX Lite",
  filenamePattern: "Screenshot-%Y-%m-%d-%H%M%S",
  imageFormat: "Png",
  afterCapture: {
    copyImage: true,
    saveFile: true,
    upload: false,
    openAfterCapture: false
  },
  uploadTargets: [
    {
      id: "local-folder",
      name: "Local folder",
      kind: "LocalFolder",
      enabled: true,
      directory: ""
    },
    {
      id: "custom-http",
      name: "Custom HTTP",
      kind: "CustomHttp",
      enabled: false,
      endpoint: "https://example.com/upload",
      method: "POST"
    }
  ],
  shortcuts: {
    captureAll: "CommandOrControl+Shift+1",
    captureRegion: "CommandOrControl+Shift+2",
    uploadClipboard: "CommandOrControl+Shift+U",
    openMainWindow: "CommandOrControl+Shift+X"
  }
};

let mockHistory: HistoryItem[] = [
  {
    id: "preview-1",
    createdAt: new Date().toISOString(),
    kind: "screenshot",
    title: "All monitors",
    path: "~/Pictures/ShareX Lite/Screenshot-preview.png",
    url: null,
    status: "saved",
    width: 3024,
    height: 1964,
    sizeBytes: 842312,
    error: null
  }
];

const tauriApi = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
  listHistory: () => invoke<HistoryItem[]>("list_history"),
  clearHistory: () => invoke<void>("clear_history"),
  captureAll: () => invoke<HistoryItem>("capture_all"),
  captureMonitor: (index: number) => invoke<HistoryItem>("capture_monitor_command", { index }),
  captureActiveMonitor: () => invoke<HistoryItem>("capture_active_monitor_command"),
  uploadHistoryItem: (id: string, request: UploadRequest) =>
    invoke<UploadResult>("upload_history_item", { id, request }),
  revealFile: (path: string) => invoke<void>("reveal_file", { path }),
  openScreenshotsFolder: () => invoke<void>("open_screenshots_folder"),
  onHistoryUpdated: (handler: (item: HistoryItem) => void) =>
    listen<HistoryItem>("history-updated", (event) => handler(event.payload)),
  onTrayCaptureRequested: (handler: () => void) => listen("tray-capture-requested", handler),
  copyText: (value: string) => writeText(value),
  notify: async (title: string, body: string) => {
    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    if (granted) {
      sendNotification({ title, body });
    }
  }
};

const browserPreviewApi = {
  getSettings: async () => mockSettings,
  saveSettings: async (settings: AppSettings) => {
    Object.assign(mockSettings, settings);
    return settings;
  },
  listHistory: async () => mockHistory,
  clearHistory: async () => {
    mockHistory = [];
  },
  captureAll: async () => createMockCapture("All monitors"),
  captureMonitor: async (index: number) => createMockCapture(`Monitor ${index + 1}`),
  captureActiveMonitor: async () => createMockCapture("Monitor 1"),
  uploadHistoryItem: async (id: string) => {
    mockHistory = mockHistory.map((item) =>
      item.id === id ? { ...item, status: "uploaded", url: "https://example.com/screenshot-preview.png" } : item
    );
    return {
      url: "https://example.com/screenshot-preview.png",
      destination: "Browser preview",
      statusCode: 200
    };
  },
  revealFile: async () => undefined,
  openScreenshotsFolder: async () => undefined,
  onHistoryUpdated: async () => () => undefined,
  onTrayCaptureRequested: async () => () => undefined,
  copyText: async (value: string) => navigator.clipboard?.writeText(value),
  notify: async () => undefined
};

function createMockCapture(title: string) {
  const item: HistoryItem = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: "screenshot",
    title,
    path: `~/Pictures/ShareX Lite/Screenshot-${Date.now()}.png`,
    url: null,
    status: "saved",
    width: 3024,
    height: 1964,
    sizeBytes: 860000,
    error: null
  };
  mockHistory = [item, ...mockHistory];
  return item;
}

export const api = isTauriRuntime ? tauriApi : browserPreviewApi;
