import React, { useEffect, useRef } from 'react';
import { Mic, Volume2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ScrollArea } from '../ui/scroll-area';
import { Switch } from '../ui/switch';
import { useTranscriptionStore } from '../../stores/transcription.store';
import { useSessionStore } from '../../stores/session.store';
import { cn } from '../../lib/utils';

export function TranscriptionPanel() {
  const { items, enabled, pendingMic, pendingSystemAudio, setEnabled } = useTranscriptionStore();
  const { status } = useSessionStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isRecording = status === 'recording';

  // Auto-scroll to bottom when new items arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items, pendingMic, pendingSystemAudio]);

  const getSourceIcon = (source: 'mic' | 'system_audio') => {
    return source === 'mic' ? Mic : Volume2;
  };

  const getSourceLabel = (source: 'mic' | 'system_audio') => {
    return source === 'mic' ? 'You' : 'Meeting';
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Live Transcription</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={isRecording}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden">
        <ScrollArea className="h-full pr-4" ref={scrollRef}>
          {items.length === 0 && !pendingMic && !pendingSystemAudio ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
              {enabled
                ? isRecording
                  ? 'Waiting for speech...'
                  : 'Start recording to see transcription'
                : 'Enable transcription to see live text'}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => {
                const Icon = getSourceIcon(item.source);
                return (
                  <div key={item.id} className="flex gap-2">
                    <div
                      className={cn(
                        'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center',
                        item.source === 'mic' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                      )}
                    >
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {getSourceLabel(item.source)}
                      </p>
                      <p className="text-sm">{item.text}</p>
                    </div>
                  </div>
                );
              })}

              {/* Pending transcripts */}
              {pendingMic && (
                <div className="flex gap-2 opacity-60">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                    <Mic className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">You</p>
                    <p className="text-sm italic">{pendingMic}</p>
                  </div>
                </div>
              )}

              {pendingSystemAudio && (
                <div className="flex gap-2 opacity-60">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                    <Volume2 className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Meeting</p>
                    <p className="text-sm italic">{pendingSystemAudio}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
