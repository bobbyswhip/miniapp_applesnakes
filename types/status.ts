/**
 * Status API Response Types
 * For the AppleSnakes backend status endpoint
 */

export interface ServerStatus {
  status: "online" | "degraded" | "offline";
  startedAt: string;
  currentTime: string;
  uptime: {
    ms: number;
    formatted: string;
  };
  nodeVersion: string;
  platform: string;
  environment: string;
}

export interface MemoryStatus {
  heapUsed: string;
  heapTotal: string;
  external: string;
  rss: string;
  heapUsedBytes: number;
  heapTotalBytes: number;
}

export interface RateLimiterStatus {
  trackedIPs: number;
  limits: {
    perSecond: number;
    perMinute: number;
  };
}

export interface WalletStatus {
  configured: boolean;
  address: string | null;
  network: string;
}

export interface TokenLauncherStatus {
  enabled: boolean;
  wassAddress: string;
  currentTick: number;
  devBuyHook: string;
}

export interface ServicesStatus {
  openai: { configured: boolean };
  cdp: { configured: boolean };
  filebase: { configured: boolean };
  twilio: { configured: boolean };
}

export interface FeaturesStatus {
  autonomousPlayer: boolean;
  tokenLauncher: boolean;
  wassPoolsV4: boolean;
  smsAlerts: boolean;
  adminDashboard: boolean;
}

export interface WatchdogCheck {
  healthy: boolean;
  lastCheck: string;
  consecutiveFailures: number;
}

export interface WatchdogStatus {
  running: boolean;
  startedAt: string | null;
  lastCheck: string | null;
  totalChecks: number;
  totalFailures: number;
  uptimeMs: number;
  uptimeFormatted: string;
  checks: {
    memory: WatchdogCheck;
    eventLoop: WatchdogCheck;
    environment: WatchdogCheck;
    uptime: WatchdogCheck;
  };
}

export interface StatusResponse {
  success: boolean;
  timestamp: string;
  availableProviders: string[];
  status: {
    server: ServerStatus;
    memory: MemoryStatus;
    rateLimiter: RateLimiterStatus;
    wallet: WalletStatus;
    tokenLauncher: TokenLauncherStatus;
    services: ServicesStatus;
    features: FeaturesStatus;
    watchdog?: WatchdogStatus;
  };
}

export interface RateLimitError {
  error: string;
  message: string;
  retryAfter: number;
  limits: {
    perSecond: { current: number; max: number };
    perMinute: { current: number; max: number };
  };
}
