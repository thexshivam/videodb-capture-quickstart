import OpenAI from 'openai';
import type {
  MicroSummary,
  SessionSummary,
  DailySummary,
  DeepDiveResult,
  ProductivityLabel,
} from '../../shared/types';
import * as db from './database';
import { getConfig, getPrompt } from './config';
import { log, warn, error } from './logger';

const TAG = 'SUMMARY';

function stripCodeFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return s.trim();
}

function fmtDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

let llm: OpenAI | null = null;

let microTimer: NodeJS.Timeout | null = null;
let sessionTimer: NodeJS.Timeout | null = null;
let activeSessionId: string | null = null;
let sessionStartTime: number = 0;
let lastMicroTime: number = 0;
let lastSessionSummaryTime: number = 0;
let microCount = 0;
let sessionCount = 0;

export function initSummarizer(apiKey: string, baseUrl: string): void {
  log(TAG, `Initializing LLM client (baseURL: ${baseUrl}, key: ${apiKey.slice(0, 8)}...)`);
  llm = new OpenAI({ apiKey, baseURL: baseUrl });
  log(TAG, 'LLM client ready');
}

export function startPeriodicSummaries(
  sessionId: string,
  microIntervalMins: number,
  sessionIntervalMins: number,
): void {
  activeSessionId = sessionId;
  sessionStartTime = Math.floor(Date.now() / 1000);
  lastMicroTime = sessionStartTime;
  lastSessionSummaryTime = sessionStartTime;
  microCount = 0;
  sessionCount = 0;

  log(TAG, `Periodic summaries started`, {
    sessionId,
    microEvery: `${microIntervalMins}m`,
    sessionEvery: `${sessionIntervalMins}m`,
  });

  microTimer = setInterval(
    () => {
      log(TAG, 'Micro summary timer fired');
      generateMicroSummary();
    },
    microIntervalMins * 60 * 1000,
  );

  sessionTimer = setInterval(
    () => {
      log(TAG, 'Session summary timer fired');
      generateSessionSummary();
    },
    sessionIntervalMins * 60 * 1000,
  );
}

export async function stopPeriodicSummaries(): Promise<void> {
  log(TAG, `Stopping periodic summaries (micros: ${microCount}, sessions: ${sessionCount})`);

  if (microTimer) {
    clearInterval(microTimer);
    microTimer = null;
  }
  if (sessionTimer) {
    clearInterval(sessionTimer);
    sessionTimer = null;
  }

  if (activeSessionId && llm) {
    // 1. Final micro summary from remaining unprocessed segments
    log(TAG, 'Generating final micro summary before stop...');
    try {
      const finalMicro = await generateMicroSummary();
      if (finalMicro) {
        log(TAG, 'Final micro summary generated successfully');
      } else {
        log(TAG, 'No unprocessed segments for final micro summary');
      }
    } catch (e) {
      error(TAG, 'Failed to generate final micro summary', e);
    }

    // 2. Final session summary from all micro summaries
    log(TAG, 'Generating final session summary before stop...');
    try {
      const finalSession = await generateSessionSummary();
      if (finalSession) {
        log(TAG, 'Final session summary generated successfully');
      } else {
        log(TAG, 'No micro summaries for final session summary');
      }
    } catch (e) {
      error(TAG, 'Failed to generate final session summary', e);
    }

    // 3. Daily summary rollup
    const today = db.todayDateString();
    log(TAG, `Generating daily summary for ${today}...`);
    try {
      const daily = await generateDailySummary(today);
      if (daily) {
        log(TAG, 'Daily summary generated on stop');
      } else {
        log(TAG, 'No data for daily summary');
      }
    } catch (e) {
      error(TAG, 'Failed to generate daily summary on stop', e);
    }
  }

  activeSessionId = null;
}

// ── L1 → L2: Micro Summary ──

export async function generateMicroSummary(): Promise<MicroSummary | null> {
  if (!llm) {
    warn(TAG, 'generateMicroSummary: LLM not initialized');
    return null;
  }
  if (!activeSessionId) {
    warn(TAG, 'generateMicroSummary: No active session');
    return null;
  }

  const segments = db.getUnprocessedSegmentsForMicro(
    activeSessionId,
    lastMicroTime,
  );

  if (segments.length === 0) {
    log(TAG, 'generateMicroSummary: No unprocessed segments');
    return null;
  }

  log(TAG, `Generating micro summary from ${segments.length} segment(s)`, {
    timeRange: `${new Date(segments[0].startTime * 1000).toLocaleTimeString()} - ${new Date(segments[segments.length - 1].endTime * 1000).toLocaleTimeString()}`,
    apps: [...new Set(segments.map(s => s.primaryApp || 'Unknown'))],
  });

  const cfg = getConfig();
  const now = Math.floor(Date.now() / 1000);
  const segmentData = segments.map((s) => {
    const dur = s.endTime - s.startTime;
    return {
      app: s.primaryApp || 'Unknown',
      category: s.appCategory || 'other',
      action: s.action || 'unknown',
      context: s.context?.slice(0, 100),
      transcript: s.transcriptSnippet?.slice(0, 150),
      duration_seconds: dur,
      duration_readable: fmtDuration(dur),
      idle: s.isIdle,
    };
  });

  // Gather existing project names from this session for reuse
  const existingProjects = db.getDistinctProjectsForSession(activeSessionId);
  let existingProjectsBlock = '';
  if (existingProjects.length > 0) {
    existingProjectsBlock = `Previously identified projects in this session: ${existingProjects.join(', ')}\nReuse one of these names if the current activity belongs to the same project.\n\n`;
  }

  const prompt = getPrompt('micro_summary', {
    segments: JSON.stringify(segmentData, null, 2),
    existing_projects_block: existingProjectsBlock,
  });

  log(TAG, 'LLM request: micro_summary', {
    model: cfg.llm.model,
    maxTokens: cfg.llm.max_tokens.micro_summary,
    inputSegments: segmentData.length,
    promptSystemLen: prompt.system.length,
    promptUserLen: prompt.user.length,
  });

  try {
    const response = await llm.chat.completions.create({
      model: cfg.llm.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: cfg.llm.max_tokens.micro_summary,
      response_format: { type: 'json_object' },
    });

    const rawContent = response.choices[0].message.content || '{}';
    log(TAG, 'LLM response received', {
      usage: response.usage,
      contentLen: rawContent.length,
      contentPreview: rawContent.slice(0, 200),
    });

    const parsed = JSON.parse(stripCodeFences(rawContent));

    // Compute app breakdown deterministically from segment data
    const computedAppBreakdown: Record<string, number> = {};
    for (const s of segments) {
      const app = s.primaryApp || 'Unknown';
      computedAppBreakdown[app] = (computedAppBreakdown[app] || 0) + (s.endTime - s.startTime);
    }

    // Extract LLM-generated project name (only if non-null/non-empty)
    const llmProject: string | null =
      parsed.project && typeof parsed.project === 'string' && parsed.project.toLowerCase() !== 'null'
        ? parsed.project.trim()
        : null;

    const segmentIds = segments.map((s) => s.id!).filter(Boolean);

    // Backfill segment project column with the LLM's intelligent project name
    if (llmProject) {
      db.updateSegmentProjects(segmentIds, llmProject);
      log(TAG, `LLM assigned project "${llmProject}" to ${segmentIds.length} segment(s)`);
    }

    const micro: MicroSummary = {
      sessionId: activeSessionId,
      startTime: segments[0].startTime,
      endTime: segments[segments.length - 1].endTime,
      summary: parsed.summary || 'No summary available',
      appBreakdown: computedAppBreakdown,
      primaryActivity: parsed.primary_activity,
      productivityLabel:
        (parsed.productivity_label as ProductivityLabel) || 'neutral',
      project: llmProject || undefined,
      segmentIds,
    };

    const id = db.insertMicroSummary(micro);
    lastMicroTime = now;
    microCount++;

    log(TAG, `Micro summary #${microCount} stored (id: ${id})`, {
      summary: micro.summary.slice(0, 100),
      productivity: micro.productivityLabel,
      apps: Object.keys(micro.appBreakdown),
    });

    return micro;
  } catch (e) {
    error(TAG, 'Failed to generate micro summary', e);
    return null;
  }
}

// ── L2 → L3: Session Summary ──

export async function generateSessionSummary(): Promise<SessionSummary | null> {
  if (!llm) {
    warn(TAG, 'generateSessionSummary: LLM not initialized');
    return null;
  }
  if (!activeSessionId) {
    warn(TAG, 'generateSessionSummary: No active session');
    return null;
  }

  const micros = db.getMicroSummaries(
    lastSessionSummaryTime,
    Math.floor(Date.now() / 1000),
  );

  if (micros.length === 0) {
    log(TAG, 'generateSessionSummary: No micro summaries to aggregate');
    return null;
  }

  log(TAG, `Generating session summary from ${micros.length} micro(s)`);

  const cfg = getConfig();
  const now = Math.floor(Date.now() / 1000);
  const microData = micros.map((m) => {
    const dur = m.endTime - m.startTime;
    return {
      summary: m.summary,
      apps: m.appBreakdown,
      activity: m.primaryActivity,
      productivity: m.productivityLabel,
      duration_seconds: dur,
      duration_readable: fmtDuration(dur),
    };
  });

  const prompt = getPrompt('session_summary', {
    micro_summaries: JSON.stringify(microData, null, 2),
  });

  log(TAG, 'LLM request: session_summary', {
    model: cfg.llm.model,
    maxTokens: cfg.llm.max_tokens.session_summary,
    inputMicros: microData.length,
  });

  try {
    const response = await llm.chat.completions.create({
      model: cfg.llm.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: cfg.llm.max_tokens.session_summary,
      response_format: { type: 'json_object' },
    });

    const rawContent = response.choices[0].message.content || '{}';
    log(TAG, 'LLM response received', {
      usage: response.usage,
      contentPreview: rawContent.slice(0, 200),
    });

    const parsed = JSON.parse(stripCodeFences(rawContent));
    const date = db.todayDateString();

    // Compute all numeric fields deterministically from micro data
    const computedActivities = micros.map((m) => {
      const dur = fmtDuration(m.endTime - m.startTime);
      return `${m.primaryActivity || 'activity'} (${dur})`;
    });

    const computedAppStats: Record<string, number> = {};
    const computedProjects: Record<string, number> = {};
    for (const m of micros) {
      // Aggregate app durations from each micro's breakdown
      for (const [app, secs] of Object.entries(m.appBreakdown || {})) {
        const normalizedApp = app.replace(/\.com$|\.org$|\.io$|\.dev$/i, '');
        computedAppStats[normalizedApp] = (computedAppStats[normalizedApp] || 0) + (typeof secs === 'number' ? secs : 0);
      }
    }

    // Projects from micro summaries (LLM-generated, backfilled into segments)
    // Also check segments for any project names set by LLM backfill
    const segmentsInRange = db.getActivitySegments(micros[0].startTime, micros[micros.length - 1].endTime);
    for (const seg of segmentsInRange) {
      if (seg.project) {
        const proj = seg.project.trim();
        computedProjects[proj] = (computedProjects[proj] || 0) + (seg.endTime - seg.startTime);
      }
    }

    const session: SessionSummary = {
      sessionId: activeSessionId,
      date,
      startTime: micros[0].startTime,
      endTime: micros[micros.length - 1].endTime,
      summary: parsed.summary || 'No summary available',
      keyActivities: computedActivities,
      projects: computedProjects,
      appStats: computedAppStats,
      productivityLabel:
        (parsed.productivity_label as ProductivityLabel) || 'neutral',
    };

    const id = db.insertSessionSummary(session);
    lastSessionSummaryTime = now;
    sessionCount++;

    log(TAG, `Session summary #${sessionCount} stored (id: ${id})`, {
      summary: session.summary.slice(0, 100),
      productivity: session.productivityLabel,
      keyActivities: session.keyActivities,
    });

    return session;
  } catch (e) {
    error(TAG, 'Failed to generate session summary', e);
    return null;
  }
}

// ── L3 → L4: Daily Summary ──

export async function generateDailySummary(
  date: string,
): Promise<DailySummary | null> {
  if (!llm) {
    warn(TAG, 'generateDailySummary: LLM not initialized');
    return null;
  }

  const sessions = db.getSessionSummaries(date);
  const appUsage = db.getAppUsageForDate(date);
  const projects = db.getProjectsForDate(date);
  const totalTracked = db.getTotalTrackedForDate(date);
  const totalIdle = db.getIdleSecsForDate(date);
  const { productive, distracted } = db.getProductiveSecsForDate(date);

  const dayStart = Math.floor(new Date(date + 'T00:00:00').getTime() / 1000);
  const dayEnd = dayStart + 86400;
  const micros =
    sessions.length === 0 ? db.getMicroSummaries(dayStart, dayEnd) : [];

  log(TAG, `generateDailySummary for ${date}`, {
    sessions: sessions.length,
    micros: micros.length,
    appUsage: appUsage.length,
    totalTrackedMins: Math.round(totalTracked / 60),
    productiveMins: Math.round(productive / 60),
  });

  if (sessions.length === 0 && micros.length === 0) {
    warn(TAG, 'No sessions or micros to generate daily summary from');
    return null;
  }

  const inputData =
    sessions.length > 0
      ? sessions.map((s) => ({
          summary: s.summary,
          activities: s.keyActivities,
          projects: s.projects,
          apps: s.appStats,
          productivity: s.productivityLabel,
          duration_readable: fmtDuration(s.endTime - s.startTime),
        }))
      : micros.map((m) => ({
          summary: m.summary,
          apps: m.appBreakdown,
          productivity: m.productivityLabel,
          duration_readable: fmtDuration(m.endTime - m.startTime),
        }));

  const cfg = getConfig();
  const statsBlock = [
    `- Total tracked: ${Math.round(totalTracked / 60)} minutes`,
    `- Idle time: ${Math.round(totalIdle / 60)} minutes`,
    `- Productive time: ${Math.round(productive / 60)} minutes`,
    `- Distracted time: ${Math.round(distracted / 60)} minutes`,
    `- Top apps: ${JSON.stringify(Object.fromEntries(appUsage.slice(0, 5).map((a) => [a.app, Math.round(a.seconds / 60) + 'min'])))}`,
    `- Projects: ${JSON.stringify(Object.fromEntries(projects.slice(0, 5).map((p) => [p.project, Math.round(p.seconds / 60) + 'min'])))}`,
  ].join('\n');

  const prompt = getPrompt('daily_summary', {
    date,
    session_data: JSON.stringify(inputData, null, 2),
    stats: statsBlock,
  });

  log(TAG, 'LLM request: daily_summary', {
    model: cfg.llm.model,
    maxTokens: cfg.llm.max_tokens.daily_summary,
    inputChunks: inputData.length,
  });

  try {
    const response = await llm.chat.completions.create({
      model: cfg.llm.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: cfg.llm.max_tokens.daily_summary,
      response_format: { type: 'json_object' },
    });

    const rawContent = response.choices[0].message.content || '{}';
    log(TAG, 'LLM response received', {
      usage: response.usage,
      contentPreview: rawContent.slice(0, 200),
    });

    const parsed = JSON.parse(stripCodeFences(rawContent));

    const daily: DailySummary = {
      date,
      headline: parsed.headline || 'Daily Summary',
      summary: parsed.summary || 'No summary available',
      highlights: parsed.highlights || [],
      improvements: parsed.improvements || [],
      drillDownSections: (parsed.sections || []).map(
        (s: {
          title: string;
          summary: string;
          start_hour: number;
          end_hour: number;
        }) => ({
          title: s.title,
          summary: s.summary,
          startTime: dayStart + (s.start_hour || 0) * 3600,
          endTime: dayStart + (s.end_hour || 24) * 3600,
        }),
      ),
      totalTrackedSecs: totalTracked,
      totalIdleSecs: totalIdle,
      totalProductiveSecs: productive,
      totalDistractedSecs: distracted,
      topApps: Object.fromEntries(appUsage.map((a) => [a.app, a.seconds])),
      topProjects: Object.fromEntries(
        projects.map((p) => [p.project, p.seconds]),
      ),
    };

    db.upsertDailySummary(daily);
    log(TAG, `Daily summary stored for ${date}`, {
      headline: daily.headline,
      highlights: daily.highlights.length,
      improvements: daily.improvements.length,
    });
    return daily;
  } catch (e) {
    error(TAG, 'Failed to generate daily summary', e);
    return null;
  }
}

// ── On-Demand Deep Dive ──

export async function generateDeepDive(
  start: number,
  end: number,
): Promise<DeepDiveResult> {
  const cacheKey = `${activeSessionId || 'none'}:${start}:${end}`;
  const cached = db.getCachedDeepDive(cacheKey);
  if (cached) {
    log(TAG, 'Deep dive served from cache', { cacheKey });
    return cached;
  }

  if (!llm) {
    warn(TAG, 'generateDeepDive: LLM not initialized');
    return { analysis: 'LLM not configured. Cannot generate deep dive.' };
  }

  const rawEvents = db.getRawEvents(start, end);
  if (rawEvents.length === 0) {
    log(TAG, 'generateDeepDive: No events in range');
    return { analysis: 'No events recorded for this time range.' };
  }

  log(TAG, `Generating deep dive (${rawEvents.length} raw events)`);

  const eventSummaries = rawEvents
    .filter((e) => e.summaryText)
    .map((e) => ({
      time: e.timestamp,
      type: e.channel,
      app: e.appName,
      text: e.summaryText?.slice(0, 150),
    }));

  const cfg = getConfig();
  const eventsSlice = eventSummaries.slice(0, 50);
  const overflow =
    eventSummaries.length > 50
      ? `\n... and ${eventSummaries.length - 50} more events`
      : '';

  const prompt = getPrompt('deep_dive', {
    event_count: eventSummaries.length,
    events: JSON.stringify(eventsSlice, null, 2) + overflow,
  });

  log(TAG, 'LLM request: deep_dive', {
    model: cfg.llm.model,
    maxTokens: cfg.llm.max_tokens.deep_dive,
    eventCount: eventSummaries.length,
  });

  try {
    const response = await llm.chat.completions.create({
      model: cfg.llm.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: cfg.llm.max_tokens.deep_dive,
    });

    const analysis =
      response.choices[0].message.content || 'Analysis unavailable.';

    log(TAG, 'Deep dive generated', {
      usage: response.usage,
      analysisLen: analysis.length,
    });

    const result: DeepDiveResult = { analysis };
    db.cacheDeepDive(cacheKey, result);
    return result;
  } catch (e) {
    error(TAG, 'Failed to generate deep dive', e);
    return { analysis: `Error generating analysis: ${e}` };
  }
}

// ── On-demand "summarize now" ──

export async function generateOnDemandSummary(): Promise<string> {
  log(TAG, 'On-demand summary requested', {
    hasLLM: !!llm,
    activeSession: activeSessionId || '(none)',
  });

  // 1. Flush any pending segments into a micro summary first
  await generateMicroSummary();

  // 2. Gather ALL micro summaries for today
  const today = db.todayDateString();
  const dayStart = Math.floor(new Date(today + 'T00:00:00').getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const allMicros = db.getMicroSummaries(dayStart, now + 60);

  if (allMicros.length === 0) {
    warn(TAG, 'On-demand: no micro summaries available for today');
    return 'No activity recorded yet.';
  }

  // 3. If only one micro, return it directly
  if (allMicros.length === 1) {
    log(TAG, 'On-demand: single micro summary, returning directly');
    return allMicros[0].summary;
  }

  // 4. Multiple micros — synthesize an overall summary using session prompt
  if (!llm) {
    return allMicros[allMicros.length - 1].summary;
  }

  log(TAG, `On-demand: synthesizing ${allMicros.length} micro summaries into overview`);

  const cfg = getConfig();
  const microData = allMicros.map((m) => {
    const dur = m.endTime - m.startTime;
    return {
      summary: m.summary,
      apps: m.appBreakdown,
      activity: m.primaryActivity,
      productivity: m.productivityLabel,
      duration_seconds: dur,
      duration_readable: fmtDuration(dur),
    };
  });

  const prompt = getPrompt('session_summary', {
    micro_summaries: JSON.stringify(microData, null, 2),
  });

  try {
    const response = await llm.chat.completions.create({
      model: cfg.llm.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      max_tokens: cfg.llm.max_tokens.session_summary,
      response_format: { type: 'json_object' },
    });

    const rawContent = response.choices[0].message.content || '{}';
    log(TAG, 'On-demand overview LLM response', {
      usage: response.usage,
      contentPreview: rawContent.slice(0, 200),
    });

    const parsed = JSON.parse(stripCodeFences(rawContent));
    return parsed.summary || allMicros[allMicros.length - 1].summary;
  } catch (e) {
    error(TAG, 'On-demand overview LLM failed, falling back to latest micro', e);
    return allMicros[allMicros.length - 1].summary;
  }
}
