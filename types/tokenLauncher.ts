/**
 * Token Launcher API Types
 * For deploying tokens on Base blockchain paired with WASS
 */

export interface LauncherStatus {
  status: 'ready' | 'busy' | 'error';
  wallet: string;
  capabilities: {
    uploadImage: boolean;
    launchToken: boolean;
    wassPariring: boolean;
    sseProgress: boolean;
  };
  config: {
    wassAddress: string;
    startingTick: number;
    estimatedMcap: string;
    devBuyDefault: string;
  };
}

export interface LaunchParams {
  name: string;
  symbol: string;
  description?: string;
  image?: File | string;
  website?: string;
  twitter?: string;
  initialBuyEth?: number;
}

export interface LaunchResult {
  success: boolean;
  txHash?: string;
  tokenAddress?: string;
  launchId?: string;
  error?: string;
}

export interface UploadResult {
  success: boolean;
  cid?: string;
  ipfsUrl?: string;
  gatewayUrl?: string;
  launchId?: string;
  error?: string;
}

export type LaunchStatus = 'idle' | 'pending' | 'uploading' | 'deploying' | 'confirming' | 'complete' | 'error';

export interface LaunchProgressData {
  cid?: string;
  ipfsUrl?: string;
  txHash?: string;
  tokenAddress?: string;
  dexscreener?: string;
  basescan?: string;
}

export interface LaunchProgress {
  status: LaunchStatus;
  step: number;
  totalSteps: number;
  message: string;
  data?: LaunchProgressData;
  error?: string;
}

export interface SSEProgressEvent {
  launchId: string;
  status: LaunchStatus;
  step: number;
  totalSteps: number;
  message: string;
  data?: LaunchProgressData;
  error?: string;
  timestamp: number;
}
