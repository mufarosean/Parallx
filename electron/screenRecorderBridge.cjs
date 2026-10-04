// screenRecorderBridge.cjs — the screen recorder's main-process side (Atelier,
// ext/media-organizer). A transparent framing window plus ffmpeg gdigrab.
//
// Loaded only when the tool first calls a recorder:* channel (see
// optionalBridges.cjs): at app start nothing of it is read, and it starts
// nothing on its own. Every timer, process, window and global shortcut it
// holds exists only while a recorder frame is open.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { spawn } = require('node:child_process');

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   appRoot: string,
 *   getMainWindow: () => any,
 *   getWorkspaceRoot: () => string | null,
 *   isAllowedWritePath: (p: string) => boolean,
 *   boundsOnScreen: (b: { x: number, y: number, width: number, height: number }) => boolean,
 * }} deps
 */
function setupScreenRecorderBridge(ipcMain, deps) {
  const { BrowserWindow, screen, globalShortcut, session, desktopCapturer } = require('electron');
  const { appRoot, getMainWindow, getWorkspaceRoot, isAllowedWritePath, boundsOnScreen } = deps;

  // A floating, transparent, always-on-top, resizable "frame" window the user
  // positions over the screen region they want. ffmpeg records the HOLLOW inner
  // rect (so the frame's own border + toolbar are never captured), writing to a
  // path the extension already validated as in-workspace (we re-check here). On
  // stop, 'q' is sent to ffmpeg's stdin for a clean finalize, then the resulting
  // path is handed back to the renderer via the 'recorder:complete' event.
  const RECORDER_BORDER = 2;    // px — MUST match recorderFrame.html (border around the capture area only)
  const RECORDER_TOOLBAR = 44;  // px — MUST match recorderFrame.html
  const _recorderFrames = new Map(); // frameId -> { win, proc, outputPath, ffmpegPath, fps, recording, ... }
  let _recorderIdCounter = 0;

  // Fixed, app-wide hotkeys while a recorder frame is open: the user is usually
  // in ANOTHER app when they want to stop, so these work without focus. They are
  // registered on openFrame and released with the frame. A failed register (the
  // combo is taken by another program) is silent: the toolbar still works.
  const RECORDER_HOTKEY_STOP = 'CommandOrControl+Alt+R';
  const RECORDER_HOTKEY_PAUSE = 'CommandOrControl+Alt+P';
  let _recorderHotkeyOwner = null; // frameId that currently owns the shortcuts
  function _recorderClaimHotkeys(frameId) {
    if (_recorderHotkeyOwner) return;
    const send = (action) => {
      const e = _recorderFrames.get(_recorderHotkeyOwner);
      if (e && e.win && !e.win.isDestroyed()) e.win.webContents.send('recorder:hotkey', { action });
    };
    try {
      const okStop = globalShortcut.register(RECORDER_HOTKEY_STOP, () => send('stop'));
      const okPause = globalShortcut.register(RECORDER_HOTKEY_PAUSE, () => send('pause'));
      if (okStop || okPause) _recorderHotkeyOwner = frameId;
    } catch { /* leave unregistered */ }
  }
  function _recorderReleaseHotkeys(frameId) {
    if (_recorderHotkeyOwner !== frameId) return;
    _recorderHotkeyOwner = null;
    try { globalShortcut.unregister(RECORDER_HOTKEY_STOP); } catch { /* ignore */ }
    try { globalShortcut.unregister(RECORDER_HOTKEY_PAUSE); } catch { /* ignore */ }
  }

  // The telemetry timer: while recording, sample the cursor (Smart Zoom in the
  // editor) and, in follow-the-box mode, where the frame is (the camera path).
  // Both are normalized to the capture rect, timestamped from the first frame.
  function _recorderStopTelemetry(entry) {
    if (entry && entry.telemetryTimer) { clearInterval(entry.telemetryTimer); entry.telemetryTimer = null; }
  }
  function _recorderStartTelemetry(entry) {
    _recorderStopTelemetry(entry);
    entry.cursorTrack = [];
    entry.boxTrack = [];
    let lastBox = null;
    entry.telemetryTimer = setInterval(() => {
      if (!entry.recording || !entry.videoFirstFrameAt || !entry.captureRect) return;
      const cap = entry.captureRect;
      const t = Math.round(((Date.now() - entry.videoFirstFrameAt) / 1000) * 1000) / 1000;
      try {
        const dip = screen.getCursorScreenPoint();
        const p = screen.dipToScreenPoint(dip);
        const x = (p.x - cap.x) / cap.w, y = (p.y - cap.y) / cap.h;
        if (x >= -0.02 && x <= 1.02 && y >= -0.02 && y <= 1.02 && entry.cursorTrack.length < 60000) {
          entry.cursorTrack.push({ t, x: Math.round(Math.max(0, Math.min(1, x)) * 1e4) / 1e4, y: Math.round(Math.max(0, Math.min(1, y)) * 1e4) / 1e4 });
        }
      } catch { /* display went away mid-sample */ }
      if (entry.followBox && entry.win && !entry.win.isDestroyed()) {
        try {
          const r = _recorderCaptureRect(entry.win);
          const box = {
            t,
            x: Math.round(((r.x - cap.x) / cap.w) * 1e4) / 1e4, y: Math.round(((r.y - cap.y) / cap.h) * 1e4) / 1e4,
            w: Math.round((r.w / cap.w) * 1e4) / 1e4, h: Math.round((r.h / cap.h) * 1e4) / 1e4,
          };
          if (!lastBox || lastBox.x !== box.x || lastBox.y !== box.y || lastBox.w !== box.w || lastBox.h !== box.h || entry.boxTrack.length === 0) {
            if (entry.boxTrack.length < 60000) entry.boxTrack.push(box);
            lastBox = box;
          }
        } catch { /* ignore */ }
      }
    }, 33);
  }

  // Physical-pixel rect of the whole display the frame sits on (follow-the-box
  // records the display and the editor crops to the frame's path).
  function _recorderDisplayRect(win) {
    const b = win.getBounds();
    const disp = screen.getDisplayNearestPoint({ x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) });
    const db = disp.bounds;
    const sf = disp.scaleFactor || 1;
    const tl = screen.dipToScreenPoint({ x: db.x, y: db.y });
    let pw = Math.round(db.width * sf), ph = Math.round(db.height * sf);
    if (pw % 2 !== 0) pw -= 1;
    if (ph % 2 !== 0) ph -= 1;
    return { rect: { x: Math.round(tl.x), y: Math.round(tl.y), w: Math.max(2, pw), h: Math.max(2, ph) }, dip: { x: db.x, y: db.y, width: db.width, height: db.height } };
  }

  // Persist the frame's size + position app-wide (like the main window), so it
  // reopens where the user last left it — ScreenToGif-style. Saved on move/resize
  // (debounced); restored on open if still on a connected display.
  const RECORDER_STATE_FILE = path.join(appRoot, 'data', 'recorder-frame-state.json');
  let _recorderSaveTimer = null;
  function loadRecorderFrameState() {
    try {
      const s = JSON.parse(fsSync.readFileSync(RECORDER_STATE_FILE, 'utf8'));
      if (s && Number.isFinite(s.x) && Number.isFinite(s.y) &&
          Number.isFinite(s.width) && Number.isFinite(s.height) &&
          s.width >= 200 && s.height >= 160) return s;
    } catch { /* none yet */ }
    return null;
  }
  function saveRecorderFrameState(bounds) {
    if (!bounds) return;
    if (_recorderSaveTimer) clearTimeout(_recorderSaveTimer);
    _recorderSaveTimer = setTimeout(() => {
      try {
        fsSync.writeFileSync(RECORDER_STATE_FILE, JSON.stringify({
          x: Math.round(bounds.x), y: Math.round(bounds.y),
          width: Math.round(bounds.width), height: Math.round(bounds.height),
        }), 'utf8');
      } catch { /* non-critical */ }
    }, 400);
  }

  function _recorderSendState(frameId, state) {
    const entry = _recorderFrames.get(frameId);
    if (entry && entry.win && !entry.win.isDestroyed()) {
      entry.win.webContents.send('recorder:state', state);
    }
  }

  // Physical-pixel capture rect of the hollow centre, from the frame's DIP bounds
  // (DPI-correct: dipToScreenPoint for the origin, scaleFactor for the size).
  function _recorderCaptureRect(win) {
    const b = win.getBounds(); // DIP
    const innerDip = {
      x: b.x + RECORDER_BORDER,
      y: b.y + RECORDER_BORDER,
      w: Math.max(2, b.width - RECORDER_BORDER * 2),
      h: Math.max(2, b.height - RECORDER_BORDER * 2 - RECORDER_TOOLBAR),
    };
    const disp = screen.getDisplayNearestPoint({ x: innerDip.x, y: innerDip.y });
    const sf = (disp && disp.scaleFactor) || 1;
    const tl = screen.dipToScreenPoint({ x: innerDip.x, y: innerDip.y });
    let pw = Math.round(innerDip.w * sf);
    let ph = Math.round(innerDip.h * sf);
    if (pw % 2 !== 0) pw -= 1;   // even dims required by libx264 + yuv420p
    if (ph % 2 !== 0) ph -= 1;
    return { x: Math.round(tl.x), y: Math.round(tl.y), w: Math.max(2, pw), h: Math.max(2, ph) };
  }

  // ── Audio capture (WASAPI loopback via Electron) ────────────────────────────
  // ffmpeg/DirectShow can't tap an output device (Bluetooth/USB/HDMI). Instead the
  // frame renderer captures audio through Chromium: getDisplayMedia + this handler
  // returns `audio: 'loopback'` to grab whatever the OS is playing (any device),
  // or the renderer uses getUserMedia for the mic. The captured audio is sent back
  // and muxed with the gdigrab video. The handler is set once, lazily.
  let _recorderLoopbackHandlerSet = false;
  function _ensureLoopbackAudioHandler() {
    if (_recorderLoopbackHandlerSet) return;
    _recorderLoopbackHandlerSet = true;
    try {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        // getDisplayMedia requires a video source; the recorder frame discards it
        // and keeps only the loopback audio track.
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
          callback(sources && sources.length ? { video: sources[0], audio: 'loopback' } : {});
        }).catch(() => { try { callback({}); } catch { /* ignore */ } });
      }, { useSystemPicker: false });
    } catch { /* older Electron — frame falls back to video-only */ }
  }

  // Belt for app teardown (main.cjs calls it on quit): per-window 'closed'
  // handlers normally kill capture procs, but quit unconditionally sweeps
  // anything still running so an ffmpeg can never outlive the app (an orphan
  // keeps recording the screen to disk forever and holds its temp file locked).
  function killAll() {
    for (const [, e] of _recorderFrames) {
      if (e && e.proc) { try { e.proc.kill('SIGKILL'); } catch { /* ignore */ } }
    }
  }

  // Lets the media-organizer self-heal a wedged "recording in progress" flag:
  // if it believes a recording is active but no recorder frame actually exists,
  // the flag is stale (a missed completion event) and can be cleared safely.
  ipcMain.handle('recorder:anyActive', () => ({ active: _recorderFrames.size > 0 }));

  ipcMain.handle('recorder:openFrame', async (_event, opts) => {
    try {
      const fps = Math.max(1, Math.min(60, parseInt(opts?.fps, 10) || 30));
      const ffmpegPath = String(opts?.ffmpegPath || '');
      const outputPath = String(opts?.outputPath || '');
      // Re-validate containment in main — spawned ffmpeg bypasses the fs gate, and
      // isAllowedWritePath returns true when no workspace is set, so require one.
      if (!ffmpegPath || !outputPath || !getWorkspaceRoot() || !isAllowedWritePath(outputPath)) {
        return { error: { code: 'BAD_ARGS', message: 'Missing ffmpeg/output, or output is outside the workspace' } };
      }
      const frameId = `rec-${++_recorderIdCounter}`;
      // Restore last size/position if it's still on a connected display, else
      // fall back to the caller's defaults (centred).
      const saved = loadRecorderFrameState();
      const useSaved = saved && boundsOnScreen(saved);
      const initW = useSaved ? saved.width : Math.max(240, parseInt(opts?.width, 10) || 640) + RECORDER_BORDER * 2;
      const initH = useSaved ? saved.height : Math.max(160, parseInt(opts?.height, 10) || 360) + RECORDER_BORDER * 2 + RECORDER_TOOLBAR;
      const win = new BrowserWindow({
        width: initW,
        height: initH,
        ...(useSaved ? { x: saved.x, y: saved.y } : {}),
        minWidth: 200,
        minHeight: 160,
        frame: false,
        transparent: true,
        hasShadow: false,
        resizable: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        fullscreenable: false,
        maximizable: false,
        // Non-activating (WS_EX_NOACTIVATE on Windows): the frame receives mouse
        // clicks / drag / resize but never becomes the foreground window. Without
        // this, clicking the frame steals foreground from a fullscreen app being
        // recorded, so Windows un-hides the taskbar and drops the app out of
        // fullscreen mid-record.
        focusable: false,
        backgroundColor: '#00000000',
        webPreferences: {
          preload: path.join(__dirname, 'recorderFramePreload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      // Audio capture mode: 'off' | 'system' (loopback) | 'mic'. Capture itself
      // happens in the frame renderer; the toolbar speaker button mutes it
      // locally. Main only needs the mode to pass to the frame.
      const audioMode = ['system', 'mic', 'both'].includes(opts?.audio) ? opts.audio : 'off';
      const countdown = [0, 3, 5, 10].includes(parseInt(opts?.countdown, 10)) ? parseInt(opts.countdown, 10) : 0;
      const drawMouse = opts?.showCursor === false ? 0 : 1;
      const followBox = opts?.followBox === true;
      // gdigrab writes video to a temp; final output is muxed (video + captured
      // audio) into outputPath on stop. videoPath is a sibling temp file.
      const videoPath = outputPath.replace(/\.mp4$/i, '') + '.video.mp4';
      const entry = {
        win, proc: null, outputPath, videoPath, audioPath: null, ffmpegPath, fps,
        recording: false, audioMode, countdown, drawMouse, followBox,
        paused: false, pauses: [], cursorTrack: [], boxTrack: [], captureRect: null, displayDip: null, telemetryTimer: null,
      };
      _recorderFrames.set(frameId, entry);
      if (audioMode === 'system' || audioMode === 'both') _ensureLoopbackAudioHandler();
      _recorderClaimHotkeys(frameId);
      const search = new URLSearchParams({
        frameId, fps: String(fps), audio: audioMode, countdown: String(countdown), follow: followBox ? '1' : '0',
        hotkeyStop: RECORDER_HOTKEY_STOP, hotkeyPause: RECORDER_HOTKEY_PAUSE,
      }).toString();
      win.loadFile(path.join(__dirname, 'recorderFrame.html'), { search });
      // Unexpected close (OS, app quit) that didn't go through stop/cancel: tear
      // down the recording and tell the renderer it was cancelled so it doesn't
      // wait forever. stop/cancel delete from the map first, so they no-op here.
      win.on('closed', () => {
        _recorderReleaseHotkeys(frameId);
        const e = _recorderFrames.get(frameId);
        if (!e) return;
        _recorderStopTelemetry(e);
        if (e.proc) { try { e.proc.kill('SIGKILL'); } catch { /* ignore */ } }
        _recorderFrames.delete(frameId);
        _recorderCleanupTemps(e);
        if (e.outputPath) fs.unlink(e.outputPath).catch(() => {});
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('recorder:complete', { frameId, path: null, ok: false, cancelled: true });
        }
      });
      return { frameId, error: null };
    } catch (err) {
      return { error: { code: 'OPEN_FAILED', message: err.message } };
    }
  });

  // Manual move/resize for the transparent frame (-webkit-app-region: drag does
  // not work on transparent windows on Windows, and frameless transparent windows
  // get no native resize). The renderer computes the new DIP bounds and sends them.
  ipcMain.handle('recorder:setBounds', (_event, frameId, bounds) => {
    const entry = _recorderFrames.get(frameId);
    if (!entry || !entry.win || entry.win.isDestroyed() || !bounds) return { error: null };
    if (entry.recording) {
      // Follow-the-box: the frame may MOVE while recording (its size is fixed,
      // and it stays on the display being captured); the path becomes the
      // camera in the editor. Any other recording refuses bounds changes.
      if (!entry.followBox || !entry.displayDip) return { error: null };
      try {
        const cur = entry.win.getBounds();
        const d = entry.displayDip;
        const x = Math.max(d.x, Math.min(d.x + d.width - cur.width, Math.round(bounds.x)));
        const y = Math.max(d.y, Math.min(d.y + d.height - cur.height, Math.round(bounds.y)));
        entry.win.setBounds({ x, y, width: cur.width, height: cur.height });
      } catch { /* ignore */ }
      return { error: null };
    }
    try {
      entry.win.setBounds({
        x: Math.round(bounds.x), y: Math.round(bounds.y),
        width: Math.max(200, Math.round(bounds.width)),
        height: Math.max(160, Math.round(bounds.height)),
      });
      saveRecorderFrameState(entry.win.getBounds()); // persist last position/size (debounced)
    } catch { /* ignore */ }
    return { error: null };
  });

  // Pause is a MARKER, not a stop: video and audio keep running (so they stay
  // aligned) and the paused spans open in the editor already cut out as
  // segments. That is what lets a pause be undone by simply deleting a cut.
  // Pause spans are kept as wall-clock instants and converted at stop against
  // the same origin as the wall duration, so cuts line up with the telemetry.
  // The reply carries the CONFIRMED state; the frame paints from it.
  ipcMain.handle('recorder:pause', (_event, frameId) => {
    const entry = _recorderFrames.get(frameId);
    if (!entry || !entry.recording) return { error: null, paused: false };
    if (!entry.paused) {
      entry.paused = true;
      entry.pauses.push({ sAt: Date.now(), eAt: null });
      _recorderSendState(frameId, { recording: true, paused: true });
    }
    return { error: null, paused: true };
  });
  ipcMain.handle('recorder:resume', (_event, frameId) => {
    const entry = _recorderFrames.get(frameId);
    if (!entry || !entry.recording) return { error: null, paused: false };
    if (entry.paused) {
      entry.paused = false;
      const last = entry.pauses[entry.pauses.length - 1];
      if (last && last.eAt === null) last.eAt = Date.now();
      _recorderSendState(frameId, { recording: true, paused: false });
    }
    return { error: null, paused: false };
  });

  // Toggle window-wide click-through. The renderer flips this on every region
  // transition so the hollow centre passes clicks to the app being recorded,
  // while the border / corners / toolbar stay interactive. forward:true keeps
  // mousemove events flowing to the renderer even while click-through, so it can
  // detect when the cursor re-enters the chrome.
  ipcMain.handle('recorder:setIgnoreMouse', (_event, frameId, ignore) => {
    const entry = _recorderFrames.get(frameId);
    if (entry && entry.win && !entry.win.isDestroyed()) {
      try { entry.win.setIgnoreMouseEvents(!!ignore, { forward: true }); } catch { /* ignore */ }
    }
    return { error: null };
  });

  function _recorderCleanupTemps(entry) {
    if (!entry) return;
    if (entry.videoPath) fs.unlink(entry.videoPath).catch(() => {});
    if (entry.audioPath) fs.unlink(entry.audioPath).catch(() => {});
  }

  // Header-only duration probe via ffprobe (sibling of ffmpeg). Returns 0 on any
  // failure so the caller can fall back to wall-clock timing. Fast + size-
  // independent, unlike loading the whole file in the renderer.
  function _recorderProbeDuration(ffmpegPath, file) {
    return _recorderProbeFormat(ffmpegPath, file).then((f) => f.duration);
  }
  // { duration, startTime } from the container header. startTime is the
  // absolute wall-clock start in seconds (epoch) when the capture kept its
  // timestamps, else 0. Both 0 on any failure.
  function _recorderProbeFormat(ffmpegPath, file) {
    return new Promise((resolve) => {
      const ffprobe = ffmpegPath.replace(/ffmpeg(\.exe)?$/i, (m, e) => 'ffprobe' + (e || ''));
      let out = '', done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const p = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration,start_time', '-of', 'default=nw=1', file], { windowsHide: true });
        p.stdout.on('data', (d) => { out += d.toString(); });
        p.on('exit', () => {
          const dur = parseFloat((/duration=([\d.]+)/.exec(out) || [])[1]);
          const st = parseFloat((/start_time=([\d.]+)/.exec(out) || [])[1]);
          finish({ duration: Number.isFinite(dur) && dur > 0 ? dur : 0, startTime: Number.isFinite(st) && st > 1e8 ? st : 0 });
        });
        p.on('error', () => finish({ duration: 0, startTime: 0 }));
        setTimeout(() => { try { p.kill(); } catch { /* ignore */ } finish({ duration: 0, startTime: 0 }); }, 5000);
      } catch { finish({ duration: 0, startTime: 0 }); }
    });
  }

  // Produce the final output from the lossless capture temp. This is the OFFLINE
  // stage (no real-time constraint), so it does the heavy lifting the live capture
  // deliberately skipped:
  //   1. Drift correction — retime the video so it plays back over its REAL
  //      wall-clock capture span (gdigrab's CFR assumption can drift from real
  //      time; the renderer-captured audio is the real-time reference). This is
  //      why audio no longer slides out of sync over the clip.
  //   2. A/V start alignment — the audio (MediaRecorder, started on getDisplayMedia
  //      latency) and video (gdigrab) begin at different instants; `-itsoffset`
  //      shifts whichever started later so t=0 lines up.
  //   3. High-quality encode — libx264 crf 18 medium from the near-lossless
  //      yuv420p capture temp (light, GPU-decodable), replacing the old live
  //      ultrafast/crf-default encode.
  // Graceful fallbacks so a take is never lost: plain re-encode, then promote the
  // temp as-is. Resolves true when outputPath exists.
  async function _recorderFinalize(entry) {
    const { ffmpegPath, videoPath, audioPath, outputPath } = entry;
    if (!videoPath || !fsSync.existsSync(videoPath)) return false;
    const hasAudio = !!(audioPath && fsSync.existsSync(audioPath));

    // Drift factor: play the video over its real wall-clock span. factor > 1 slows
    // a time-compressed capture (dropped frames) back to real time.
    //
    // The bounds are deliberately WIDE (0.2–8): when gdigrab can't sustain the
    // declared framerate (busy screen, large region), media time accrues at a
    // fraction of wall time and the factor is exactly 2, 3, 4× — the old
    // 0.5–2.0 "sanity" clamp rejected precisely the worst compressions, which
    // shipped recordings that played several times too fast. Only degenerate
    // probe garbage should be rejected here.
    const fmt = await _recorderProbeFormat(ffmpegPath, videoPath);
    const videoDur = fmt.duration;
    let factor = 1;
    if (fmt.startTime > 0) {
      // Real timestamps: every frame already sits at its wall-clock instant, so
      // the duration IS the wall duration. Nothing to retime.
      entry.videoStartMs = fmt.startTime * 1000;
    } else if (videoDur > 0 && entry.wallDur > 0) {
      const f = entry.wallDur / videoDur;
      if (Number.isFinite(f) && f > 0.2 && f < 8.0) factor = f;
    }

    // A/V start offset (same wall clock). >0 → audio started later → delay audio;
    // <0 → video started later → delay video. Sanity-bounded.
    let offset = 0;
    const videoStartAt = entry.videoStartMs || entry.videoFirstFrameAt;
    if (hasAudio && entry.audioStartedAt && videoStartAt) {
      const o = (entry.audioStartedAt - videoStartAt) / 1000;
      if (Number.isFinite(o) && Math.abs(o) <= 10) offset = o;
    }

    const runFfmpeg = (args, timeoutMs) => new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
        p.on('exit', (code) => finish(code === 0 && fsSync.existsSync(outputPath)));
        p.on('error', () => finish(false));
        setTimeout(() => { if (!done) { try { p.kill('SIGKILL'); } catch { /* ignore */ } finish(false); } }, timeoutMs);
      } catch { finish(false); }
    });
    // Re-encode can take a while; scale the cap with clip length but bound it.
    const encodeTimeout = Math.min(600000, 60000 + Math.round((entry.wallDur || 0) * 4000));

    // ── Primary: retime + align + high-quality re-encode (+ mux) ──
    const args = ['-y'];
    if (offset < 0) args.push('-itsoffset', (-offset).toFixed(3));
    args.push('-i', videoPath);
    if (hasAudio) {
      if (offset > 0) args.push('-itsoffset', offset.toFixed(3));
      args.push('-i', audioPath);
    }
    // 3% tolerance: below it a speed error is imperceptible and stream-copy
    // (fast, zero quality loss) wins; the old 0.5% threshold forced a full
    // re-encode over probe noise. Above it, retiming is mandatory.
    const needsRetime = Math.abs(factor - 1) > 0.03;
    if (needsRetime) {
      // Drift correction needs a re-encode — do it near-lossless (one-time export).
      args.push('-vf', `setpts=${factor.toFixed(6)}*PTS`);
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p');
    } else {
      // No retiming needed → copy the captured video stream verbatim. This drops
      // the whole second lossy generation (capture was already near-lossless) and
      // makes the export much faster — the recording keeps the full capture quality.
      args.push('-c:v', 'copy');
    }
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    else args.push('-an');
    args.push('-movflags', '+faststart', outputPath);
    if (await runFfmpeg(args, encodeTimeout)) { _recorderCleanupTemps(entry); return true; }

    // ── Fallback: plain video-only re-encode (still high quality) ──
    // The drift retime MUST survive into the fallback: this path fires exactly
    // when the primary is struggling (long/heavy recordings) — the same cases
    // where gdigrab fell behind — so dropping setpts here shipped the
    // time-compressed temp at full speed.
    try { if (fsSync.existsSync(outputPath)) fsSync.unlinkSync(outputPath); } catch { /* ignore */ }
    const fb = ['-y', '-i', videoPath];
    if (needsRetime) fb.push('-vf', `setpts=${factor.toFixed(6)}*PTS`);
    fb.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', outputPath);
    if (await runFfmpeg(fb, encodeTimeout)) { _recorderCleanupTemps(entry); return true; }

    // ── Last resort: promote the lossless temp as-is (large, but never lose it) ──
    try { if (!fsSync.existsSync(outputPath)) fsSync.renameSync(videoPath, outputPath); } catch { /* ignore */ }
    const okFinal = fsSync.existsSync(outputPath);
    _recorderCleanupTemps(entry);
    return okFinal;
  }

  ipcMain.handle('recorder:start', async (_event, frameId) => {
    const entry = _recorderFrames.get(frameId);
    if (!entry || !entry.win || entry.win.isDestroyed()) return { error: { code: 'NO_FRAME', message: 'No frame' } };
    if (entry.recording) return { error: null };
    try {
      let rect;
      if (entry.followBox) {
        // Record the WHOLE display the frame is on; the frame's path is captured
        // as telemetry and the editor crops to it (a moving camera).
        const d = _recorderDisplayRect(entry.win);
        rect = d.rect;
        entry.displayDip = d.dip;
      } else {
        rect = _recorderCaptureRect(entry.win);
      }
      entry.captureRect = rect;
      entry.paused = false;
      entry.pauses = [];
      // Video only — gdigrab to a temp file. Audio is captured by the frame
      // renderer (loopback / mic) and muxed in on stop.
      const args = [
        '-y',
        '-thread_queue_size', '1024',
        '-f', 'gdigrab',
        '-framerate', String(entry.fps),
        '-offset_x', String(rect.x),
        '-offset_y', String(rect.y),
        '-video_size', `${rect.w}x${rect.h}`,
        '-draw_mouse', String(entry.drawMouse === 0 ? 0 : 1),
        '-i', 'desktop',
        // Real timestamps: gdigrab stamps each frame with the wall clock (epoch
        // microseconds). passthrough keeps every frame at its real instant (no
        // CFR duplication, no drift, smaller file); copyts keeps the ABSOLUTE
        // start so the file itself says when the first frame was captured.
        // The finalize remux rebases to zero.
        '-copyts', '-fps_mode', 'passthrough',
        // Capture stage: LIGHT, GPU-DECODABLE, near-lossless. `ultrafast` keeps CPU
        // low so gdigrab holds its frame rate on long recordings (dropped frames =
        // stutter + A/V drift); `crf 18` is visually near-lossless; `yuv420p` is
        // hardware-decodable, so the preview and long clips play back SMOOTHLY.
        // (The previous lossless 4:4:4 was not GPU-decodable → software-decode
        // stutter, and its huge bitrate stalled long captures + broke the frame
        // strip.) The final export re-encodes from this temp.
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '14',
        '-pix_fmt', 'yuv420p',
        // Progress on stdout so we can timestamp the FIRST captured frame, used to
        // align audio (which starts on its own clock) against video in the mux.
        '-progress', 'pipe:1', '-stats_period', '0.05',
        entry.videoPath,
      ];
      const proc = spawn(entry.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      entry.proc = proc;
      entry.recording = true;
      entry.startedAt = Date.now();
      entry.videoFirstFrameAt = 0;
      _recorderStartTelemetry(entry);
      // Keep the tail of ffmpeg's stderr — when capture dies, this is the ONLY
      // place the real reason lives (gdigrab/encoder/disk errors). Previously
      // stderr was 'ignore'd and failures surfaced as a bare exit code.
      entry.lastStderr = '';
      if (proc.stderr) {
        proc.stderr.on('data', (d) => {
          entry.lastStderr = (entry.lastStderr + d.toString()).slice(-2000);
        });
      }
      // ffmpeg -progress emits key=value lines; the first update carrying a frame
      // count marks the first captured frame. Stamp it once (same wall clock as the
      // renderer's audio start) for the A/V start-offset math on finalize.
      // Accumulate a small rolling buffer: "frame=" can split across chunk
      // boundaries, and a missed stamp silently degrades wallDur + A/V offset.
      if (proc.stdout) {
        let progressTail = '';
        proc.stdout.on('data', (d) => {
          if (entry.videoFirstFrameAt) return;
          progressTail = (progressTail + d.toString()).slice(-256);
          const m = /frame=\s*(\d+)/.exec(progressTail);
          if (m && parseInt(m[1], 10) >= 1) entry.videoFirstFrameAt = Date.now();
        });
      }
      proc.on('error', (err) => {
        entry.recording = false; entry.proc = null;
        _recorderStopTelemetry(entry);
        console.error('[recorder] ffmpeg failed to start:', err.message);
        _recorderSendState(frameId, { recording: false, error: 'ffmpeg failed to start: ' + err.message });
      });
      proc.on('exit', (code) => {
        // recorder:stop removes the entry from the map BEFORE awaiting exit, so if
        // it's still here + recording this is an unexpected death — reset the frame.
        const e = _recorderFrames.get(frameId);
        if (e && e.recording && e.proc === proc) {
          e.recording = false; e.proc = null;
          _recorderStopTelemetry(e);
          const tail = (e.lastStderr || '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' | ');
          console.error('[recorder] capture died (code ' + code + '):', e.lastStderr || '(no stderr)');
          _recorderSendState(frameId, {
            recording: false,
            error: 'Recording failed (code ' + code + ')' + (tail ? ': ' + tail : ''),
          });
        }
      });
      _recorderSendState(frameId, { recording: true });
      return { error: null };
    } catch (err) {
      entry.recording = false;
      return { error: { code: 'START_FAILED', message: err.message } };
    }
  });

  // The frame renderer captures audio (loopback/mic) and sends the encoded
  // webm/opus bytes just before stop. We stash it to a temp file for muxing.
  ipcMain.handle('recorder:sendAudio', async (_event, frameId, buffer, startedAt) => {
    const entry = _recorderFrames.get(frameId);
    if (!entry) return { error: null };
    try {
      const buf = buffer ? Buffer.from(buffer) : null;
      if (buf && buf.length > 0) {
        const audioPath = entry.outputPath.replace(/\.mp4$/i, '') + '.audio.webm';
        await fs.writeFile(audioPath, buf);
        entry.audioPath = audioPath;
        // Wall-clock instant audio actually started (MediaRecorder.onstart) — same
        // clock as entry.videoFirstFrameAt, so their difference is the A/V offset.
        entry.audioStartedAt = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : 0;
      }
    } catch { entry.audioPath = null; }
    return { error: null };
  });

  ipcMain.handle('recorder:stop', async (_event, frameId) => {
    const entry = _recorderFrames.get(frameId);
    if (!entry) return { error: { code: 'NO_FRAME', message: 'No frame' }, ok: false };
    const proc = entry.proc;
    _recorderFrames.delete(frameId); // claim it so win.on('closed') no-ops
    _recorderReleaseHotkeys(frameId);
    _recorderStopTelemetry(entry);
    if (!proc || !entry.recording) {
      if (entry.win && !entry.win.isDestroyed()) entry.win.close();
      _recorderCleanupTemps(entry);
      return { error: null, path: null, ok: false };
    }
    _recorderSendState(frameId, { recording: false, processing: true });
    const stopAt = Date.now();
    // Stop gdigrab gracefully so the temp video finalizes. Allow time for longer
    // recordings to flush + write the moov atom before we hard-kill.
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      if (proc.exitCode !== null || proc.killed) { finish(); return; }
      proc.once('exit', finish);
      proc.once('error', finish);
      try { proc.stdin.write('q'); } catch { /* fall through to timeout */ }
      setTimeout(() => { if (!done) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } finish(); } }, 12000);
    });
    // Real capture span (wall clock) — the ground truth the video is retimed to on
    // finalize, since gdigrab's CFR assumption can drift from real time. Prefer the
    // first-frame stamp; fall back to spawn time.
    const videoStart = entry.videoFirstFrameAt || entry.startedAt || 0;
    entry.wallDur = videoStart ? Math.max(0, (stopAt - videoStart) / 1000) : 0;
    entry.recording = false;
    // An open pause runs to the end of the take.
    const pauses = (entry.pauses || [])
      .map((p) => ({ s: Math.max(0, (p.sAt - videoStart) / 1000), e: p.eAt === null ? entry.wallDur : Math.max(0, (p.eAt - videoStart) / 1000) }))
      .filter((p) => p.e > p.s + 0.05);
    let ok = false;
    try { ok = await _recorderFinalize(entry); } catch { ok = false; }
    // The telemetry ran on the progress stamp's clock; the file knows the real
    // first-frame instant. Shift so t=0 is the first frame of the recording.
    if (ok && entry.videoStartMs && videoStart) {
      const shift = (videoStart - entry.videoStartMs) / 1000;
      if (Number.isFinite(shift) && Math.abs(shift) < 5 && shift !== 0) {
        const rebase = (arr) => { for (const p of arr) p.t = Math.max(0, Math.round((p.t + shift) * 1000) / 1000); };
        rebase(entry.cursorTrack || []); rebase(entry.boxTrack || []);
        for (const p of pauses) { p.s = Math.max(0, p.s + shift); p.e = Math.max(0, p.e + shift); }
        entry.wallDur = Math.max(0, (stopAt - entry.videoStartMs) / 1000);
      }
    }
    // Report the duration ourselves (exact via ffprobe, wall-clock fallback) so
    // the renderer never has to load the whole file to read it.
    let duration = 0;
    if (ok) {
      duration = await _recorderProbeDuration(entry.ffmpegPath, entry.outputPath);
      if (!duration && entry.startedAt) duration = Math.max(0, (stopAt - entry.startedAt) / 1000);
    }
    if (entry.win && !entry.win.isDestroyed()) entry.win.close();
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder:complete', {
        frameId, path: ok ? entry.outputPath : null, ok, duration,
        // What the editor opens with: where the cursor went (Smart Zoom), the
        // frame's path when following (the camera), and the pauses (cut).
        cursorTrack: ok ? entry.cursorTrack : [],
        boxTrack: ok && entry.followBox ? entry.boxTrack : [],
        followBox: !!entry.followBox,
        pauses: ok ? pauses : [],
        captureRect: entry.captureRect,
      });
    }
    return { error: null, path: ok ? entry.outputPath : null, ok };
  });

  ipcMain.handle('recorder:cancel', async (_event, frameId) => {
    const entry = _recorderFrames.get(frameId);
    if (!entry) return { error: null };
    _recorderFrames.delete(frameId); // claim it so win.on('closed') no-ops
    _recorderReleaseHotkeys(frameId);
    _recorderStopTelemetry(entry);
    if (entry.proc) { try { entry.proc.kill('SIGKILL'); } catch { /* ignore */ } }
    if (entry.win && !entry.win.isDestroyed()) entry.win.close();
    _recorderCleanupTemps(entry);
    if (entry.outputPath) fs.unlink(entry.outputPath).catch(() => {});
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('recorder:complete', { frameId, path: null, ok: false, cancelled: true });
    }
    return { error: null };
  });

  return {
    /** Whether a recorder frame is open. */
    anyActive: () => _recorderFrames.size > 0,
    /** App quit: no ffmpeg may outlive the app. */
    killAll,
  };
}

module.exports = { setupScreenRecorderBridge };
