import { useEffect, useCallback, useRef } from 'react';
import { useSessionStore } from '../stores/session.store';
import { useTranscriptionStore } from '../stores/transcription.store';
import { useConfigStore } from '../stores/config.store';
import { trpc } from '../api/trpc';
import { electronAPI } from '../api/ipc';

export function useSession() {
  const sessionStore = useSessionStore();
  const transcriptionStore = useTranscriptionStore();
  const configStore = useConfigStore();

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const generateTokenMutation = trpc.token.generate.useMutation();
  const createSessionMutation = trpc.capture.createSession.useMutation();
  const startRecordingMutation = trpc.recordings.start.useMutation();
  const stopRecordingMutation = trpc.recordings.stop.useMutation();
  const startTranscriptionMutation = trpc.transcription.start.useMutation();

  // NOTE: Recorder events are now handled globally in useGlobalRecorderEvents
  // This prevents transcript loss when navigating between pages

  // Timer for elapsed time
  useEffect(() => {
    if (sessionStore.status === 'recording' && sessionStore.startTime) {
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - sessionStore.startTime!) / 1000);
        sessionStore.setElapsedTime(elapsed);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [sessionStore.status, sessionStore.startTime]);

  const startRecording = useCallback(async () => {
    console.log('[useSession] startRecording called');

    if (!electronAPI) {
      sessionStore.setError('Electron API not available');
      return;
    }

    sessionStore.setStatus('starting');
    transcriptionStore.clear();

    try {
      // Generate session token if expired
      console.log('[useSession] Step 1: Checking session token');
      let sessionToken = sessionStore.sessionToken;
      let tokenExpiresAt = sessionStore.tokenExpiresAt;

      if (sessionStore.isTokenExpired()) {
        console.log('[useSession] Token expired, generating new one');
        const tokenResult = await generateTokenMutation.mutateAsync({});
        sessionToken = tokenResult.sessionToken;
        tokenExpiresAt = tokenResult.expiresAt;
        sessionStore.setSessionToken(sessionToken, tokenExpiresAt);
        console.log('[useSession] New token generated');
      }

      if (!sessionToken) {
        throw new Error('Failed to get session token');
      }

      // Get accessToken from renderer's config store (already authenticated via tRPC)
      const accessToken = configStore.accessToken;
      const apiUrl = configStore.apiUrl;
      console.log('[useSession] Step 2: Got access token and apiUrl', { hasAccessToken: !!accessToken, apiUrl });

      if (!accessToken) {
        throw new Error('Not authenticated');
      }

      // Create capture session
      console.log('[useSession] Step 3: Creating capture session');
      const captureSession = await createSessionMutation.mutateAsync({});
      console.log('[useSession] Capture session created:', captureSession);

      // Get available channels
      const channels = await electronAPI.capture.listChannels(sessionToken, apiUrl || undefined);

      // Build channel configuration
      const channelConfigs = [];

      // Find microphone channel
      const micChannel = channels.find(
        (ch) => ch.type === 'audio' && ch.channelId.startsWith('mic:')
      );
      if (micChannel && sessionStore.streams.microphone) {
        channelConfigs.push({
          channelId: micChannel.channelId,
          type: 'audio' as const,
          record: true,
          transcript: transcriptionStore.enabled,
        });
      }

      // Find system audio channel
      const sysAudioChannel = channels.find(
        (ch) => ch.type === 'audio' && ch.channelId.startsWith('system_audio:')
      );
      if (sysAudioChannel && sessionStore.streams.systemAudio) {
        channelConfigs.push({
          channelId: sysAudioChannel.channelId,
          type: 'audio' as const,
          record: true,
          transcript: transcriptionStore.enabled,
        });
      }

      // Find display channel
      const displayChannel = channels.find((ch) => ch.type === 'video');
      if (displayChannel && sessionStore.streams.screen) {
        channelConfigs.push({
          channelId: displayChannel.channelId,
          type: 'video' as const,
          record: true,
        });
      }

      if (channelConfigs.length === 0) {
        throw new Error('No channels available for recording');
      }

      // Start recording via IPC
      const result = await electronAPI.capture.startRecording({
        config: {
          sessionId: captureSession.sessionId,
          channels: channelConfigs,
        },
        sessionToken,
        accessToken,
        apiUrl,
        enableTranscription: transcriptionStore.enabled,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to start recording');
      }

      // Create recording entry in database
      console.log('[useSession] Step 5: Creating recording entry in database');
      const recordingResult = await startRecordingMutation.mutateAsync({
        sessionId: captureSession.sessionId,
      });
      console.log('[useSession] Recording entry created:', recordingResult);

      // Start transcription with WebSocket connection IDs (like Python meeting-copilot)
      // The main process creates WebSocket connections and returns the IDs
      // We pass them to the backend which polls for RTStreams and calls startTranscript()
      if (transcriptionStore.enabled && (result.micWsConnectionId || result.sysAudioWsConnectionId)) {
        console.log('[useSession] Step 6: Starting transcription with WebSocket IDs:', {
          micWsConnectionId: result.micWsConnectionId,
          sysAudioWsConnectionId: result.sysAudioWsConnectionId,
        });
        await startTranscriptionMutation.mutateAsync({
          sessionId: captureSession.sessionId,
          micWsConnectionId: result.micWsConnectionId,
          sysAudioWsConnectionId: result.sysAudioWsConnectionId,
        });
        console.log('[useSession] Transcription started');
      }

      console.log('[useSession] Step 7: Recording started successfully');
      sessionStore.startSession(captureSession.sessionId, sessionToken!, tokenExpiresAt!);
    } catch (error) {
      console.error('[useSession] Error starting recording:', error);
      sessionStore.setError(error instanceof Error ? error.message : 'Failed to start recording');
      sessionStore.setStatus('idle');
    }
  }, [
    sessionStore,
    transcriptionStore,
    configStore,
    generateTokenMutation,
    createSessionMutation,
    startRecordingMutation,
    startTranscriptionMutation,
  ]);

  const stopRecording = useCallback(async () => {
    console.log('[useSession] stopRecording called, sessionId:', sessionStore.sessionId);

    if (!electronAPI) return;

    sessionStore.setStatus('stopping');

    try {
      console.log('[useSession] Stopping capture via IPC');
      const result = await electronAPI.capture.stopRecording();
      console.log('[useSession] Stop recording IPC result:', result);

      if (!result.success) {
        throw new Error(result.error || 'Failed to stop recording');
      }

      // Update recording status
      if (sessionStore.sessionId) {
        console.log('[useSession] Updating recording status to processing');
        const stopResult = await stopRecordingMutation.mutateAsync({
          sessionId: sessionStore.sessionId,
        });
        console.log('[useSession] Stop recording mutation result:', stopResult);
      }

      console.log('[useSession] Recording stopped, waiting for webhook...');
      sessionStore.stopSession();
    } catch (error) {
      console.error('[useSession] Error stopping recording:', error);
      sessionStore.setError(error instanceof Error ? error.message : 'Failed to stop recording');
      sessionStore.setStatus('idle');
    }
  }, [sessionStore, stopRecordingMutation]);

  const toggleStream = useCallback(
    async (stream: 'microphone' | 'systemAudio' | 'screen') => {
      if (!electronAPI) return;

      const currentState = sessionStore.streams[stream];
      sessionStore.toggleStream(stream);

      // If recording, pause/resume the track
      if (sessionStore.status === 'recording' && sessionStore.sessionToken) {
        // Get track ID based on stream type
        const channels = await electronAPI.capture.listChannels(sessionStore.sessionToken, configStore.apiUrl || undefined);
        let channelId: string | undefined;

        if (stream === 'microphone') {
          channelId = channels.find((ch) => ch.channelId.startsWith('mic:'))?.channelId;
        } else if (stream === 'systemAudio') {
          channelId = channels.find((ch) => ch.channelId.startsWith('system_audio:'))?.channelId;
        } else if (stream === 'screen') {
          channelId = channels.find((ch) => ch.type === 'video')?.channelId;
        }

        if (channelId) {
          if (currentState) {
            await electronAPI.capture.pauseTracks([channelId]);
          } else {
            await electronAPI.capture.resumeTracks([channelId]);
          }
        }
      }
    },
    [sessionStore, configStore]
  );

  return {
    ...sessionStore,
    startRecording,
    stopRecording,
    toggleStream,
    isRecording: sessionStore.status === 'recording',
    isStarting: sessionStore.status === 'starting',
    isStopping: sessionStore.status === 'stopping',
  };
}
