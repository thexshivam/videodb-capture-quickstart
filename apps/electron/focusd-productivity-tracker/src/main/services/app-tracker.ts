import type { AppCategory } from '../../shared/types';
import { log, warn } from './logger';

const TAG = 'PARSE';

interface ParsedScene {
  appName: string;
  category: AppCategory;
  action?: string;
  details?: string;
}

const APP_RULES: { pattern: RegExp; name: string; category: AppCategory }[] = [
  // IDEs
  { pattern: /vs\s*code|visual\s*studio\s*code/i, name: 'VS Code', category: 'development' },
  { pattern: /intellij|webstorm|pycharm|goland|rider/i, name: 'JetBrains', category: 'development' },
  { pattern: /xcode/i, name: 'Xcode', category: 'development' },
  { pattern: /sublime\s*text/i, name: 'Sublime Text', category: 'development' },
  { pattern: /vim|neovim|nvim/i, name: 'Vim', category: 'development' },
  { pattern: /cursor/i, name: 'Cursor', category: 'development' },

  // Terminals
  { pattern: /terminal|iterm|warp|hyper|kitty|alacritty|console/i, name: 'Terminal', category: 'development' },

  // Browsers
  { pattern: /chrome|chromium/i, name: 'Chrome', category: 'browsing' },
  { pattern: /firefox/i, name: 'Firefox', category: 'browsing' },
  { pattern: /safari/i, name: 'Safari', category: 'browsing' },
  { pattern: /arc\s*browser|arc/i, name: 'Arc', category: 'browsing' },
  { pattern: /edge/i, name: 'Edge', category: 'browsing' },
  { pattern: /brave/i, name: 'Brave', category: 'browsing' },

  // Communication
  { pattern: /slack/i, name: 'Slack', category: 'communication' },
  { pattern: /discord/i, name: 'Discord', category: 'communication' },
  { pattern: /microsoft\s*teams|teams/i, name: 'Teams', category: 'communication' },
  { pattern: /zoom/i, name: 'Zoom', category: 'communication' },
  { pattern: /google\s*meet/i, name: 'Google Meet', category: 'communication' },
  { pattern: /whatsapp/i, name: 'WhatsApp', category: 'communication' },
  { pattern: /telegram/i, name: 'Telegram', category: 'communication' },
  { pattern: /messages/i, name: 'Messages', category: 'communication' },

  // Documents
  { pattern: /notion/i, name: 'Notion', category: 'documents' },
  { pattern: /obsidian/i, name: 'Obsidian', category: 'documents' },
  { pattern: /google\s*docs/i, name: 'Google Docs', category: 'documents' },
  { pattern: /microsoft\s*word|word/i, name: 'Word', category: 'documents' },
  { pattern: /pages/i, name: 'Pages', category: 'documents' },
  { pattern: /notes/i, name: 'Notes', category: 'documents' },
  { pattern: /google\s*sheets|excel|numbers/i, name: 'Spreadsheets', category: 'documents' },

  // Design
  { pattern: /figma/i, name: 'Figma', category: 'design' },
  { pattern: /sketch/i, name: 'Sketch', category: 'design' },
  { pattern: /photoshop/i, name: 'Photoshop', category: 'design' },
  { pattern: /illustrator/i, name: 'Illustrator', category: 'design' },
  { pattern: /canva/i, name: 'Canva', category: 'design' },

  // Email
  { pattern: /gmail/i, name: 'Gmail', category: 'email' },
  { pattern: /outlook/i, name: 'Outlook', category: 'email' },
  { pattern: /mail/i, name: 'Mail', category: 'email' },
  { pattern: /superhuman/i, name: 'Superhuman', category: 'email' },

  // Entertainment
  { pattern: /youtube/i, name: 'YouTube', category: 'entertainment' },
  { pattern: /netflix/i, name: 'Netflix', category: 'entertainment' },
  { pattern: /twitch/i, name: 'Twitch', category: 'entertainment' },
  { pattern: /spotify/i, name: 'Spotify', category: 'entertainment' },
  { pattern: /twitter|x\.com/i, name: 'Twitter/X', category: 'entertainment' },
  { pattern: /reddit/i, name: 'Reddit', category: 'entertainment' },
  { pattern: /instagram/i, name: 'Instagram', category: 'entertainment' },
  { pattern: /tiktok/i, name: 'TikTok', category: 'entertainment' },
];

let parseCallCount = 0;
let otherCount = 0;

export function parseSceneIndex(text: string): ParsedScene {
  parseCallCount++;
  const logThis = parseCallCount <= 30 || parseCallCount % 20 === 0;

  if (!text) {
    if (logThis) warn(TAG, `#${parseCallCount} Empty text → Unknown/other`);
    return { appName: 'Unknown', category: 'other' };
  }

  // Try structured format: [APP_NAME] | [ACTION] | [DETAILS]
  const pipeMatch = text.match(
    /\[?([^\]|]+)\]?\s*\|\s*\[?([^\]|]+)\]?\s*(?:\|\s*\[?([^\]|]*)\]?)?/,
  );
  if (pipeMatch) {
    const rawApp = pipeMatch[1].trim();
    const action = pipeMatch[2].trim();
    const details = pipeMatch[3]?.trim();
    const matched = matchApp(rawApp + ' ' + (details || ''));
    const result: ParsedScene = {
      appName: matched?.name || rawApp,
      category: matched?.category || 'other',
      action,
      details,
    };
    if (logThis) {
      log(TAG, `#${parseCallCount} pipe-format → ${result.appName} [${result.category}]`, {
        rawApp,
        action,
        matched: !!matched,
      });
    }
    if (result.category === 'other') otherCount++;
    return result;
  }

  // Try bracket format: [APP_NAME] - [ACTION] - [DETAILS]
  const dashMatch = text.match(
    /\[?([^\]\-]+)\]?\s*-\s*\[?([^\]\-]+)\]?\s*(?:-\s*\[?([^\]]*)\]?)?/,
  );
  if (dashMatch) {
    const rawApp = dashMatch[1].trim();
    const action = dashMatch[2].trim();
    const details = dashMatch[3]?.trim();
    const matched = matchApp(rawApp + ' ' + (details || ''));
    const result: ParsedScene = {
      appName: matched?.name || rawApp,
      category: matched?.category || 'other',
      action,
      details,
    };
    if (logThis) {
      log(TAG, `#${parseCallCount} dash-format → ${result.appName} [${result.category}]`, {
        rawApp,
        action,
        matched: !!matched,
      });
    }
    if (result.category === 'other') otherCount++;
    return result;
  }

  // Fallback: scan entire text for known apps
  const matched = matchApp(text);
  const result: ParsedScene = {
    appName: matched?.name || extractFirstPhrase(text),
    category: matched?.category || 'other',
    details: text,
  };

  if (result.category === 'other') {
    otherCount++;
    // Always log "other" results for the first 50 misses so we can diagnose
    if (otherCount <= 50 || otherCount % 25 === 0) {
      warn(TAG, `#${parseCallCount} UNMATCHED → other (miss #${otherCount})`, {
        textPreview: text.slice(0, 200),
        extractedApp: result.appName,
      });
    }
  } else if (logThis) {
    log(TAG, `#${parseCallCount} fulltext-scan → ${result.appName} [${result.category}]`);
  }

  return result;
}

function extractFirstPhrase(text: string): string {
  // Try to pull something meaningful from the first line
  const firstLine = text.split('\n')[0].trim();
  // If it looks like "AppName: something" or "AppName - something"
  const colonMatch = firstLine.match(/^([A-Za-z][\w\s]{1,30})(?::|–|—)/);
  if (colonMatch) return colonMatch[1].trim();
  // Just take the first 2-3 words
  const words = firstLine.split(/\s+/).slice(0, 3).join(' ');
  return words.length > 2 ? words : 'Unknown';
}

function matchApp(
  text: string,
): { name: string; category: AppCategory } | null {
  for (const rule of APP_RULES) {
    if (rule.pattern.test(text)) {
      return { name: rule.name, category: rule.category };
    }
  }
  return null;
}

export function categorizeAlert(
  label: string,
  eventName?: string,
): { appName: string; category: AppCategory } {
  const combined = `${label || ''} ${eventName || ''}`;
  const matched = matchApp(combined);
  if (!matched) {
    warn(TAG, `Alert unmatched → other`, { label, eventName });
  }
  return matched || { appName: label || 'Unknown', category: 'other' };
}

export function inferAction(sceneTexts: string[]): string {
  if (sceneTexts.length === 0) return 'unknown';
  const combined = sceneTexts.join(' ').toLowerCase();

  if (/coding|editing\s*code|writing\s*code|programming|debugging/i.test(combined)) return 'coding';
  if (/browsing|searching|navigating|web/i.test(combined)) return 'browsing';
  if (/chatting|messaging|replying|conversation/i.test(combined)) return 'chatting';
  if (/reading|reviewing|viewing\s*doc/i.test(combined)) return 'reading';
  if (/meeting|call|video\s*call|conference/i.test(combined)) return 'meeting';
  if (/writing|composing|drafting|typing\s*doc/i.test(combined)) return 'writing';
  if (/designing|prototyping|wireframing/i.test(combined)) return 'designing';
  if (/watching|streaming|playing/i.test(combined)) return 'watching';
  if (/email|inbox|reply/i.test(combined)) return 'emailing';

  return 'working';
}

export function inferProject(sceneTexts: string[]): string | undefined {
  for (const text of sceneTexts) {
    // Only extract project from IDE title bars: "project_name — VS Code" etc.
    const titleMatch = text.match(
      /([\w][\w. _-]{2,})\s*[-–—]\s*(?:VS Code|Visual Studio|Cursor|IntelliJ|WebStorm|PyCharm|GoLand|Xcode|Sublime)/i,
    );
    if (titleMatch) {
      const name = titleMatch[1].trim();
      if (isValidProject(name)) return name;
    }

    // Fallback: file path with at least two segments like /Users/x/project/src/file.ts
    // Extract the directory that looks like a project root (not src/lib/etc.)
    const pathMatch = text.match(/[\\/]([\w][\w._-]{2,})[\\/](?:src|lib|app|packages?|cmd)[\\/]/i);
    if (pathMatch && isValidProject(pathMatch[1])) return pathMatch[1];
  }
  return undefined;
}

function isValidProject(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.length < 3 || lower.length > 50) return false;
  // Reject URLs and domains
  if (/\.(com|org|io|dev|net|co|app|xyz|ai|me|tv|gg)$/i.test(lower)) return false;
  if (/^(www|http|ftp)\./i.test(lower)) return false;
  // Reject common folders and generic words
  if (REJECTED_NAMES.has(lower)) return false;
  // Reject single common English words (projects usually have compound names or underscores/hyphens)
  if (/^[a-z]+$/.test(lower) && GENERIC_WORDS.has(lower)) return false;
  return true;
}

const REJECTED_NAMES = new Set([
  'src', 'lib', 'dist', 'build', 'node_modules', 'public', 'out',
  'components', 'pages', 'utils', 'hooks', 'types', 'assets',
  'styles', 'tests', 'test', '__tests__', 'spec', 'bin', 'tmp',
  'desktop', 'downloads', 'documents', 'applications', 'users',
  'home', 'root', 'var', 'etc', 'usr', 'opt', 'volumes',
  'untitled', 'workspace', 'project', 'folder', 'file', 'new',
]);

const GENERIC_WORDS = new Set([
  'tabs', 'and', 'the', 'for', 'with', 'from', 'input', 'output',
  'start', 'stop', 'play', 'code', 'data', 'home', 'main', 'index',
  'origin', 'master', 'objects', 'functions', 'channels', 'progress',
  'space', 'search', 'system', 'network', 'process', 'processor',
  'movies', 'ctrl', 'experiments', 'temporal', 'latency', 'humanoid',
  'conversations', 'debugging', 'coding', 'browsing', 'reading',
  'meeting', 'designing', 'learning', 'working', 'watching',
]);

export function getParseStats(): { totalParsed: number; totalOther: number } {
  return { totalParsed: parseCallCount, totalOther: otherCount };
}
