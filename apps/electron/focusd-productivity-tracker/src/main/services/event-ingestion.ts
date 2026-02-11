import type { RawEvent, ActivitySegment, AppCategory } from '../../shared/types';
import * as db from './database';
import {
  parseSceneIndex,
  categorizeAlert,
  inferAction,
  inferProject,
} from './app-tracker';
import { isCurrentlyIdle } from './idle-detector';
import { log, warn } from './logger';

const TAG = 'INGEST';

let buffer: RawEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let activeSessionId: string | null = null;
let totalIngested = 0;
let totalFlushed = 0;

export function startIngestion(sessionId: string, segmentFlushMins?: number): void {
  activeSessionId = sessionId;
  buffer = [];
  totalIngested = 0;
  totalFlushed = 0;

  const flushMins = segmentFlushMins || 5;
  const intervalMs = flushMins * 60 * 1000;
  log(TAG, `Ingestion started (session: ${sessionId}, flush every ${flushMins}m)`);

  flushTimer = setInterval(() => flushToSegments(), intervalMs);
}

export function stopIngestion(): void {
  log(TAG, `Stopping ingestion (buffered: ${buffer.length}, total ingested: ${totalIngested}, total flushed: ${totalFlushed})`);
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (buffer.length > 0) {
    log(TAG, `Flushing remaining ${buffer.length} events before stop`);
    flushToSegments();
  }
  activeSessionId = null;
}

export function ingestEvent(msg: Record<string, unknown>): void {
  if (!activeSessionId) {
    warn(TAG, 'Event received but no active session');
    return;
  }

  const channel = (msg.channel || msg.type || msg.event_type) as string;
  if (!channel) {
    warn(TAG, 'Event has no channel/type', { keys: Object.keys(msg) });
    return;
  }

  let appName: string | undefined;
  let appCategory: AppCategory | undefined;
  let summaryText: string | undefined;
  const data = (msg.data || {}) as Record<string, unknown>;

  switch (channel) {
    case 'scene_index':
    case 'visual_index': {
      const text = (data.text || msg.text || '') as string;
      if (!text.trim()) {
        warn(TAG, `${channel} event with empty text`);
        return;
      }
      const parsed = parseSceneIndex(text);
      appName = parsed.appName;
      appCategory = parsed.category;
      summaryText = text;
      break;
    }
    case 'transcript': {
      const text = (msg.text || data.text || '') as string;
      if (!text.trim()) return;
      summaryText = text;
      break;
    }
    case 'spoken_index': {
      summaryText =
        ((msg.summary || data.summary || data.text || '') as string) ||
        undefined;
      break;
    }
    case 'alert': {
      const label = (msg.label || data.label || '') as string;
      const eventName = (msg.event_name || data.event_name || '') as string;
      const cat = categorizeAlert(label, eventName);
      appName = cat.appName;
      appCategory = cat.category;
      summaryText = label;
      break;
    }
    default:
      if (totalIngested < 20) {
        log(TAG, `Skipping unknown channel: "${channel}"`, { keys: Object.keys(msg) });
      }
      return;
  }

  totalIngested++;

  const event: RawEvent = {
    sessionId: activeSessionId,
    timestamp: Math.floor(Date.now() / 1000),
    channel: channel as RawEvent['channel'],
    appName,
    appCategory,
    summaryText,
    rawJson: JSON.stringify(msg),
  };

  // Log the first 20 events in detail, then every 25th
  if (totalIngested <= 20 || totalIngested % 25 === 0) {
    log(TAG, `Event #${totalIngested} [${channel}]`, {
      app: appName || '(none)',
      category: appCategory || '(none)',
      textPreview: summaryText?.slice(0, 120) || '(empty)',
    });
  }

  db.insertRawEvent(event);
  buffer.push(event);
}

export function flushToSegments(): void {
  if (!activeSessionId || buffer.length === 0) {
    if (activeSessionId) {
      log(TAG, 'Flush called but buffer is empty');
    }
    return;
  }

  const events = buffer.splice(0);
  const groups = groupByApp(events);
  const idle = isCurrentlyIdle();

  log(TAG, `Flushing ${events.length} events into ${groups.length} segment(s) (idle: ${idle})`);

  let segmentsCreated = 0;
  for (const group of groups) {
    if (group.events.length === 0) continue;

    const sceneTexts = group.events
      .filter((e) => (e.channel === 'scene_index' || e.channel === 'visual_index') && e.summaryText)
      .map((e) => e.summaryText!);

    const transcriptParts = group.events
      .filter((e) => e.channel === 'transcript' && e.summaryText)
      .map((e) => e.summaryText!);

    const action = inferAction(sceneTexts);
    const project = inferProject(sceneTexts);

    const segment: ActivitySegment = {
      sessionId: activeSessionId,
      startTime: group.events[0].timestamp,
      endTime: group.events[group.events.length - 1].timestamp,
      primaryApp: group.appName || undefined,
      appCategory: group.appCategory || undefined,
      action,
      project,
      context: sceneTexts[0]?.slice(0, 200),
      transcriptSnippet: transcriptParts.join(' ').slice(0, 300) || undefined,
      eventCount: group.events.length,
      isIdle: idle,
    };

    const segId = db.insertActivitySegment(segment);
    segmentsCreated++;

    log(TAG, `Segment #${segId} created`, {
      app: segment.primaryApp || 'Unknown',
      category: segment.appCategory || 'other',
      action,
      project: project || '(none)',
      events: group.events.length,
      sceneTexts: sceneTexts.length,
      transcripts: transcriptParts.length,
    });
  }

  totalFlushed += segmentsCreated;
  log(TAG, `Flush complete: ${segmentsCreated} segments (total: ${totalFlushed})`);
}

interface EventGroup {
  appName: string | undefined;
  appCategory: AppCategory | undefined;
  events: RawEvent[];
}

function groupByApp(events: RawEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let current: EventGroup | null = null;

  for (const event of events) {
    const hasAppInfo =
      event.channel === 'scene_index' || event.channel === 'visual_index' || event.channel === 'alert';

    if (
      hasAppInfo &&
      event.appName &&
      (!current || event.appName !== current.appName)
    ) {
      if (current) groups.push(current);
      current = {
        appName: event.appName,
        appCategory: event.appCategory,
        events: [event],
      };
    } else if (current) {
      current.events.push(event);
    } else {
      current = {
        appName: event.appName,
        appCategory: event.appCategory,
        events: [event],
      };
    }
  }

  if (current) groups.push(current);
  return groups;
}

export function getBufferSize(): number {
  return buffer.length;
}
