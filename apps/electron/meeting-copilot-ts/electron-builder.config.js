const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'com.videodb.meeting-copilot-ts',
  productName: 'Meeting Copilot',
  directories: {
    output: 'release',
    buildResources: 'resources',
  },
  files: [
    'dist/**/*',
    'package.json',
    'node_modules/**/*',
    '!node_modules/*/{CHANGELOG.md,README.md,readme.md,README,readme}',
    '!node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
    '!node_modules/.cache/**/*',
    '!**/*.{ts,tsx,map,md}',
  ],
  extraResources: [
    {
      from: 'resources/',
      to: 'resources/',
      filter: ['**/*', '!.gitkeep'],
    },
  ],
  asar: true,
  asarUnpack: [
    'node_modules/better-sqlite3/**/*',
    'node_modules/bindings/**/*',
    'node_modules/file-uri-to-path/**/*',
    'node_modules/cloudflared/**/*',
    'node_modules/videodb/**/*',
  ],
  npmRebuild: true,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['arm64'], // Build for current arch first, can add x64 or universal later
      },
    ],
    category: 'public.app-category.productivity',
    icon: 'resources/icon.icns',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Meeting Copilot needs microphone access to record audio.',
      NSCameraUsageDescription: 'Meeting Copilot needs camera access to record video.',
      NSScreenCaptureUsageDescription:
        'Meeting Copilot needs screen capture access to record your screen.',
    },
  },
  dmg: {
    title: 'Meeting Copilot ${version}',
    icon: 'resources/icon.icns',
    window: {
      width: 540,
      height: 380,
    },
    contents: [
      {
        x: 140,
        y: 200,
        type: 'file',
      },
      {
        x: 400,
        y: 200,
        type: 'link',
        path: '/Applications',
      },
    ],
  },
  win: {
    target: ['nsis'],
    icon: 'resources/icon.ico',
  },
  linux: {
    target: ['AppImage'],
    category: 'Office',
  },
  afterPack: async (context) => {
    const appOutDir = context.appOutDir;
    const platform = context.packager.platform.name;

    console.log('After pack:', appOutDir);
    console.log('Platform:', platform);

    if (platform === 'mac') {
      const appName = context.packager.appInfo.productFilename;
      const resourcesPath = path.join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
      const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked');

      // Verify unpacked binaries exist
      const videodbBinPath = path.join(unpackedPath, 'node_modules', 'videodb', 'bin');
      const cloudflaredBinPath = path.join(unpackedPath, 'node_modules', 'cloudflared', 'bin');

      console.log('Checking videodb binaries at:', videodbBinPath);
      console.log('Checking cloudflared binaries at:', cloudflaredBinPath);

      // Check and fix videodb recorder binary
      const recorderPath = path.join(videodbBinPath, 'recorder');
      const librecorderPath = path.join(videodbBinPath, 'librecorder.dylib');

      if (fs.existsSync(recorderPath)) {
        console.log('Found recorder binary');

        // Check architecture
        try {
          const fileOutput = execSync(`file "${recorderPath}"`).toString();
          console.log('Recorder binary type:', fileOutput.trim());

          // Warn if architecture mismatch
          const targetArch = context.arch;
          if (targetArch === 'arm64' && fileOutput.includes('x86_64') && !fileOutput.includes('arm64')) {
            console.warn('WARNING: Recorder binary is x86_64 but building for arm64!');
            console.warn('The binary will run under Rosetta 2, which may cause issues.');
            console.warn('Consider requesting arm64 binaries from the videodb package maintainers.');
          }

          // Ensure executable permissions
          fs.chmodSync(recorderPath, 0o755);
          console.log('Set recorder binary permissions to 755');
        } catch (error) {
          console.error('Error checking recorder binary:', error.message);
        }
      } else {
        console.error('ERROR: Recorder binary not found at', recorderPath);
      }

      if (fs.existsSync(librecorderPath)) {
        console.log('Found librecorder.dylib');
        // Ensure readable permissions
        fs.chmodSync(librecorderPath, 0o644);
        console.log('Set librecorder.dylib permissions to 644');
      } else {
        console.error('ERROR: librecorder.dylib not found at', librecorderPath);
      }

      // Check cloudflared binary
      const cloudflaredPath = path.join(cloudflaredBinPath, 'cloudflared');
      if (fs.existsSync(cloudflaredPath)) {
        console.log('Found cloudflared binary');

        try {
          const fileOutput = execSync(`file "${cloudflaredPath}"`).toString();
          console.log('Cloudflared binary type:', fileOutput.trim());

          // Ensure executable permissions
          fs.chmodSync(cloudflaredPath, 0o755);
          console.log('Set cloudflared binary permissions to 755');
        } catch (error) {
          console.error('Error checking cloudflared binary:', error.message);
        }
      } else {
        console.error('ERROR: cloudflared binary not found at', cloudflaredPath);
      }

      // Check better-sqlite3 native module
      const betterSqlitePath = path.join(
        unpackedPath,
        'node_modules',
        'better-sqlite3',
        'build',
        'Release',
        'better_sqlite3.node'
      );
      if (fs.existsSync(betterSqlitePath)) {
        console.log('Found better-sqlite3 native module');
      } else {
        console.warn('WARNING: better-sqlite3 native module not found');
      }
    }
  },
};

module.exports = config;
