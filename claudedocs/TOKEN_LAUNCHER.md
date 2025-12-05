# Token Launcher API Implementation Guide

## Overview

The Token Launcher API allows you to deploy tokens on Base blockchain paired with WASS through Clanker. It supports:
- Image upload to IPFS via Filebase
- Token deployment with automatic WASS pairing
- Real-time progress via Server-Sent Events (SSE)
- Dev buy (initial token purchase)

## Endpoints

### Status Check
```
GET /api/token-launcher
```

Returns launcher status and configuration.

**Response:**
```json
{
  "status": "ready",
  "wallet": "0x...",
  "capabilities": {
    "uploadImage": true,
    "launchToken": true,
    "wassPariring": true,
    "sseProgress": true
  },
  "config": {
    "wassAddress": "0x445040FfaAb67992Ba1020ec2558CD6754d83Ad6",
    "startingTick": -276200,
    "estimatedMcap": "~$10",
    "devBuyDefault": "0.0001 ETH"
  }
}
```

---

### Launch Token
```
POST /api/token-launcher
Content-Type: application/json
```

**Request Body:**
```json
{
  "action": "launch",
  "name": "My Token",
  "symbol": "MTK",
  "description": "My awesome token description",
  "image": "ipfs://Qm...",
  "website": "https://mytoken.com",
  "twitter": "@mytoken",
  "initialBuyEth": 0.0001
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| action | string | Yes | - | Must be "launch" |
| name | string | Yes | - | Token name (max 32 chars) |
| symbol | string | Yes | - | Token symbol (max 10 chars) |
| description | string | No | "Token launched via Jack AI" | Token description |
| image | string | No | - | IPFS URL (`ipfs://...`) or gateway URL |
| website | string | No | - | Project website |
| twitter | string | No | - | Twitter handle |
| initialBuyEth | number | No | 0.0001 | ETH amount for dev buy |

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "tokenAddress": "0x...",
  "launchId": "launch-1701705600000-abc123"
}
```

---

### Launch with Image Upload (Form Data)
```
POST /api/token-launcher
Content-Type: multipart/form-data
```

Use this to upload an image file and launch in one request.

**Form Fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| action | string | Yes | Must be "launch" |
| name | string | Yes | Token name |
| symbol | string | Yes | Token symbol |
| file | File | No | Image file (PNG, JPG, GIF, WebP) |
| description | string | No | Token description |
| website | string | No | Project website |
| twitter | string | No | Twitter handle |
| initialBuyEth | string | No | ETH amount as string |

---

### Upload Image Only
```
POST /api/token-launcher
Content-Type: application/json
```

**Request (URL):**
```json
{
  "action": "upload",
  "imageUrl": "https://example.com/image.png",
  "fileName": "mytoken.png"
}
```

**Request (Base64):**
```json
{
  "action": "upload",
  "base64": "data:image/png;base64,iVBORw0KGgo...",
  "fileName": "mytoken.png"
}
```

**Request (Form Data):**
```
POST /api/token-launcher
Content-Type: multipart/form-data

action=upload
file=[File]
fileName=mytoken.png
```

**Response:**
```json
{
  "success": true,
  "cid": "QmXoypiz...",
  "ipfsUrl": "ipfs://QmXoypiz...",
  "gatewayUrl": "https://ipfs.filebase.io/ipfs/QmXoypiz...",
  "launchId": "launch-1701705600000-abc123"
}
```

---

### SSE Progress Stream
```
GET /api/token-launcher/stream?launchId=launch-xxx
```

Connect to this endpoint to receive real-time progress updates during token launch.

**Events:**
- `connected` - Initial connection established
- `progress` - Progress update

**Progress Data:**
```json
{
  "launchId": "launch-xxx",
  "status": "deploying",
  "step": 2,
  "totalSteps": 4,
  "message": "Deploying token to Base...",
  "data": { },
  "timestamp": 1701705600000
}
```

**Status Values:**
| Status | Description |
|--------|-------------|
| pending | Launch initialized |
| uploading | Uploading image to IPFS |
| deploying | Deploying token contract |
| confirming | Waiting for transaction confirmation |
| complete | Launch successful |
| error | Launch failed |

---

## Frontend Implementation

### React Hook with SSE Progress

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';

interface LaunchProgress {
  status: 'idle' | 'pending' | 'uploading' | 'deploying' | 'confirming' | 'complete' | 'error';
  step: number;
  totalSteps: number;
  message: string;
  data?: {
    cid?: string;
    ipfsUrl?: string;
    txHash?: string;
    tokenAddress?: string;
    dexscreener?: string;
    basescan?: string;
  };
  error?: string;
}

interface LaunchResult {
  success: boolean;
  txHash?: string;
  tokenAddress?: string;
  launchId?: string;
  error?: string;
}

interface UseTokenLauncherReturn {
  progress: LaunchProgress;
  isLaunching: boolean;
  launchToken: (params: LaunchParams) => Promise<LaunchResult>;
  uploadImage: (file: File) => Promise<{ success: boolean; ipfsUrl?: string; error?: string }>;
  reset: () => void;
}

interface LaunchParams {
  name: string;
  symbol: string;
  description?: string;
  image?: File | string;
  website?: string;
  twitter?: string;
  initialBuyEth?: number;
}

export function useTokenLauncher(): UseTokenLauncherReturn {
  const [progress, setProgress] = useState<LaunchProgress>({
    status: 'idle',
    step: 0,
    totalSteps: 0,
    message: '',
  });
  const [isLaunching, setIsLaunching] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to SSE stream
  const connectToStream = useCallback((launchId: string) => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/token-launcher/stream?launchId=${launchId}`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('progress', (event) => {
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
    });

    eventSource.onerror = () => {
      eventSource.close();
      setIsLaunching(false);
    };
  }, []);

  // Upload image only
  const uploadImage = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('action', 'upload');
    formData.append('file', file);

    const response = await fetch('/api/token-launcher', {
      method: 'POST',
      body: formData,
    });

    return response.json();
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
        if (params.initialBuyEth) formData.append('initialBuyEth', String(params.initialBuyEth));

        response = await fetch('/api/token-launcher', {
          method: 'POST',
          body: formData,
        });
      } else {
        // Use JSON for string image URL or no image
        response = await fetch('/api/token-launcher', {
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
            initialBuyEth: params.initialBuyEth || 0.0001,
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
    }
    setProgress({
      status: 'idle',
      step: 0,
      totalSteps: 0,
      message: '',
    });
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

  return {
    progress,
    isLaunching,
    launchToken,
    uploadImage,
    reset,
  };
}
```

---

### React Component Example

```tsx
import { useState } from 'react';
import { useTokenLauncher } from './useTokenLauncher';

export function TokenLaunchForm() {
  const { progress, isLaunching, launchToken, reset } = useTokenLauncher();
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    description: '',
    website: '',
    twitter: '',
    initialBuyEth: '0.0001',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const result = await launchToken({
      name: formData.name,
      symbol: formData.symbol,
      description: formData.description,
      image: imageFile || undefined,
      website: formData.website,
      twitter: formData.twitter,
      initialBuyEth: parseFloat(formData.initialBuyEth),
    });

    if (result.success) {
      console.log('Token launched:', result.tokenAddress);
    }
  };

  return (
    <div className="token-launch-form">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Token Name *</label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="My Awesome Token"
            required
            maxLength={32}
          />
        </div>

        <div className="form-group">
          <label>Symbol *</label>
          <input
            type="text"
            value={formData.symbol}
            onChange={(e) => setFormData(prev => ({ ...prev, symbol: e.target.value.toUpperCase() }))}
            placeholder="MAT"
            required
            maxLength={10}
          />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Describe your token..."
            rows={3}
          />
        </div>

        <div className="form-group">
          <label>Token Image</label>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={handleImageChange}
          />
          {imagePreview && (
            <img src={imagePreview} alt="Preview" className="image-preview" />
          )}
        </div>

        <div className="form-group">
          <label>Website</label>
          <input
            type="url"
            value={formData.website}
            onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
            placeholder="https://mytoken.com"
          />
        </div>

        <div className="form-group">
          <label>Twitter</label>
          <input
            type="text"
            value={formData.twitter}
            onChange={(e) => setFormData(prev => ({ ...prev, twitter: e.target.value }))}
            placeholder="@mytoken"
          />
        </div>

        <div className="form-group">
          <label>Dev Buy Amount (ETH)</label>
          <input
            type="number"
            value={formData.initialBuyEth}
            onChange={(e) => setFormData(prev => ({ ...prev, initialBuyEth: e.target.value }))}
            step="0.0001"
            min="0"
            max="1"
          />
          <small>Amount of ETH to swap for your token on launch</small>
        </div>

        <button type="submit" disabled={isLaunching}>
          {isLaunching ? 'Launching...' : 'Launch Token'}
        </button>
      </form>

      {/* Progress Display */}
      {progress.status !== 'idle' && (
        <div className={`progress-panel ${progress.status}`}>
          <div className="progress-header">
            <span className="status-badge">{progress.status.toUpperCase()}</span>
            <span className="step-counter">Step {progress.step}/{progress.totalSteps}</span>
          </div>

          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(progress.step / progress.totalSteps) * 100}%` }}
            />
          </div>

          <p className="progress-message">{progress.message}</p>

          {progress.error && (
            <div className="error-message">{progress.error}</div>
          )}

          {progress.status === 'complete' && progress.data && (
            <div className="success-links">
              <h4>Token Launched!</h4>
              <p>Address: <code>{progress.data.tokenAddress}</code></p>
              <div className="links">
                <a href={progress.data.dexscreener} target="_blank" rel="noopener noreferrer">
                  View on Dexscreener
                </a>
                <a href={progress.data.basescan} target="_blank" rel="noopener noreferrer">
                  View on Basescan
                </a>
              </div>
            </div>
          )}

          {(progress.status === 'complete' || progress.status === 'error') && (
            <button onClick={reset} className="reset-button">
              Launch Another Token
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

---

### CSS Styles

```css
.token-launch-form {
  max-width: 500px;
  margin: 0 auto;
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 4px;
  font-weight: 600;
  color: #e0e0e0;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 10px;
  border: 1px solid #333;
  border-radius: 8px;
  background: #1a1a2e;
  color: white;
  font-size: 14px;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #6366f1;
}

.form-group small {
  display: block;
  margin-top: 4px;
  color: #888;
  font-size: 12px;
}

.image-preview {
  width: 100px;
  height: 100px;
  object-fit: cover;
  border-radius: 8px;
  margin-top: 8px;
}

button[type="submit"] {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

button[type="submit"]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

button[type="submit"]:hover:not(:disabled) {
  opacity: 0.9;
}

/* Progress Panel */
.progress-panel {
  margin-top: 24px;
  padding: 20px;
  background: #1a1a2e;
  border-radius: 12px;
  border: 1px solid #333;
}

.progress-panel.complete {
  border-color: #22c55e;
}

.progress-panel.error {
  border-color: #ef4444;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
}

.progress-panel.pending .status-badge { background: #333; color: #888; }
.progress-panel.uploading .status-badge { background: #3b82f620; color: #3b82f6; }
.progress-panel.deploying .status-badge { background: #8b5cf620; color: #8b5cf6; }
.progress-panel.confirming .status-badge { background: #eab30820; color: #eab308; }
.progress-panel.complete .status-badge { background: #22c55e20; color: #22c55e; }
.progress-panel.error .status-badge { background: #ef444420; color: #ef4444; }

.step-counter {
  color: #888;
  font-size: 14px;
}

.progress-bar {
  height: 8px;
  background: #333;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
  transition: width 0.3s ease;
}

.progress-message {
  color: #e0e0e0;
  margin: 0;
}

.error-message {
  margin-top: 12px;
  padding: 12px;
  background: #ef444420;
  border-radius: 8px;
  color: #ef4444;
}

.success-links {
  margin-top: 16px;
}

.success-links h4 {
  color: #22c55e;
  margin: 0 0 8px 0;
}

.success-links code {
  display: block;
  padding: 8px;
  background: #333;
  border-radius: 4px;
  font-size: 12px;
  word-break: break-all;
  margin-bottom: 12px;
}

.success-links .links {
  display: flex;
  gap: 12px;
}

.success-links a {
  flex: 1;
  padding: 10px;
  background: #333;
  color: #6366f1;
  text-decoration: none;
  text-align: center;
  border-radius: 8px;
  font-size: 14px;
}

.success-links a:hover {
  background: #444;
}

.reset-button {
  width: 100%;
  margin-top: 16px;
  padding: 12px;
  background: transparent;
  border: 1px solid #333;
  color: #888;
  border-radius: 8px;
  cursor: pointer;
}

.reset-button:hover {
  border-color: #666;
  color: #e0e0e0;
}
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Token name and symbol required" | Missing required fields | Ensure name and symbol are provided |
| "No file provided" | Upload action without file | Include file in FormData |
| "Filebase credentials not configured" | Missing env vars | Set `FILEBASE_ROOTKEY_KEY` and `FILEBASE_ROOTKEY_SECRET` |
| "Private key required" | Missing wallet key | Set `ADMIN_WALLET` environment variable |
| "Insufficient ETH" | Wallet lacks funds | Fund the launcher wallet |

### Retry Strategy

```typescript
async function launchWithRetry(params: LaunchParams, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await launchToken(params);
      if (result.success) return result;

      // Don't retry on validation errors
      if (result.error?.includes('required')) throw new Error(result.error);

      console.log(`Attempt ${attempt} failed, retrying...`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    } catch (error) {
      if (attempt === maxRetries) throw error;
    }
  }
}
```

---

## Best Practices

1. **Validate inputs client-side** before sending to API
2. **Show progress feedback** using SSE stream for better UX
3. **Handle all error states** gracefully with clear messages
4. **Use FormData** for file uploads (not base64 for large images)
5. **Set reasonable dev buy amounts** (0.0001-0.01 ETH recommended)
6. **Preview images** before upload to catch issues early
7. **Test with small amounts** before launching production tokens

---

## Configuration Reference

### Token Launch Defaults
| Setting | Value | Description |
|---------|-------|-------------|
| Pair Token | WASS | All tokens pair with WASS |
| Starting Tick | -276200 | ~$10 market cap |
| Dev Buy | 0.0001 ETH | Default initial purchase |
| Pool Fee | 0.3% + 0.7% hook | Standard Clanker + wASSBLASTER fees |

### Image Requirements
| Setting | Value |
|---------|-------|
| Max Size | 5MB recommended |
| Formats | PNG, JPG, GIF, WebP |
| Recommended Size | 512x512 or 1024x1024 |
| Storage | IPFS via Filebase |
