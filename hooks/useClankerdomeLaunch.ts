// hooks/useClankerdomeLaunch.ts
'use client';

import { useState, useCallback } from 'react';

const API_BASE_URL = 'https://api.applesnakes.com';

interface LaunchProgress {
  status: 'idle' | 'uploading' | 'creating' | 'active' | 'error';
  step: number;
  totalSteps: number;
  message: string;
}

export interface Launch {
  id: string;
  name: string;
  symbol: string;
  description?: string;
  imageUrl?: string;
  createdAt: number;
  endsAt: number;
  timeRemainingMs: number;
  timeRemainingFormatted: string;
  status: string;
  isActive: boolean;
  targetAmount?: number;
  totalRaised: number;
  participantCount: number;
  creatorWallet: string;
  tokenAddress?: string;
}

interface LauncherConfig {
  presaleDuration: string;
  tokenPairing: string;
  wassAddress: string;
  feeStructure: {
    total: string;
    aiAgent: string;
    creator: string;
    protocol: string;
  };
}

interface LauncherStats {
  totalLaunches: number;
  activeLaunches: number;
  totalRaisedUsdc: number;
  totalParticipants: number;
}

interface LauncherStatus {
  status: string;
  wallet: string;
  capabilities: {
    createLaunch: boolean;
    uploadImage: boolean;
    executeLaunch: boolean;
    predictionMarkets: boolean;
    sseProgress: boolean;
  };
  config: LauncherConfig;
  stats: LauncherStats;
  currentLaunches: Launch[];
}

interface CreateLaunchParams {
  name: string;
  symbol: string;
  description?: string;
  creatorWallet: string;
  image?: File | string;
  targetAmount?: number;
  durationHours?: number;
}

export function useClankerdomeLaunch() {
  const [progress, setProgress] = useState<LaunchProgress>({
    status: 'idle',
    step: 0,
    totalSteps: 0,
    message: ''
  });
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launcherStatus, setLauncherStatus] = useState<LauncherStatus | null>(null);

  // Fetch launcher status and current launches
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`);
      const data = await response.json();
      setLauncherStatus(data);
      return data;
    } catch (err) {
      console.error('Failed to fetch launcher status:', err);
      return null;
    }
  }, []);

  // Create a new launch party
  const createLaunch = useCallback(async (params: CreateLaunchParams) => {
    setError(null);
    setProgress({ status: 'uploading', step: 1, totalSteps: 3, message: 'Starting launch creation...' });

    try {
      let body: FormData | string;
      let headers: HeadersInit = {};

      if (params.image instanceof File) {
        // Use FormData for file upload
        const formData = new FormData();
        formData.append('action', 'create');
        formData.append('name', params.name);
        formData.append('symbol', params.symbol);
        formData.append('creatorWallet', params.creatorWallet);
        if (params.description) formData.append('description', params.description);
        if (params.targetAmount) formData.append('targetAmount', params.targetAmount.toString());
        if (params.durationHours) formData.append('durationHours', params.durationHours.toString());
        formData.append('file', params.image);
        body = formData;
      } else {
        // Use JSON
        headers = { 'Content-Type': 'application/json' };
        body = JSON.stringify({
          action: 'create',
          name: params.name,
          symbol: params.symbol,
          description: params.description,
          creatorWallet: params.creatorWallet,
          image: params.image,
          targetAmount: params.targetAmount,
          durationHours: params.durationHours
        });
      }

      setProgress({ status: 'creating', step: 2, totalSteps: 3, message: 'Creating launch party...' });

      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
        method: 'POST',
        headers,
        body
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Launch creation failed');
      }

      setLaunch(result.launch);
      setProgress({
        status: 'active',
        step: 3,
        totalSteps: 3,
        message: 'Launch party created! 24-hour presale is now active.'
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      setProgress({
        status: 'error',
        step: 0,
        totalSteps: 3,
        message
      });
      throw err;
    }
  }, []);

  // Upload image only
  const uploadImage = useCallback(async (file: File, fileName?: string) => {
    setError(null);
    setProgress({ status: 'uploading', step: 1, totalSteps: 1, message: 'Uploading image...' });

    try {
      const formData = new FormData();
      formData.append('action', 'upload');
      formData.append('file', file);
      if (fileName) formData.append('fileName', fileName);

      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      setProgress({ status: 'idle', step: 1, totalSteps: 1, message: 'Image uploaded!' });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      setProgress({ status: 'error', step: 0, totalSteps: 1, message });
      throw err;
    }
  }, []);

  // Check launch status
  const checkLaunchStatus = useCallback(async (launchId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/clankerdome/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'status',
          launchId
        })
      });

      const result = await response.json();
      if (result.launch) {
        setLaunch(result.launch);
      }
      return result;
    } catch (err) {
      console.error('Failed to check launch status:', err);
      return null;
    }
  }, []);

  // Subscribe to SSE progress stream
  const subscribeToProgress = useCallback((launchId: string, onProgress: (data: LaunchProgress) => void) => {
    const eventSource = new EventSource(
      `${API_BASE_URL}/api/clankerdome/launch/stream?launchId=${launchId}`
    );

    eventSource.addEventListener('connected', (e) => {
      console.log('SSE Connected:', JSON.parse(e.data));
    });

    eventSource.addEventListener('progress', (e) => {
      const progressData = JSON.parse(e.data);
      setProgress(progressData);
      onProgress(progressData);

      // Close on completion or error
      if (progressData.status === 'complete' || progressData.status === 'error') {
        eventSource.close();
      }
    });

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => eventSource.close();
  }, []);

  const reset = useCallback(() => {
    setProgress({ status: 'idle', step: 0, totalSteps: 0, message: '' });
    setLaunch(null);
    setError(null);
  }, []);

  return {
    progress,
    launch,
    error,
    launcherStatus,
    createLaunch,
    uploadImage,
    checkLaunchStatus,
    fetchStatus,
    subscribeToProgress,
    reset,
    isLoading: progress.status === 'uploading' || progress.status === 'creating'
  };
}
