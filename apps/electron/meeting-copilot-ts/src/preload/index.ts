import { contextBridge, ipcRenderer } from 'electron';
import type { IpcApi, RecorderEvent, PermissionStatus, StartRecordingParams } from '../shared/types/ipc.types';
import type { Channel } from '../shared/schemas/capture.schema';

const api: IpcApi = {
  capture: {
    startRecording: (params: StartRecordingParams) =>
      ipcRenderer.invoke('recorder-start-recording', params),
    stopRecording: () => ipcRenderer.invoke('recorder-stop-recording'),
    pauseTracks: (tracks: string[]) => ipcRenderer.invoke('recorder-pause-tracks', tracks),
    resumeTracks: (tracks: string[]) => ipcRenderer.invoke('recorder-resume-tracks', tracks),
    listChannels: (sessionToken: string, apiUrl?: string) =>
      ipcRenderer.invoke('recorder-list-channels', sessionToken, apiUrl),
  },

  permissions: {
    checkMicPermission: () => ipcRenderer.invoke('check-mic-permission'),
    checkScreenPermission: () => ipcRenderer.invoke('check-screen-permission'),
    checkAccessibilityPermission: () => ipcRenderer.invoke('check-accessibility-permission'),
    requestMicPermission: () => ipcRenderer.invoke('request-mic-permission'),
    requestScreenPermission: () => ipcRenderer.invoke('request-screen-permission'),
    openSystemSettings: (pane: string) => ipcRenderer.invoke('open-system-settings', pane),
    getStatus: (): Promise<PermissionStatus> => ipcRenderer.invoke('get-permission-status'),
  },

  app: {
    getSettings: () => ipcRenderer.invoke('get-settings'),
    logout: () => ipcRenderer.invoke('logout'),
    openExternalLink: (url: string) => ipcRenderer.invoke('open-external-link', url),
    showNotification: (title: string, body: string) =>
      ipcRenderer.invoke('show-notification', title, body),
    openPlayerWindow: (url: string) => ipcRenderer.invoke('open-player-window', url),
  },

  on: {
    recorderEvent: (callback: (event: RecorderEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: RecorderEvent) => {
        callback(data);
      };
      ipcRenderer.on('recorder-event', listener);
      return () => {
        ipcRenderer.removeListener('recorder-event', listener);
      };
    },

    authRequired: (callback: () => void) => {
      const listener = () => {
        callback();
      };
      ipcRenderer.on('auth-required', listener);
      return () => {
        ipcRenderer.removeListener('auth-required', listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

// Type declaration for window.electronAPI
declare global {
  interface Window {
    electronAPI: IpcApi;
  }
}
