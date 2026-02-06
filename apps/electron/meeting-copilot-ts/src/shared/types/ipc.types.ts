import type { CaptureConfig, Channel } from '../schemas/capture.schema';

export interface StartRecordingParams {
  config: CaptureConfig;
  sessionToken: string;
  accessToken: string;
  apiUrl?: string;
  enableTranscription?: boolean;
}

export interface RecorderEvent {
  event:
    | 'recording:started'
    | 'recording:stopped'
    | 'recording:error'
    | 'transcript'
    | 'upload:progress'
    | 'upload:complete'
    | 'error';
  data?: unknown;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  source: 'mic' | 'system_audio';
}

export interface UploadProgressEvent {
  progress: number;
  total: number;
}

export interface PermissionStatus {
  microphone: boolean;
  screen: boolean;
  accessibility: boolean;
}

export interface StartRecordingResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  // WebSocket connection IDs for real-time transcription (like Python meeting-copilot)
  micWsConnectionId?: string;
  sysAudioWsConnectionId?: string;
}

export interface StopRecordingResult {
  success: boolean;
  error?: string;
}

export interface IpcApi {
  capture: {
    startRecording: (params: StartRecordingParams) => Promise<StartRecordingResult>;
    stopRecording: () => Promise<StopRecordingResult>;
    pauseTracks: (tracks: string[]) => Promise<void>;
    resumeTracks: (tracks: string[]) => Promise<void>;
    listChannels: (sessionToken: string, apiUrl?: string) => Promise<Channel[]>;
  };
  permissions: {
    checkMicPermission: () => Promise<boolean>;
    checkScreenPermission: () => Promise<boolean>;
    checkAccessibilityPermission: () => Promise<boolean>;
    requestMicPermission: () => Promise<boolean>;
    requestScreenPermission: () => Promise<boolean>;
    openSystemSettings: (pane: string) => Promise<void>;
    getStatus: () => Promise<PermissionStatus>;
  };
  app: {
    getSettings: () => Promise<{
      accessToken?: string;
      userName?: string;
      apiKey?: string;
      apiUrl?: string;
      webhookUrl?: string;
    }>;
    logout: () => Promise<void>;
    openExternalLink: (url: string) => Promise<void>;
    showNotification: (title: string, body: string) => Promise<void>;
    openPlayerWindow: (url: string) => Promise<void>;
  };
  on: {
    recorderEvent: (callback: (event: RecorderEvent) => void) => () => void;
    authRequired: (callback: () => void) => () => void;
  };
}

export type IpcChannel =
  | 'recorder-start-recording'
  | 'recorder-stop-recording'
  | 'recorder-pause-tracks'
  | 'recorder-resume-tracks'
  | 'recorder-list-channels'
  | 'check-mic-permission'
  | 'check-screen-permission'
  | 'check-accessibility-permission'
  | 'request-mic-permission'
  | 'request-screen-permission'
  | 'open-system-settings'
  | 'get-permission-status'
  | 'get-settings'
  | 'logout'
  | 'open-external-link'
  | 'show-notification'
  | 'open-player-window'
  | 'recorder-event'
  | 'auth-required';
