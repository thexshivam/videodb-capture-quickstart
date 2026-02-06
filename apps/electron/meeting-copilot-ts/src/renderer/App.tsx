import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { MainContent } from './components/layout/MainContent';
import { AuthModal } from './components/auth/AuthModal';
import { SessionControls } from './components/recording/SessionControls';
import { TranscriptionPanel } from './components/transcription/TranscriptionPanel';
import { HistoryView } from './components/history/HistoryView';
import { useConfigStore } from './stores/config.store';
import { usePermissions } from './hooks/usePermissions';
import { useGlobalRecorderEvents } from './hooks/useGlobalRecorderEvents';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Button } from './components/ui/button';
import { AlertCircle, Shield } from 'lucide-react';

type Tab = 'recording' | 'history' | 'settings';

function PermissionsView() {
  const { status, requestMicPermission, requestScreenPermission, openSettings } = usePermissions();

  return (
    <div className="max-w-md mx-auto">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Permissions Required</CardTitle>
          </div>
          <CardDescription>
            Meeting Copilot needs access to record your screen and microphone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <p className="font-medium text-sm">Microphone</p>
              <p className="text-xs text-muted-foreground">Required for voice recording</p>
            </div>
            {status.microphone ? (
              <span className="text-xs text-green-600 font-medium">Granted</span>
            ) : (
              <Button size="sm" onClick={requestMicPermission}>
                Grant
              </Button>
            )}
          </div>

          <div className="flex items-center justify-between p-3 rounded-lg border">
            <div>
              <p className="font-medium text-sm">Screen Recording</p>
              <p className="text-xs text-muted-foreground">Required for screen capture</p>
            </div>
            {status.screen ? (
              <span className="text-xs text-green-600 font-medium">Granted</span>
            ) : (
              <Button size="sm" onClick={() => openSettings('screen')}>
                Open Settings
              </Button>
            )}
          </div>

          {!status.screen && (
            <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
              <AlertCircle className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Screen Recording permission must be granted in System Preferences. Click "Open
                Settings" and enable Meeting Copilot in the list.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsView() {
  const configStore = useConfigStore();

  return (
    <div className="max-w-md mx-auto space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div>
            <p className="text-sm text-muted-foreground">Name</p>
            <p className="font-medium">{configStore.userName || 'Not set'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">API Key</p>
            <p className="font-mono text-xs">
              {configStore.apiKey ? `${configStore.apiKey.slice(0, 8)}...` : 'Not set'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Meeting Copilot is a desktop app for recording meetings with real-time transcription
            and AI-powered insights.
          </p>
          <p className="text-xs text-muted-foreground">
            Built with Electron, React, and VideoDB.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('recording');
  const [showAuthModal, setShowAuthModal] = useState(false);

  const configStore = useConfigStore();
  const { allGranted, loading: permissionsLoading } = usePermissions();

  // Global listener for recorder events - persists during navigation
  useGlobalRecorderEvents();

  const isAuthenticated = configStore.isAuthenticated();

  useEffect(() => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
    }
  }, [isAuthenticated]);

  const getTitle = () => {
    switch (activeTab) {
      case 'recording':
        return 'Recording';
      case 'history':
        return 'History';
      case 'settings':
        return 'Settings';
    }
  };

  const renderContent = () => {
    if (!isAuthenticated) {
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Please sign in to continue</p>
        </div>
      );
    }

    if (permissionsLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Checking permissions...</p>
        </div>
      );
    }

    if (!allGranted && activeTab === 'recording') {
      return <PermissionsView />;
    }

    switch (activeTab) {
      case 'recording':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
            <div className="space-y-6">
              <SessionControls />
            </div>
            <div className="h-full min-h-[400px]">
              <TranscriptionPanel />
            </div>
          </div>
        );
      case 'history':
        return <HistoryView />;
      case 'settings':
        return <SettingsView />;
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {isAuthenticated && <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />}
      <MainContent title={getTitle()}>{renderContent()}</MainContent>

      <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
    </div>
  );
}
