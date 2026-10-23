/* Rafiq — preload bridge. Only a narrow, explicit API crosses into the UI. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('rafiq:event', (_event, payload) => {
  listeners.forEach((fn) => { try { fn(payload); } catch (err) { console.error(err); } });
});

ipcRenderer.on('rafiq:menu', (_event, action) => {
  listeners.forEach((fn) => { try { fn({ type: 'menu', action }); } catch (err) { console.error(err); } });
});

contextBridge.exposeInMainWorld('rafiqDesktop', {
  isDesktop: true,
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  onEvent: (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  }
});
