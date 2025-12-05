/**
 * Hook for launching tokens via the AppleSnakes backend API
 * Supports image upload, token deployment, and SSE progress tracking
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  LaunchParams,
  LaunchResult,
  LaunchProgress,
  LauncherStatus,
  UploadResult,
} from '@/types/tokenLauncher';

// Use local proxy routes to avoid CORS
const LAUNCHER_API_URL = '/api/token-launcher';
const LAUNCHER_STREAM_URL = '/api/token-launcher/stream';

interface UseTokenLauncherReturn {
  /** Current launch progress */
  progress: LaunchProgress;
  /** Whether a launch is in progress */
  isLaunching: boolean;
  /** Launcher status from backend */
  launcherStatus: LauncherStatus | null;
  /** Launch a new token */
  launchToken: (params: LaunchParams) => Promise<LaunchResult>;
  /** Upload image only (returns IPFS URL) */
  uploadImage: (file: File) => Promise<UploadResult>;
  /** Check launcher status */
  checkStatus: () => Promise<LauncherStatus | null>;
  /** Reset state for new launch */
  reset: () => void;
}

const initialProgress: LaunchProgress = {
  status: 'idle',
  step: 0,
  totalSteps: 0,
  message: '',
};

export function useTokenLauncher(): UseTokenLauncherReturn {
  const [progress, setProgress] = useState<LaunchProgress>(initialProgress);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatus | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Check launcher status
  const checkStatus = useCallback(async (): Promise<LauncherStatus | null> => {
    try {
      const response = await fetch(LAUNCHER_API_URL);
      if (!response.ok) {
        console.error('Failed to fetch launcher status:', response.status);
        return null;
      }
      const data = await response.json();
      setLauncherStatus(data);
      return data;
    } catch (error) {
      console.error('Error checking launcher status:', error);
      return null;
    }
  }, []);

  // Connect to SSE stream for progress updates
  const connectToStream = useCallback((launchId: string) => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`${LAUNCHER_STREAM_URL}?launchId=${launchId}`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('progress', (event) => {
      try {
        const data = JSON.parse(event.data);
        setProgress({
          status: data.status,
          step: data.step,
          totalSteps: data.totalSteps,
          message: data.message,
          data: data.data,
          error: data.error,
        });

        // Close on completion or error
        if (data.status === 'complete' || data.status === 'error') {
          eventSource.close();
          setIsLaunching(false);
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    });

    eventSource.addEventListener('connected', () => {
      console.log('Connected to launch progress stream');
    });

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      eventSource.close();
      // Don't set isLaunching to false on error - the launch might still succeed
    };
  }, []);

  // Upload image only
  const uploadImage = useCallback(async (file: File): Promise<UploadResult> => {
    try {
      const formData = new FormData();
      formData.append('action', 'upload');
      formData.append('file', file);

      const response = await fetch(LAUNCHER_API_URL, {
        method: 'POST',
        body: formData,
      });

      return await response.json();
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }, []);

  // Launch token
  const launchToken = useCallback(async (params: LaunchParams): Promise<LaunchResult> => {
    setIsLaunching(true);
    setProgress({
      status: 'pending',
      step: 0,
      totalSteps: params.image instanceof File ? 4 : 3,
      message: 'Starting token launch...',
    });

    try {
      let response: Response;

      // Use FormData if image is a File
      if (params.image instanceof File) {
        const formData = new FormData();
        formData.append('action', 'launch');
        formData.append('name', params.name);
        formData.append('symbol', params.symbol);
        formData.append('file', params.image);
        if (params.description) formData.append('description', params.description);
        if (params.website) formData.append('website', params.website);
        if (params.twitter) formData.append('twitter', params.twitter);
        if (params.initialBuyEth !== undefined) {
          formData.append('initialBuyEth', String(params.initialBuyEth));
        }

        response = await fetch(LAUNCHER_API_URL, {
          method: 'POST',
          body: formData,
        });
      } else {
        // Use JSON for string image URL or no image
        response = await fetch(LAUNCHER_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'launch',
            name: params.name,
            symbol: params.symbol,
            description: params.description,
            image: params.image,
            website: params.website,
            twitter: params.twitter,
            initialBuyEth: params.initialBuyEth ?? 0.0001,
          }),
        });
      }

      const result = await response.json();

      // Connect to SSE stream for progress updates
      if (result.launchId) {
        connectToStream(result.launchId);
      }

      if (!result.success) {
        setProgress(prev => ({
          ...prev,
          status: 'error',
          message: result.error || 'Launch failed',
          error: result.error,
        }));
        setIsLaunching(false);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setProgress({
        status: 'error',
        step: 0,
        totalSteps: 0,
        message: errorMessage,
        error: errorMessage,
      });
      setIsLaunching(false);
      return { success: false, error: errorMessage };
    }
  }, [connectToStream]);

  // Reset state
  const reset = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setProgress(initialProgress);
    setIsLaunching(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Check status on mount
  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return {
    progress,
    isLaunching,
    launcherStatus,
    launchToken,
    uploadImage,
    checkStatus,
    reset,
  };
}
