import {
  ArrowClockwise,
  Clipboard,
  Copy,
  Crop,
  FolderOpen,
  GearSix,
  Globe,
  HardDrives,
  ImageSquare,
  Monitor,
  PaperPlaneTilt,
  Record,
  Selection,
  Sidebar,
  Sparkle,
  Trash,
  UploadSimple,
  VideoCamera
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  AppSettings,
  HistoryItem,
  ProcessImageRequest,
  RecordingRequest,
  UploadTargetSettings
} from "./tauri";

type View = "capture" | "record" | "process" | "history" | "upload" | "settings";
type CaptureMode = "all" | "active" | "region";
type WatermarkPosition = NonNullable<ProcessImageRequest["watermark"]>["position"];

const formatter = new Intl.DateTimeFormat("zh-CN", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function App() {
  const [view, setView] = useState<View>("capture");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<HistoryItem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("就绪");
  const [error, setError] = useState<string | null>(null);

  const enabledTargets = useMemo(
    () => settings?.uploadTargets.filter((target) => target.enabled) ?? [],
    [settings]
  );
  const defaultTarget = enabledTargets[0] ?? null;
  const latest = history[0] ?? null;
  const latestImage = useMemo(
    () => selectedImage ?? history.find((item) => item.kind === "screenshot" || item.kind === "image") ?? null,
    [history, selectedImage]
  );

  const refresh = useCallback(async () => {
    const [nextSettings, nextHistory] = await Promise.all([api.getSettings(), api.listHistory()]);
    setSettings(nextSettings);
    setHistory(nextHistory);
  }, []);

  useEffect(() => {
    refresh().catch((reason) => setError(String(reason)));
  }, [refresh]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    api.onHistoryUpdated((item) => {
      setHistory((items) => [item, ...items.filter((current) => current.id !== item.id)]);
      setMessage(`${displayHistoryTitle(item.title)}已保存`);
    }).then((unsub) => unsubs.push(unsub));
    api.onTrayCaptureRequested(() => {
      void runCapture("all");
    }).then((unsub) => unsubs.push(unsub));
    return () => unsubs.forEach((unsub) => unsub());
  }, []);

  async function runCapture(mode: CaptureMode) {
    setBusy(mode);
    setError(null);
    try {
      if (mode === "region") {
        throw new Error("区域截图界面已预留，将在下一轮平台覆盖层实现。");
      }
      const item = mode === "active" ? await api.captureActiveMonitor() : await api.captureAll();
      setHistory((items) => [item, ...items.filter((current) => current.id !== item.id)]);
      setSelectedImage(item);
      setMessage(`${displayHistoryTitle(item.title)}已保存到 ${shortPath(item.path)}`);
      await api.notify("截图已保存", displayHistoryTitle(item.title));
      if (settings?.afterCapture.upload && defaultTarget) {
        await runUpload(item, defaultTarget);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runRecording(request: RecordingRequest) {
    setBusy(request.mode === "Gif" ? "record-gif" : "record-screen");
    setError(null);
    try {
      const item = await api.recordScreen(request);
      setHistory((items) => [item, ...items.filter((current) => current.id !== item.id)]);
      setMessage(`${displayHistoryTitle(item.title)}已保存到 ${shortPath(item.path)}`);
      await api.notify("录制已完成", displayHistoryTitle(item.title));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runProcessImage(request: ProcessImageRequest) {
    setBusy("process-image");
    setError(null);
    try {
      const item = await api.processImage(request);
      setHistory((items) => [item, ...items.filter((current) => current.id !== item.id)]);
      setSelectedImage(item);
      setMessage(`已生成处理后的图片：${shortPath(item.path)}`);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function runUpload(item: HistoryItem, target: UploadTargetSettings) {
    setBusy(`upload-${item.id}`);
    setError(null);
    try {
      const result = await api.uploadHistoryItem(item.id, {
        targetId: target.id,
        kind: target.kind,
        endpoint: target.endpoint,
        method: target.method,
        directory: target.directory
      });
      if (result.url) {
        await api.copyText(result.url);
      }
      setMessage(result.url ? "已上传并复制链接" : `已上传到${displayTargetName(target)}`);
      await refresh();
    } catch (reason) {
      setError(String(reason));
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(next: AppSettings) {
    setSettings(next);
    await api.saveSettings(next);
    setMessage("设置已保存");
  }

  function openProcessor(item: HistoryItem) {
    setSelectedImage(item);
    setView("process");
  }

  return (
    <main className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="brandMark">SX</div>
          <div>
            <strong>ShareX Lite</strong>
            <span>截图、录屏与上传</span>
          </div>
        </div>

        <nav className="nav">
          <NavButton active={view === "capture"} icon={<Monitor />} label="截图" onClick={() => setView("capture")} />
          <NavButton active={view === "record"} icon={<VideoCamera />} label="录屏" onClick={() => setView("record")} />
          <NavButton active={view === "process"} icon={<Crop />} label="处理" onClick={() => setView("process")} />
          <NavButton active={view === "history"} icon={<ImageSquare />} label="历史" onClick={() => setView("history")} />
          <NavButton active={view === "upload"} icon={<UploadSimple />} label="上传" onClick={() => setView("upload")} />
          <NavButton active={view === "settings"} icon={<GearSix />} label="设置" onClick={() => setView("settings")} />
        </nav>

        <div className="railStatus">
          <span>状态</span>
          <strong>{message}</strong>
          {error ? <p>{error}</p> : null}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{titleForView(view)}</h1>
            <p>{subtitleForView(view)}</p>
          </div>
          <div className="topActions">
            <button className="secondaryButton" onClick={() => api.openScreenshotsFolder()}>
              <FolderOpen weight="bold" />
              打开文件夹
            </button>
            <button className="primaryButton" disabled={busy !== null} onClick={() => runCapture("all")}>
              <Monitor weight="bold" />
              截图
            </button>
          </div>
        </header>

        {view === "capture" && (
          <CaptureView
            busy={busy}
            latest={latest}
            targets={enabledTargets}
            onCapture={runCapture}
            onUpload={runUpload}
            onProcess={openProcessor}
          />
        )}
        {view === "record" && settings && (
          <RecordingView
            busy={busy}
            settings={settings}
            onRecord={runRecording}
            onSave={saveSettings}
          />
        )}
        {view === "process" && (
          <ProcessView
            busy={busy}
            image={latestImage}
            onReveal={(path) => api.revealFile(path)}
            onProcess={runProcessImage}
          />
        )}
        {view === "history" && (
          <HistoryView
            busy={busy}
            history={history}
            targets={enabledTargets}
            onUpload={runUpload}
            onReveal={(path) => api.revealFile(path)}
            onCopy={(text) => api.copyText(text)}
            onProcess={openProcessor}
            onClear={async () => {
              await api.clearHistory();
              setHistory([]);
              setMessage("历史记录已清空");
            }}
          />
        )}
        {view === "upload" && settings && (
          <UploadView settings={settings} onSave={saveSettings} />
        )}
        {view === "settings" && settings && (
          <SettingsView settings={settings} onSave={saveSettings} />
        )}
      </section>
    </main>
  );
}

function CaptureView({
  busy,
  latest,
  targets,
  onCapture,
  onUpload,
  onProcess
}: {
  busy: string | null;
  latest: HistoryItem | null;
  targets: UploadTargetSettings[];
  onCapture: (mode: CaptureMode) => void;
  onUpload: (item: HistoryItem, target: UploadTargetSettings) => void;
  onProcess: (item: HistoryItem) => void;
}) {
  return (
    <div className="gridLayout">
      <section className="panel commandPanel">
        <ActionTile
          icon={<Monitor />}
          title="截取所有显示器"
          body="保存当前桌面并写入历史记录。"
          disabled={busy !== null}
          active={busy === "all"}
          onClick={() => onCapture("all")}
        />
        <ActionTile
          icon={<Sidebar />}
          title="截取当前显示器"
          body="使用主显示器完成当前版本截图。"
          disabled={busy !== null}
          active={busy === "active"}
          onClick={() => onCapture("active")}
        />
        <ActionTile
          icon={<Selection />}
          title="区域截图"
          body="已为平台覆盖层功能预留。"
          disabled={busy !== null}
          active={busy === "region"}
          onClick={() => onCapture("region")}
        />
      </section>

      <section className="panel latestPanel">
        <PanelHeader title="最近截图" action={latest ? displayDimensions(latest) : "暂无"} />
        {latest ? (
          <div className="latestMeta">
            <div>
              <strong>{displayHistoryTitle(latest.title)}</strong>
              <span>{shortPath(latest.path)}</span>
            </div>
            <div className="buttonRow">
              {(latest.kind === "screenshot" || latest.kind === "image") ? (
                <button className="secondaryButton" onClick={() => onProcess(latest)}>
                  <Crop weight="bold" />
                  处理
                </button>
              ) : null}
              {targets[0] ? (
                <button className="secondaryButton" onClick={() => onUpload(latest, targets[0])}>
                  <PaperPlaneTilt weight="bold" />
                  上传
                </button>
              ) : null}
              <button className="secondaryButton" onClick={() => api.revealFile(latest.path)}>
                <FolderOpen weight="bold" />
                显示文件
              </button>
            </div>
          </div>
        ) : (
          <EmptyState title="还没有截图" body="点击“截取所有显示器”创建第一条历史记录。" />
        )}
      </section>
    </div>
  );
}

function RecordingView({
  busy,
  settings,
  onRecord,
  onSave
}: {
  busy: string | null;
  settings: AppSettings;
  onRecord: (request: RecordingRequest) => void;
  onSave: (settings: AppSettings) => void;
}) {
  const recording = settings.recording;

  function updateRecording(patch: Partial<AppSettings["recording"]>) {
    onSave({ ...settings, recording: { ...settings.recording, ...patch } });
  }

  return (
    <div className="gridLayout">
      <section className="panel commandPanel">
        <ActionTile
          icon={<VideoCamera />}
          title="录制 MP4"
          body="使用系统录屏能力保存桌面视频。"
          disabled={busy !== null}
          active={busy === "record-screen"}
          onClick={() => onRecord({ mode: "Screen", durationSeconds: recording.durationSeconds, fps: recording.fps })}
        />
        <ActionTile
          icon={<Record />}
          title="录制 GIF"
          body="录制短片并通过 ffmpeg 转成 GIF。"
          disabled={busy !== null}
          active={busy === "record-gif"}
          onClick={() => onRecord({ mode: "Gif", durationSeconds: recording.durationSeconds, fps: recording.fps })}
        />
      </section>

      <section className="panel">
        <PanelHeader title="录制参数" action="低占用" />
        <LabeledNumber
          label="时长（秒）"
          min={1}
          max={600}
          value={recording.durationSeconds}
          onChange={(durationSeconds) => updateRecording({ durationSeconds })}
        />
        <LabeledNumber
          label="帧率"
          min={1}
          max={60}
          value={recording.fps}
          onChange={(fps) => updateRecording({ fps })}
        />
        <LabeledInput
          label="文件名模式"
          value={recording.filenamePattern}
          onChange={(filenamePattern) => updateRecording({ filenamePattern })}
        />
        <div className="noteBlock">
          macOS MP4 使用系统录屏；GIF 和 Windows 录屏需要系统已安装 ffmpeg。
        </div>
      </section>
    </div>
  );
}

function ProcessView({
  busy,
  image,
  onReveal,
  onProcess
}: {
  busy: string | null;
  image: HistoryItem | null;
  onReveal: (path: string) => void;
  onProcess: (request: ProcessImageRequest) => void;
}) {
  const [cropEnabled, setCropEnabled] = useState(false);
  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropWidth, setCropWidth] = useState(1200);
  const [cropHeight, setCropHeight] = useState(800);
  const [resizeWidth, setResizeWidth] = useState(0);
  const [grayscale, setGrayscale] = useState(false);
  const [borderSize, setBorderSize] = useState(0);
  const [borderColor, setBorderColor] = useState("#111827");
  const [watermarkText, setWatermarkText] = useState("");
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>("BottomRight");

  function submit() {
    if (!image) return;
    onProcess({
      sourcePath: image.path,
      crop: cropEnabled ? { x: cropX, y: cropY, width: cropWidth, height: cropHeight } : null,
      resizeWidth: resizeWidth > 0 ? resizeWidth : null,
      grayscale,
      border: borderSize > 0 ? { size: borderSize, color: borderColor } : null,
      watermark: watermarkText.trim() ? { text: watermarkText.trim(), position: watermarkPosition } : null
    });
  }

  if (!image) {
    return (
      <section className="panel">
        <EmptyState title="没有可处理图片" body="先完成一次截图，或者从历史记录里选择图片。" />
      </section>
    );
  }

  return (
    <div className="gridLayout processGrid">
      <section className="panel">
        <PanelHeader title="处理源" action={displayDimensions(image)} />
        <div className="latestMeta">
          <div>
            <strong>{displayHistoryTitle(image.title)}</strong>
            <span>{shortPath(image.path)}</span>
          </div>
          <div className="buttonRow">
            <button className="secondaryButton" onClick={() => onReveal(image.path)}>
              <FolderOpen weight="bold" />
              显示文件
            </button>
          </div>
        </div>
      </section>

      <section className="panel processPanel">
        <PanelHeader title="处理动作" action="另存为新文件" />
        <ToggleRow label="启用裁剪" checked={cropEnabled} onChange={setCropEnabled} />
        {cropEnabled ? (
          <div className="compactGrid">
            <LabeledNumber label="X" min={0} value={cropX} onChange={setCropX} />
            <LabeledNumber label="Y" min={0} value={cropY} onChange={setCropY} />
            <LabeledNumber label="宽" min={1} value={cropWidth} onChange={setCropWidth} />
            <LabeledNumber label="高" min={1} value={cropHeight} onChange={setCropHeight} />
          </div>
        ) : null}
        <LabeledNumber label="缩放宽度（0 为不缩放）" min={0} value={resizeWidth} onChange={setResizeWidth} />
        <ToggleRow label="灰度" checked={grayscale} onChange={setGrayscale} />
        <div className="compactGrid">
          <LabeledNumber label="边框" min={0} value={borderSize} onChange={setBorderSize} />
          <LabeledInput label="颜色" value={borderColor} onChange={setBorderColor} />
        </div>
        <LabeledInput label="水印文字" value={watermarkText} onChange={setWatermarkText} />
        <label className="field">
          <span>水印位置</span>
          <select value={watermarkPosition} onChange={(event) => setWatermarkPosition(event.target.value as WatermarkPosition)}>
            <option value="TopLeft">左上</option>
            <option value="TopRight">右上</option>
            <option value="BottomLeft">左下</option>
            <option value="BottomRight">右下</option>
          </select>
        </label>
        <div className="panelFooter">
          <button className="primaryButton" disabled={busy !== null} onClick={submit}>
            <Sparkle weight="bold" />
            生成处理图
          </button>
        </div>
      </section>
    </div>
  );
}

function HistoryView({
  busy,
  history,
  targets,
  onUpload,
  onReveal,
  onCopy,
  onProcess,
  onClear
}: {
  busy: string | null;
  history: HistoryItem[];
  targets: UploadTargetSettings[];
  onUpload: (item: HistoryItem, target: UploadTargetSettings) => void;
  onReveal: (path: string) => void;
  onCopy: (text: string) => void;
  onProcess: (item: HistoryItem) => void;
  onClear: () => void;
}) {
  return (
    <section className="panel">
      <PanelHeader
        title="最近任务"
        action={
          <button className="ghostButton" disabled={history.length === 0} onClick={onClear}>
            <Trash />
            清空
          </button>
        }
      />
      {history.length === 0 ? (
        <EmptyState title="历史记录为空" body="截图、录屏和上传结果会显示在这里。" />
      ) : (
        <div className="historyList">
          {history.map((item) => (
            <article className="historyItem" key={item.id}>
              <div className={`statusDot ${item.status}`} />
              <div className="historyMain">
                <strong>{displayHistoryTitle(item.title)}</strong>
                <span>{formatter.format(new Date(item.createdAt))} · {displayKind(item.kind)} · {displayStatus(item.status)} · {formatBytes(item.sizeBytes)} · {shortPath(item.path)}</span>
                {item.url ? <button className="linkButton" onClick={() => onCopy(item.url ?? "")}>{item.url}</button> : null}
                {item.error ? <p className="errorText">{item.error}</p> : null}
              </div>
              <div className="rowActions">
                {(item.kind === "screenshot" || item.kind === "image") ? (
                  <button className="iconButton" title="处理" onClick={() => onProcess(item)}>
                    <Crop />
                  </button>
                ) : null}
                {targets[0] ? (
                  <button
                    className="iconButton"
                    title="上传"
                    disabled={busy === `upload-${item.id}`}
                    onClick={() => onUpload(item, targets[0])}
                  >
                    <UploadSimple />
                  </button>
                ) : null}
                <button className="iconButton" title="显示文件" onClick={() => onReveal(item.path)}>
                  <FolderOpen />
                </button>
                {item.url ? (
                  <button className="iconButton" title="复制链接" onClick={() => onCopy(item.url ?? "")}>
                    <Copy />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UploadView({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  function updateTarget(index: number, patch: Partial<UploadTargetSettings>) {
    const uploadTargets = settings.uploadTargets.map((target, currentIndex) =>
      currentIndex === index ? { ...target, ...patch } : target
    );
    onSave({ ...settings, uploadTargets });
  }

  return (
    <section className="panel">
      <PanelHeader title="上传目标" action={`已配置 ${settings.uploadTargets.length} 个`} />
      <div className="targetGrid">
        {settings.uploadTargets.map((target, index) => (
          <div className="targetItem" key={target.id}>
            <div className="targetHead">
              <div className="targetIcon">{iconForTarget(target.kind)}</div>
              <div>
                <strong>{displayTargetName(target)}</strong>
                <span>{displayTargetKind(target.kind)}</span>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={target.enabled}
                  onChange={(event) => updateTarget(index, { enabled: event.target.checked })}
                />
                <span />
              </label>
            </div>
            {target.kind === "LocalFolder" ? (
              <LabeledInput
                label="目录"
                value={target.directory ?? ""}
                placeholder="留空则复制到源文件旁边"
                onChange={(directory) => updateTarget(index, { directory })}
              />
            ) : (
              <>
                <LabeledInput
                  label="端点地址"
                  value={target.endpoint ?? ""}
                  placeholder="https://example.com/upload"
                  onChange={(endpoint) => updateTarget(index, { endpoint })}
                />
                <LabeledInput
                  label="请求方法"
                  value={target.method ?? "POST"}
                  placeholder="POST"
                  onChange={(method) => updateTarget(index, { method })}
                />
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsView({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => void }) {
  return (
    <div className="settingsGrid">
      <section className="panel">
        <PanelHeader title="截图输出" action="必填" />
        <LabeledInput
          label="保存目录"
          value={settings.saveDirectory}
          onChange={(saveDirectory) => onSave({ ...settings, saveDirectory })}
        />
        <LabeledInput
          label="文件名模式"
          value={settings.filenamePattern}
          onChange={(filenamePattern) => onSave({ ...settings, filenamePattern })}
        />
        <label className="field">
          <span>图片格式</span>
          <select
            value={settings.imageFormat}
            onChange={(event) => onSave({ ...settings, imageFormat: event.target.value as AppSettings["imageFormat"] })}
          >
            <option value="Png">PNG</option>
            <option value="Jpeg">JPEG</option>
          </select>
        </label>
      </section>

      <section className="panel">
        <PanelHeader title="录屏输出" action="MP4 / GIF" />
        <LabeledInput
          label="文件名模式"
          value={settings.recording.filenamePattern}
          onChange={(filenamePattern) => onSave({ ...settings, recording: { ...settings.recording, filenamePattern } })}
        />
        <LabeledNumber
          label="默认时长"
          min={1}
          max={600}
          value={settings.recording.durationSeconds}
          onChange={(durationSeconds) => onSave({ ...settings, recording: { ...settings.recording, durationSeconds } })}
        />
        <LabeledNumber
          label="默认帧率"
          min={1}
          max={60}
          value={settings.recording.fps}
          onChange={(fps) => onSave({ ...settings, recording: { ...settings.recording, fps } })}
        />
      </section>

      <section className="panel">
        <PanelHeader title="截图后操作" action="流程" />
        <ToggleRow
          label="复制图片"
          checked={settings.afterCapture.copyImage}
          onChange={(copyImage) => onSave({ ...settings, afterCapture: { ...settings.afterCapture, copyImage } })}
        />
        <ToggleRow
          label="保存文件"
          checked={settings.afterCapture.saveFile}
          onChange={(saveFile) => onSave({ ...settings, afterCapture: { ...settings.afterCapture, saveFile } })}
        />
        <ToggleRow
          label="自动上传"
          checked={settings.afterCapture.upload}
          onChange={(upload) => onSave({ ...settings, afterCapture: { ...settings.afterCapture, upload } })}
        />
      </section>

      <section className="panel">
        <PanelHeader title="快捷键" action="全局" />
        <LabeledInput
          label="截取全部"
          value={settings.shortcuts.captureAll}
          onChange={(captureAll) => onSave({ ...settings, shortcuts: { ...settings.shortcuts, captureAll } })}
        />
        <LabeledInput
          label="区域截图"
          value={settings.shortcuts.captureRegion}
          onChange={(captureRegion) => onSave({ ...settings, shortcuts: { ...settings.shortcuts, captureRegion } })}
        />
        <LabeledInput
          label="上传剪贴板"
          value={settings.shortcuts.uploadClipboard}
          onChange={(uploadClipboard) => onSave({ ...settings, shortcuts: { ...settings.shortcuts, uploadClipboard } })}
        />
      </section>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "navButton active" : "navButton"} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function ActionTile({
  icon,
  title,
  body,
  active,
  disabled,
  onClick
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="actionTile" disabled={disabled} onClick={onClick}>
      <span className="tileIcon">{active ? <ArrowClockwise className="spin" /> : icon}</span>
      <strong>{title}</strong>
      <span>{body}</span>
    </button>
  );
}

function PanelHeader({ title, action }: { title: string; action: React.ReactNode }) {
  return (
    <div className="panelHeader">
      <h2>{title}</h2>
      <div>{action}</div>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="emptyState">
      <Clipboard size={30} />
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LabeledNumber({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggleRow">
      <span>{label}</span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span />
      </span>
    </label>
  );
}

function titleForView(view: View) {
  return {
    capture: "截图",
    record: "录屏",
    process: "处理",
    history: "历史",
    upload: "上传",
    settings: "设置"
  }[view];
}

function subtitleForView(view: View) {
  return {
    capture: "快速截图、保存和上传，覆盖当前跨平台版本的核心流程。",
    record: "录制 MP4 或短 GIF，尽量复用系统能力保持安装包轻量。",
    process: "对截图做裁剪、缩放、灰度、边框和水印，并另存为新文件。",
    history: "查看已保存截图、录屏、上传状态、复制链接和本地文件操作。",
    upload: "本地文件夹和自定义 HTTP 目标可用，S3、FTP、SFTP 已预留。",
    settings: "管理截图命名、录屏参数、输出格式、截图后流程和快捷键。"
  }[view];
}

function displayTargetName(target: UploadTargetSettings) {
  if (target.id === "local-folder") return "本地文件夹";
  if (target.id === "custom-http") return "自定义 HTTP";
  return target.name;
}

function displayTargetKind(kind: string) {
  return {
    LocalFolder: "本地文件夹",
    CustomHttp: "自定义 HTTP",
    S3Compatible: "S3 兼容",
    Ftp: "FTP",
    Sftp: "SFTP"
  }[kind] ?? kind;
}

function displayHistoryTitle(title: string) {
  if (title === "All monitors") return "所有显示器";
  if (title.startsWith("Monitor ")) return title.replace("Monitor ", "显示器 ");
  return title;
}

function displayStatus(status: string) {
  return {
    saved: "已保存",
    uploading: "上传中",
    uploaded: "已上传",
    failed: "失败"
  }[status] ?? status;
}

function displayKind(kind: string) {
  return {
    screenshot: "截图",
    image: "图片",
    video: "视频",
    gif: "GIF"
  }[kind] ?? kind;
}

function displayDimensions(item: HistoryItem) {
  return item.width > 0 && item.height > 0 ? `${item.width} x ${item.height}` : displayKind(item.kind);
}

function iconForTarget(kind: string) {
  if (kind === "LocalFolder") return <HardDrives />;
  if (kind === "CustomHttp") return <Globe />;
  return <UploadSimple />;
}

function shortPath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts.length > 2 ? `${parts.at(-2)}/${parts.at(-1)}` : normalized;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default App;
