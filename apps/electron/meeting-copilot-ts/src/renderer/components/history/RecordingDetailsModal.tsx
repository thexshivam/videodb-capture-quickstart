import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Play, ExternalLink, Clock, FileText, Video } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import type { Recording } from '../../../shared/schemas/recording.schema';
import { formatDuration, formatRelativeTime } from '../../lib/utils';
import { electronAPI } from '../../api/ipc';

interface RecordingDetailsModalProps {
  recording: Recording | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecordingDetailsModal({
  recording,
  open,
  onOpenChange,
}: RecordingDetailsModalProps) {
  if (!recording) return null;

  const handlePlay = async () => {
    if (recording.playerUrl && electronAPI) {
      await electronAPI.app.openPlayerWindow(recording.playerUrl);
    }
  };

  const handleOpenExternal = async () => {
    if (recording.playerUrl && electronAPI) {
      await electronAPI.app.openExternalLink(recording.playerUrl);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Video className="h-5 w-5" />
            Recording Details
          </DialogTitle>
          <DialogDescription>Session: {recording.sessionId}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6">
            {/* Status and Metadata */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Status</p>
                <Badge
                  variant={
                    recording.status === 'available'
                      ? 'success'
                      : recording.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {recording.status}
                </Badge>
              </div>

              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Created</p>
                <p className="text-sm flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(recording.createdAt)}
                </p>
              </div>

              {recording.duration && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Duration</p>
                  <p className="text-sm flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {formatDuration(recording.duration)}
                  </p>
                </div>
              )}

              {recording.videoId && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Video ID</p>
                  <p className="text-sm font-mono text-xs">{recording.videoId}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {recording.status === 'available' && recording.playerUrl && (
              <div className="flex gap-2">
                <Button onClick={handlePlay}>
                  <Play className="h-4 w-4 mr-2" />
                  Play in App
                </Button>
                <Button variant="outline" onClick={handleOpenExternal}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in Browser
                </Button>
              </div>
            )}

            {/* Insights */}
            {recording.insightsStatus === 'ready' && recording.insights && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">AI Summary</p>
                <div className="bg-muted rounded-lg p-4 prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown
                    components={{
                      // Style headings
                      h2: ({ children }) => (
                        <h2 className="text-base font-semibold mt-4 mb-2 first:mt-0">{children}</h2>
                      ),
                      h3: ({ children }) => (
                        <h3 className="text-sm font-semibold mt-3 mb-1">{children}</h3>
                      ),
                      // Style lists
                      ul: ({ children }) => (
                        <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>
                      ),
                      li: ({ children }) => (
                        <li className="text-sm">{children}</li>
                      ),
                      // Style paragraphs
                      p: ({ children }) => (
                        <p className="text-sm my-2">{children}</p>
                      ),
                    }}
                  >
                    {recording.insights}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {recording.insightsStatus === 'processing' && (
              <div className="bg-muted rounded-lg p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Generating AI insights... This may take a moment.
                </p>
              </div>
            )}

            {recording.insightsStatus === 'failed' && (
              <div className="bg-destructive/10 rounded-lg p-4 text-center">
                <p className="text-sm text-destructive">
                  Failed to generate insights for this recording.
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
