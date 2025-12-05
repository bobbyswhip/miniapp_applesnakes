# Status API Implementation Guide

## Overview

The `/api/status` endpoint provides real-time server information for frontend dashboards. It's rate-limited (1 req/sec, 10 req/min) and returns comprehensive system status.

## Endpoint

```
GET /api/status
```

**Base URL**: `https://api.applesnakes.com/api/status` 
## Rate Limits

| Limit | Value | Behavior |
|-------|-------|----------|
| Per Second | 1 request | Returns 429 if exceeded |
| Per Minute | 10 requests | Returns 429 if exceeded |
| Ban | None | Just denies, auto-recovers |

**Recommended polling interval**: 6-10 seconds (safe margin within limits)

## Response Headers

```
X-RateLimit-Limit-Second: 1
X-RateLimit-Limit-Minute: 10
X-RateLimit-Remaining-Second: 0
X-RateLimit-Remaining-Minute: 8
Retry-After: 1  (only on 429 responses)
```

---

## Response Structure

```typescript
interface StatusResponse {
  success: boolean;
  timestamp: string;  // ISO 8601
  availableProviders: string[];
  status: {
    server: ServerStatus;
    memory: MemoryStatus;
    rateLimiter: RateLimiterStatus;
    wallet: WalletStatus;
    tokenLauncher: TokenLauncherStatus;
    services: ServicesStatus;
    features: FeaturesStatus;
  };
}
```

---

## Status Providers Explained

### 1. Server Status (`status.server`)

**Purpose**: Core server health and uptime information

```typescript
interface ServerStatus {
  status: "online" | "degraded" | "offline";
  startedAt: string;      // ISO timestamp when server started
  currentTime: string;    // Current server time
  uptime: {
    ms: number;           // Raw milliseconds
    formatted: string;    // Human readable: "2d 5h 30m" or "45m 12s"
  };
  nodeVersion: string;    // e.g., "v20.19.5"
  platform: string;       // e.g., "linux", "win32", "darwin"
  environment: string;    // "production" or "development"
}
```

**Display Recommendations**:
- Show `status` as a colored indicator (green=online, yellow=degraded, red=offline)
- Display `uptime.formatted` prominently
- Show `environment` as a badge (useful to distinguish prod/dev)

**Example UI**:
```
[🟢 Online] Server Uptime: 2d 5h 30m
Environment: production | Node v20.19.5
```

---

### 2. Memory Status (`status.memory`)

**Purpose**: Server memory usage monitoring

```typescript
interface MemoryStatus {
  heapUsed: string;       // "139.09 MB" - Active JS memory
  heapTotal: string;      // "162.11 MB" - Total allocated heap
  external: string;       // "3.55 MB" - C++ objects bound to JS
  rss: string;            // "273.55 MB" - Total process memory
  heapUsedBytes: number;  // Raw bytes for calculations
  heapTotalBytes: number; // Raw bytes for calculations
}
```

**Display Recommendations**:
- Show heap usage as a progress bar: `heapUsedBytes / heapTotalBytes`
- Alert if heap usage > 80%
- RSS is the "real" memory footprint

**Example UI**:
```
Memory Usage
├─ Heap: 139.09 MB / 162.11 MB [████████░░] 86%
└─ Total RSS: 273.55 MB
```

**Calculation for percentage**:
```typescript
const heapPercent = (status.memory.heapUsedBytes / status.memory.heapTotalBytes) * 100;
```

---

### 3. Rate Limiter Status (`status.rateLimiter`)

**Purpose**: Monitor API rate limiting activity

```typescript
interface RateLimiterStatus {
  trackedIPs: number;     // Number of IPs currently tracked
  limits: {
    perSecond: number;    // Max requests per second (1)
    perMinute: number;    // Max requests per minute (10)
  };
}
```

**Display Recommendations**:
- Show tracked IPs count (indicates active users)
- Display limits for reference

**Example UI**:
```
Rate Limiter: 5 active IPs
Limits: 1/sec, 10/min
```

---

### 4. Wallet Status (`status.wallet`)

**Purpose**: Admin wallet configuration status

```typescript
interface WalletStatus {
  configured: boolean;    // Whether wallet is set up
  address: string | null; // Masked address: "0xE5e9...0098"
  network: string;        // "base-mainnet" or "base-sepolia"
}
```

**Display Recommendations**:
- Show configuration status as indicator
- Display masked address (already masked for security)
- Show network prominently (important for users to know mainnet vs testnet)

**Example UI**:
```
Wallet: 0xE5e9...0098
Network: base-mainnet [🔵 Mainnet]
```

---

### 5. Token Launcher Status (`status.tokenLauncher`)

**Purpose**: Token deployment system configuration

```typescript
interface TokenLauncherStatus {
  enabled: boolean;                    // Whether launcher is operational
  wassAddress: string;                 // WASS token address
  currentTick: number;                 // Pool tick (-276200 = ~$10 mcap)
  devBuyHook: string;                  // ETH-WASS swap hook address
}
```

**Tick to Market Cap Reference**:
| Tick | Approx Market Cap |
|------|------------------|
| -161200 | ~$1,000 |
| -230400 | ~$100 |
| -276200 | ~$10 |
| -322000 | ~$1 |

**Display Recommendations**:
- Show enabled status
- Convert tick to human-readable market cap
- Show hook address (useful for debugging)

**Example UI**:
```
Token Launcher: ✅ Enabled
Starting Market Cap: ~$10 (tick: -276200)
WASS Pool: 0x445040...
Dev Buy Hook: 0x1E0c81...
```

**Helper function**:
```typescript
function tickToMarketCap(tick: number): string {
  if (tick >= -161200) return "~$1,000+";
  if (tick >= -230400) return "~$100";
  if (tick >= -276200) return "~$10";
  if (tick >= -322000) return "~$1";
  return "<$1";
}
```

---

### 6. Services Status (`status.services`)

**Purpose**: External service connectivity status

```typescript
interface ServicesStatus {
  openai: { configured: boolean };    // AI for game decisions
  cdp: { configured: boolean };       // Coinbase Developer Platform
  filebase: { configured: boolean };  // IPFS image storage
  twilio: { configured: boolean };    // SMS alerts
}
```

**Display Recommendations**:
- Show as a grid of service indicators
- Green check for configured, gray X for not configured
- Twilio is optional (SMS alerts)

**Example UI**:
```
External Services
├─ OpenAI:   ✅ Connected
├─ CDP:      ✅ Connected
├─ Filebase: ✅ Connected
└─ Twilio:   ❌ Not configured
```

---

### 7. Features Status (`status.features`)

**Purpose**: Feature flags showing what's enabled

```typescript
interface FeaturesStatus {
  autonomousPlayer: boolean;   // Auto-play blackjack
  tokenLauncher: boolean;      // Token deployment
  wassPoolsV4: boolean;        // Uniswap V4 WASS pools
  smsAlerts: boolean;          // SMS notifications
  adminDashboard: boolean;     // Admin UI access
}
```

**Display Recommendations**:
- Show as feature toggles or badges
- Highlight important features
- Can be used to conditionally show/hide UI sections

**Example UI**:
```
Features
[✅ Autonomous Player] [✅ Token Launcher] [✅ WASS Pools]
[❌ SMS Alerts] [✅ Admin Dashboard]
```

---

## Frontend Implementation

### React Hook Example

```typescript
import { useState, useEffect, useCallback } from 'react';

interface StatusData {
  success: boolean;
  timestamp: string;
  status: {
    server: any;
    memory: any;
    wallet: any;
    tokenLauncher: any;
    services: any;
    features: any;
    rateLimiter: any;
  };
}

export function useServerStatus(pollInterval = 10000) {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rateLimited, setRateLimited] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status');

      if (response.status === 429) {
        setRateLimited(true);
        const retryAfter = response.headers.get('Retry-After');
        // Wait and retry
        setTimeout(fetchStatus, (parseInt(retryAfter || '1') + 1) * 1000);
        return;
      }

      setRateLimited(false);
      const json = await response.json();

      if (json.success) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || 'Unknown error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, pollInterval);
    return () => clearInterval(interval);
  }, [fetchStatus, pollInterval]);

  return { data, error, loading, rateLimited, refetch: fetchStatus };
}
```

### React Component Example

```tsx
import { useServerStatus } from './useServerStatus';

function ServerStatusDashboard() {
  const { data, error, loading, rateLimited } = useServerStatus(10000);

  if (loading) return <div>Loading status...</div>;
  if (error) return <div className="error">Error: {error}</div>;
  if (!data) return null;

  const { server, memory, wallet, tokenLauncher, services, features } = data.status;

  // Calculate heap percentage
  const heapPercent = Math.round(
    (memory.heapUsedBytes / memory.heapTotalBytes) * 100
  );

  return (
    <div className="status-dashboard">
      {rateLimited && (
        <div className="warning">Rate limited - waiting to retry...</div>
      )}

      {/* Server Status */}
      <section className="status-section">
        <h2>Server</h2>
        <div className={`status-indicator ${server.status}`}>
          {server.status.toUpperCase()}
        </div>
        <p>Uptime: {server.uptime.formatted}</p>
        <p>Environment: {server.environment}</p>
      </section>

      {/* Memory */}
      <section className="status-section">
        <h2>Memory</h2>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${heapPercent}%` }}
          />
        </div>
        <p>{memory.heapUsed} / {memory.heapTotal} ({heapPercent}%)</p>
      </section>

      {/* Wallet */}
      <section className="status-section">
        <h2>Wallet</h2>
        {wallet.configured ? (
          <>
            <p>Address: {wallet.address}</p>
            <p>Network: {wallet.network}</p>
          </>
        ) : (
          <p className="warning">Not configured</p>
        )}
      </section>

      {/* Token Launcher */}
      <section className="status-section">
        <h2>Token Launcher</h2>
        <p>Status: {tokenLauncher.enabled ? '✅ Enabled' : '❌ Disabled'}</p>
        <p>Starting MCap: {tickToMarketCap(tokenLauncher.currentTick)}</p>
      </section>

      {/* Services */}
      <section className="status-section">
        <h2>Services</h2>
        <ul>
          <li>OpenAI: {services.openai.configured ? '✅' : '❌'}</li>
          <li>CDP: {services.cdp.configured ? '✅' : '❌'}</li>
          <li>Filebase: {services.filebase.configured ? '✅' : '❌'}</li>
          <li>Twilio: {services.twilio.configured ? '✅' : '❌'}</li>
        </ul>
      </section>

      {/* Features */}
      <section className="status-section">
        <h2>Features</h2>
        <div className="feature-badges">
          {Object.entries(features).map(([key, enabled]) => (
            <span
              key={key}
              className={`badge ${enabled ? 'enabled' : 'disabled'}`}
            >
              {key}
            </span>
          ))}
        </div>
      </section>

      <footer>
        Last updated: {new Date(data.timestamp).toLocaleTimeString()}
      </footer>
    </div>
  );
}

function tickToMarketCap(tick: number): string {
  if (tick >= -161200) return "~$1,000+";
  if (tick >= -230400) return "~$100";
  if (tick >= -276200) return "~$10";
  if (tick >= -322000) return "~$1";
  return "<$1";
}
```

### CSS Example

```css
.status-dashboard {
  font-family: system-ui, sans-serif;
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.status-section {
  background: #1a1a2e;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
}

.status-section h2 {
  margin-top: 0;
  color: #a0a0ff;
}

.status-indicator {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 4px;
  font-weight: bold;
}

.status-indicator.online { background: #22c55e; color: white; }
.status-indicator.degraded { background: #eab308; color: black; }
.status-indicator.offline { background: #ef4444; color: white; }

.progress-bar {
  background: #333;
  border-radius: 4px;
  height: 20px;
  overflow: hidden;
}

.progress-fill {
  background: linear-gradient(90deg, #22c55e, #eab308);
  height: 100%;
  transition: width 0.3s ease;
}

.badge {
  display: inline-block;
  padding: 4px 8px;
  border-radius: 4px;
  margin: 4px;
  font-size: 12px;
}

.badge.enabled { background: #22c55e33; color: #22c55e; }
.badge.disabled { background: #ef444433; color: #ef4444; }

.warning { color: #eab308; }
.error { color: #ef4444; }
```

---

## Filtering Providers

Request specific providers only:

```
GET /api/status?providers=server,memory
```

Returns only requested sections:
```json
{
  "success": true,
  "timestamp": "...",
  "availableProviders": ["server", "memory", "rateLimiter", ...],
  "status": {
    "server": { ... },
    "memory": { ... }
  }
}
```

**Use case**: Lighter requests if you only need certain data.

---

## Error Handling

### Rate Limited (429)
```json
{
  "error": "Rate limit exceeded",
  "message": "Rate limit exceeded: too many requests per second",
  "retryAfter": 1,
  "limits": {
    "perSecond": { "current": 2, "max": 1 },
    "perMinute": { "current": 5, "max": 10 }
  }
}
```

**Handle by**: Wait `retryAfter` seconds, then retry.

### Server Error (500)
```json
{
  "success": false,
  "error": "Internal server error"
}
```

---

## Best Practices

1. **Poll every 10 seconds** - Safe margin within rate limits
2. **Handle 429 gracefully** - Show "updating..." instead of error
3. **Cache client-side** - Don't refetch on every component mount
4. **Use providers filter** - Request only what you need
5. **Show last update time** - Users know data freshness
6. **Color code statuses** - Quick visual scanning
