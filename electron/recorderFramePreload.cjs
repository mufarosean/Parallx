// recorderFramePreload.cjs — minimal, isolated bridge for the screen-recorder
// frame window (recorderFrame.html). Exposes only record start/stop/cancel and
// a state listener, keyed by the frameId passed in the URL query.
const { contextBridge, ipcRenderer } = require('electron');

const params = new URLSearchParams(location.search);
const frameId = params.get('frameId');

contextBridge.exposeInMainWorld('recorderFrame', {
  frameId,
  fps: parseInt(params.get('fps'), 10) || 30,
  audio: params.get('audio') || 'off', // 'off' | 'system' | 'mic'
  start: () => ipcRenderer.invoke('recorder:start', frameId),
  stop: () => ipcRenderer.invoke('recorder:stop', frameId),
  cancel: () => ipcRenderer.invoke('recorder:cancel', frameId),
  setBounds: (bounds) => ipcRenderer.invoke('recorder:setBounds', frameId, bounds),
  setIgnoreMouse: (ignore) => ipcRenderer.invoke('recorder:setIgnoreMouse', frameId, ignore),
  sendAudio: (buffer, startedAt) => ipcRenderer.invoke('recorder:sendAudio', frameId, buffer, startedAt),
  onState: (cb) => {
    const h = (_e, s) => { try { cb(s); } catch { /* ignore */ } };
    ipcRenderer.on('recorder:state', h);
    return () => ipcRenderer.removeListener('recorder:state', h);
  },
});
