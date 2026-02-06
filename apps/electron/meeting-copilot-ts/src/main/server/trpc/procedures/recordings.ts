import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import {
  RecordingSchema,
  CreateRecordingInputSchema,
  StopRecordingInputSchema,
  GetRecordingInputSchema,
} from '../../../../shared/schemas/recording.schema';
import {
  getAllRecordings,
  createRecording,
  updateRecordingBySessionId,
  getRecordingById,
} from '../../../db';
import { createChildLogger } from '../../../lib/logger';

const logger = createChildLogger('recordings-procedure');

// Transform database recording to API schema
function toApiRecording(dbRecording: ReturnType<typeof getRecordingById>) {
  if (!dbRecording) return null;

  return {
    id: dbRecording.id,
    videoId: dbRecording.videoId,
    streamUrl: dbRecording.streamUrl,
    playerUrl: dbRecording.playerUrl,
    sessionId: dbRecording.sessionId,
    duration: dbRecording.duration,
    createdAt: dbRecording.createdAt,
    status: dbRecording.status as 'recording' | 'processing' | 'available' | 'failed',
    insights: dbRecording.insights,
    insightsStatus: dbRecording.insightsStatus as 'pending' | 'processing' | 'ready' | 'failed',
  };
}

export const recordingsRouter = router({
  list: protectedProcedure
    .output(z.array(RecordingSchema))
    .query(async () => {
      logger.info('Fetching all recordings');
      const recordings = getAllRecordings();
      logger.info({
        count: recordings.length,
        recordings: recordings.map(r => ({
          id: r.id,
          sessionId: r.sessionId,
          status: r.status,
          insightsStatus: r.insightsStatus,
          videoId: r.videoId,
        })),
      }, 'Recordings fetched');
      return recordings.map((r) => toApiRecording(r)!);
    }),

  get: protectedProcedure
    .input(GetRecordingInputSchema)
    .output(RecordingSchema.nullable())
    .query(async ({ input }) => {
      logger.debug({ recordingId: input.recordingId }, 'Fetching recording');
      const recording = getRecordingById(input.recordingId);
      return toApiRecording(recording);
    }),

  start: protectedProcedure
    .input(CreateRecordingInputSchema)
    .output(RecordingSchema)
    .mutation(async ({ input }) => {
      logger.info({ sessionId: input.sessionId }, 'Starting recording');

      const recording = createRecording({
        sessionId: input.sessionId,
        status: 'recording',
      });

      logger.info(
        { recordingId: recording.id, sessionId: input.sessionId },
        'Recording started'
      );

      return toApiRecording(recording)!;
    }),

  stop: protectedProcedure
    .input(StopRecordingInputSchema)
    .output(RecordingSchema.nullable())
    .mutation(async ({ input }) => {
      logger.info({ sessionId: input.sessionId }, 'Stopping recording');

      const recording = updateRecordingBySessionId(input.sessionId, {
        status: 'processing',
      });

      if (!recording) {
        logger.warn({ sessionId: input.sessionId }, 'Recording not found');
        return null;
      }

      logger.info(
        { recordingId: recording.id, sessionId: input.sessionId },
        'Recording stopped, status set to processing'
      );

      return toApiRecording(recording);
    }),
});
