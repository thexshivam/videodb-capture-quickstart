import { z } from 'zod';

export const RecordingStatusSchema = z.enum(['recording', 'processing', 'available', 'failed']);
export const InsightsStatusSchema = z.enum(['pending', 'processing', 'ready', 'failed']);

export const RecordingSchema = z.object({
  id: z.number(),
  videoId: z.string().nullable(),
  streamUrl: z.string().nullable(),
  playerUrl: z.string().nullable(),
  sessionId: z.string(),
  duration: z.number().nullable(),
  createdAt: z.string(),
  status: RecordingStatusSchema,
  insights: z.string().nullable(),
  insightsStatus: InsightsStatusSchema,
});

export const CreateRecordingInputSchema = z.object({
  sessionId: z.string(),
});

export const StopRecordingInputSchema = z.object({
  sessionId: z.string(),
});

export const GetRecordingInputSchema = z.object({
  recordingId: z.number(),
});

export type RecordingStatus = z.infer<typeof RecordingStatusSchema>;
export type InsightsStatus = z.infer<typeof InsightsStatusSchema>;
export type Recording = z.infer<typeof RecordingSchema>;
export type CreateRecordingInput = z.infer<typeof CreateRecordingInputSchema>;
export type StopRecordingInput = z.infer<typeof StopRecordingInputSchema>;
export type GetRecordingInput = z.infer<typeof GetRecordingInputSchema>;
