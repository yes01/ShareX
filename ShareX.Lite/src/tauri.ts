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

export interface RecordingSettings {
  filenamePattern: string;
  durationSeconds: number;
  fps: number;
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
  recording: RecordingSettings;
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

export interface RecordingRequest {
  mode: "Screen" | "Gif";
  durationSeconds: number;
  fps: number;
}

export interface ProcessImageRequest {
  sourcePath: string;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  resizeWidth?: number | null;
  grayscale: boolean;
  border?: {
    size: number;
    color: string;
  } | null;
  watermark?: {
    text: string;
    position: "TopLeft" | "TopRight" | "BottomLeft" | "BottomRight";
  } | null;
}

const isTauriRuntime = "__TAURI_INTERNALS__" in window;
const mockSettings: AppSettings = {
  saveDirectory: "~/Pictures/ShareX Lite",
  filenamePattern: "截图-%Y-%m-%d-%H%M%S",
  imageFormat: "Png",
  afterCapture: {
    copyImage: true,
    saveFile: true,
    upload: false,
    openAfterCapture: false
  },
  recording: {
    filenamePattern: "录屏-%Y-%m-%d-%H%M%S",
    durationSeconds: 10,
    fps: 12
  },
  uploadTargets: [
    {
      id: "local-folder",
      name: "本地文件夹",
      kind: "LocalFolder",
      enabled: true,
      directory: ""
    },
    {
      id: "custom-http",
      name: "自定义 HTTP",
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
    title: "所有显示器",
    path: "~/Pictures/ShareX Lite/截图-preview.png",
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
  recordScreen: (request: RecordingRequest) => invoke<HistoryItem>("record_screen_command", { request }),
  processImage: (request: ProcessImageRequest) => invoke<HistoryItem>("process_image_command", { request }),
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
  captureAll: async () => createMockCapture("所有显示器"),
  captureMonitor: async (index: number) => createMockCapture(`显示器 ${index + 1}`),
  captureActiveMonitor: async () => createMockCapture("显示器 1"),
  recordScreen: async (request: RecordingRequest) => createMockRecording(request.mode),
  processImage: async (request: ProcessImageRequest) => createMockProcessedImage(request.sourcePath),
  uploadHistoryItem: async (id: string) => {
    mockHistory = mockHistory.map((item) =>
      item.id === id ? { ...item, status: "uploaded", url: "https://example.com/screenshot-preview.png" } : item
    );
    return {
      url: "https://example.com/screenshot-preview.png",
      destination: "浏览器预览",
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
    path: `~/Pictures/ShareX Lite/截图-${Date.now()}.png`,
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

function createMockRecording(mode: RecordingRequest["mode"]) {
  const item: HistoryItem = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: mode === "Gif" ? "gif" : "video",
    title: mode === "Gif" ? "GIF 录制" : "录屏",
    path: `~/Pictures/ShareX Lite/录屏-${Date.now()}.${mode === "Gif" ? "gif" : "mp4"}`,
    url: null,
    status: "saved",
    width: 0,
    height: 0,
    sizeBytes: mode === "Gif" ? 2800000 : 9600000,
    error: null
  };
  mockHistory = [item, ...mockHistory];
  return item;
}

function createMockProcessedImage(sourcePath: string) {
  const item: HistoryItem = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: "image",
    title: "截图后处理",
    path: sourcePath.replace(/(\.[^.]+)?$/, "-processed.png"),
    url: null,
    status: "saved",
    width: 1600,
    height: 1000,
    sizeBytes: 720000,
    error: null
  };
  mockHistory = [item, ...mockHistory];
  return item;
}

export const api = isTauriRuntime ? tauriApi : browserPreviewApi;
