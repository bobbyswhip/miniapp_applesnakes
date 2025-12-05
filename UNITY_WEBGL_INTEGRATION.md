# AppleSnakes Signature Validation System

Complete implementation guide for the human-readable signature format and multi-layer validation.

---

## Table of Contents

1. [Overview](#overview)
2. [Signature Message Format](#signature-message-format)
3. [React Implementation](#react-implementation)
4. [Unity Implementation](#unity-implementation)
5. [Validation Flow](#validation-flow)
6. [Security Considerations](#security-considerations)
7. [Testing & Debugging](#testing--debugging)

---

## Overview

The AppleSnakes signature system provides secure wallet authentication with:

- **Human-readable messages** - Users can clearly see what they're signing
- **Multi-layer validation** - Format, expiry, address matching, and cryptographic checks
- **Auto-login support** - Stored signatures can be reused (within 24 hours)
- **Smart wallet support** - Works with both EOA (ECDSA) and smart wallets (EIP-1271)

### Why Format Validation?

Format validation prevents:
- Accepting old signatures from before the human-readable format
- Cross-site signature reuse (signatures from other dApps)
- Tampered or malformed signatures
- Replay attacks with modified messages

---

## Signature Message Format

The signature message MUST follow this exact format:

```
🐍 AppleSnakes Authentication

Welcome to AppleSnakes!
Sign this message to verify your wallet and enable multiplayer features.

This signature:
• Proves you own this wallet
• Enables secure multiplayer
• Is valid for 24 hours
• Never touches your funds

═══════════════════════════════════
Wallet: 0x1234567890abcdef1234567890abcdef12345678
Time: 2024-01-15T10:30:00.000Z
Session: 0xabc123def456...
Network: Base
Origin: 123.45.67.89
═══════════════════════════════════

Sign to continue playing!
```

### Required Format Markers

For a signature to be valid, the message MUST contain ALL of these markers:

| Marker | Purpose |
|--------|---------|
| `AppleSnakes Authentication` | Identifies our app |
| `═══════════════════════════════════` | Visual separator (security info) |
| `Wallet:` | Shows the signing wallet |
| `Session:` | Unique nonce for this signature |
| `Network: Base` | Confirms correct network |
| `Sign to continue playing!` | Call to action |

---

## React Implementation

### 1. Creating the Signature Message

```typescript
// lib/signature.ts
export function createSignatureMessage(
  address: string,
  nonce: string,
  clientIP: string
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const readableTime = new Date(timestamp * 1000).toISOString();

  return `🐍 AppleSnakes Authentication

Welcome to AppleSnakes!
Sign this message to verify your wallet and enable multiplayer features.

This signature:
• Proves you own this wallet
• Enables secure multiplayer
• Is valid for 24 hours
• Never touches your funds

═══════════════════════════════════
Wallet: ${address}
Time: ${readableTime}
Session: ${nonce}
Network: Base
Origin: ${clientIP}
═══════════════════════════════════

Sign to continue playing!`;
}
```

### 2. Format Validation Helper

```typescript
// lib/signature.ts
export function isValidSignatureFormat(message: string | null | undefined): boolean {
  if (!message) return false;

  // Check for ALL required human-readable format markers
  // These MUST match SignatureData.HasValidMessageFormat() in Unity
  const hasHeader = message.includes('AppleSnakes Authentication');
  const hasBorder = message.includes('═══════════════════════════════════');
  const hasWalletLine = message.includes('Wallet:');
  const hasSessionLine = message.includes('Session:');
  const hasNetworkLine = message.includes('Network: Base');
  const hasSignPrompt = message.includes('Sign to continue playing!');

  return hasHeader && hasBorder && hasWalletLine && hasSessionLine && hasNetworkLine && hasSignPrompt;
}
```

### 3. Full Signature Request Handler

```typescript
// hooks/useSignature.ts
import { useSignMessage, useAccount } from 'wagmi';
import { keccak256, toBytes } from 'viem';
import { createSignatureMessage, isValidSignatureFormat } from '@/lib/signature';

const SIGNATURE_STORAGE_KEY = 'applesnakes_signature';

export function useSignatureHandler() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const handleSignatureRequest = async (
    gameMessage: string,
    storeInBrowser: boolean
  ): Promise<SignatureData> => {
    if (!isConnected || !address) {
      return { isValid: false };
    }

    try {
      // 1. Get client IP for security binding
      const clientIP = await fetch('https://api.ipify.org?format=json')
        .then(r => r.json())
        .then(d => d.ip)
        .catch(() => 'unknown');

      // 2. Generate cryptographic nonce
      const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
      const nonce = '0x' + Array.from(nonceBytes)
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');

      // 3. Create human-readable message
      const message = createSignatureMessage(address, nonce, clientIP);
      const timestamp = Math.floor(Date.now() / 1000);

      // 4. Hash message for verification
      const hashedMessage = keccak256(toBytes(message));

      // 5. Request wallet signature
      const signature = await signMessageAsync({ message });

      // 6. Verify the signature (supports smart wallets)
      const isValid = await verifySignature(address, message, signature);

      // 7. Build signature data object
      const signatureData: SignatureData = {
        signature,
        message,
        hashedMessage,
        address,
        nonce,
        clientIP,
        timestamp,
        walletType: 'injected', // or detect smart wallet
        isValid
      };

      // 8. Store in localStorage if requested
      if (storeInBrowser && isValid) {
        localStorage.setItem(SIGNATURE_STORAGE_KEY, JSON.stringify(signatureData));
      }

      return signatureData;

    } catch (error) {
      console.error('Signature request failed:', error);
      return { isValid: false };
    }
  };

  return { handleSignatureRequest };
}
```

### 4. Stored Signature Handler

```typescript
// hooks/useStoredSignature.ts
import { isValidSignatureFormat } from '@/lib/signature';

const SIGNATURE_STORAGE_KEY = 'applesnakes_signature';
const MAX_AGE_SECONDS = 86400; // 24 hours

export function getStoredSignature(currentAddress: string | undefined): SignatureData | null {
  try {
    const stored = localStorage.getItem(SIGNATURE_STORAGE_KEY);
    if (!stored) {
      console.log('[Signature] No stored signature found');
      return null;
    }

    const signatureData = JSON.parse(stored);
    const now = Math.floor(Date.now() / 1000);

    // Validation 1: Check expiry
    if (now - signatureData.timestamp > MAX_AGE_SECONDS) {
      console.log('[Signature] Stored signature expired');
      localStorage.removeItem(SIGNATURE_STORAGE_KEY);
      return null;
    }

    // Validation 2: Check address match
    if (currentAddress &&
        currentAddress.toLowerCase() !== signatureData.address?.toLowerCase()) {
      console.log('[Signature] Address mismatch');
      localStorage.removeItem(SIGNATURE_STORAGE_KEY);
      return null;
    }

    // Validation 3: Check cryptographic validity flag
    if (!signatureData.isValid) {
      console.log('[Signature] Stored signature marked invalid');
      localStorage.removeItem(SIGNATURE_STORAGE_KEY);
      return null;
    }

    // Validation 4: CRITICAL - Check message format
    if (!isValidSignatureFormat(signatureData.message)) {
      console.log('[Signature] Invalid format (not AppleSnakes format)');
      console.log('[Signature] Message preview:', signatureData.message?.substring(0, 100));
      localStorage.removeItem(SIGNATURE_STORAGE_KEY);
      return null;
    }

    console.log('[Signature] Stored signature validated successfully');
    return signatureData;

  } catch (error) {
    console.error('[Signature] Error reading stored signature:', error);
    localStorage.removeItem(SIGNATURE_STORAGE_KEY);
    return null;
  }
}

export function clearStoredSignature(): void {
  localStorage.removeItem(SIGNATURE_STORAGE_KEY);
}
```

### 5. Smart Wallet Verification (EIP-1271)

```typescript
// lib/verifySignature.ts
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { hashMessage } from 'viem';

const publicClient = createPublicClient({
  chain: base,
  transport: http()
});

export async function verifySignature(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    // Check if smart wallet (has code)
    const code = await publicClient.getBytecode({ address: address as `0x${string}` });
    const isSmartWallet = code && code !== '0x';

    if (isSmartWallet) {
      // EIP-1271 verification for smart wallets
      const messageHash = hashMessage(message);
      const EIP1271_MAGIC_VALUE = '0x1626ba7e';

      const result = await publicClient.readContract({
        address: address as `0x${string}`,
        abi: [{
          name: 'isValidSignature',
          type: 'function',
          inputs: [
            { name: 'hash', type: 'bytes32' },
            { name: 'signature', type: 'bytes' }
          ],
          outputs: [{ name: '', type: 'bytes4' }]
        }],
        functionName: 'isValidSignature',
        args: [messageHash, signature as `0x${string}`]
      });

      return result === EIP1271_MAGIC_VALUE;
    } else {
      // Standard ECDSA verification for EOA wallets
      const recoveredAddress = await publicClient.verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`
      });
      return recoveredAddress;
    }
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}
```

---

## Unity Implementation

### 1. SignatureData Class

Located in `Assets/Scripts/Auth/WebGLBridge.cs`:

```csharp
[Serializable]
public class SignatureData
{
    public string signature;        // The wallet signature
    public string message;          // Full human-readable message
    public string hashedMessage;    // Keccak-256 hash of the message
    public string address;          // Wallet address that signed
    public string nonce;            // Random nonce (16 bytes hex)
    public string clientIP;         // Client IP for server verification
    public long timestamp;          // Unix timestamp when signed
    public string walletType;       // "injected" or "smart"
    public bool isValid;            // Cryptographic verification result

    /// <summary>
    /// Validates message has correct AppleSnakes format.
    /// MUST match isValidSignatureFormat() in React.
    /// </summary>
    public bool HasValidMessageFormat()
    {
        if (string.IsNullOrEmpty(message)) return false;

        // Check for ALL required human-readable format markers
        bool hasHeader = message.Contains("AppleSnakes Authentication");
        bool hasBorder = message.Contains("═══════════════════════════════════");
        bool hasWalletLine = message.Contains("Wallet:");
        bool hasSessionLine = message.Contains("Session:");
        bool hasNetworkLine = message.Contains("Network: Base");
        bool hasSignPrompt = message.Contains("Sign to continue playing!");

        return hasHeader && hasBorder && hasWalletLine &&
               hasSessionLine && hasNetworkLine && hasSignPrompt;
    }

    /// <summary>
    /// Checks if signature is not expired.
    /// </summary>
    public bool IsNotExpired(long maxAgeSeconds = 86400)
    {
        if (timestamp <= 0) return false;
        long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return (now - timestamp) < maxAgeSeconds;
    }

    /// <summary>
    /// Checks if address matches.
    /// </summary>
    public bool AddressMatches(string expectedAddress)
    {
        if (string.IsNullOrEmpty(address) || string.IsNullOrEmpty(expectedAddress))
            return false;
        return string.Equals(address, expectedAddress, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Full validation for stored signature reuse.
    /// </summary>
    public bool IsValidForReuse(string expectedAddress = null, long maxAgeSeconds = 86400)
    {
        // 1. Must have passed cryptographic verification
        if (!isValid) return false;

        // 2. Must have valid AppleSnakes format
        if (!HasValidMessageFormat()) return false;

        // 3. Must not be expired
        if (!IsNotExpired(maxAgeSeconds)) return false;

        // 4. If address provided, must match
        if (!string.IsNullOrEmpty(expectedAddress) && !AddressMatches(expectedAddress))
            return false;

        return true;
    }
}
```

### 2. WebGLBridge HasValidSignature Property

```csharp
/// <summary>
/// Checks if we have a valid signature matching all requirements.
/// </summary>
public bool HasValidSignature
{
    get
    {
        if (CurrentSignature == null || !CurrentSignature.isValid) return false;

        // Get current wallet address for matching
        string currentAddress = CurrentUser?.walletAddress;

        // Use full validation (format + expiry + address match)
        return CurrentSignature.IsValidForReuse(currentAddress);
    }
}
```

### 3. Signature Validation on Receipt

```csharp
public void OnSignatureDataReceived(string jsonData)
{
    try
    {
        var signature = JsonUtility.FromJson<SignatureData>(jsonData);

        // Validate before accepting
        if (signature != null && signature.isValid)
        {
            if (!signature.HasValidMessageFormat())
            {
                Debug.LogWarning("[WebGLBridge] Signature rejected: Invalid format");
                signature.isValid = false;
            }
            else if (!signature.IsNotExpired())
            {
                Debug.LogWarning("[WebGLBridge] Signature rejected: Expired");
                signature.isValid = false;
            }
            else
            {
                Debug.Log("[WebGLBridge] Signature validated successfully");
            }
        }

        CurrentSignature = signature;
        OnSignatureReceived?.Invoke(CurrentSignature);
    }
    catch (Exception e)
    {
        Debug.LogError("[WebGLBridge] Failed to parse signature: " + e.Message);
    }
}
```

### 4. GameAuthManager Integration

```csharp
void HandleSignatureReceived(SignatureData signature)
{
    // Use WebGLBridge.HasValidSignature for full validation
    bool isFullyValid = signature != null && WebGLBridge.Instance?.HasValidSignature == true;

    if (isFullyValid)
    {
        Debug.Log("[GameAuthManager] Authenticated!");
        SetState(AuthState.Authenticated);
        OnFullyAuthenticated?.Invoke(signature);
        OnSignatureReady?.Invoke(signature.signature, signature.hashedMessage, signature.nonce);
    }
    else
    {
        // Log detailed rejection reason for debugging
        if (signature != null) LogSignatureRejectionReason(signature);

        // Request new signature
        if (WebGLBridge.Instance?.IsWalletConnected == true)
        {
            SetState(AuthState.Connected);
            RequestSignature();
        }
    }
}

void LogSignatureRejectionReason(SignatureData signature)
{
    if (!signature.isValid)
        Debug.LogWarning("Rejected: Cryptographic verification failed");
    else if (!signature.HasValidMessageFormat())
        Debug.LogWarning($"Rejected: Invalid format. Preview: {signature.message?.Substring(0, 100)}");
    else if (!signature.IsNotExpired())
        Debug.LogWarning($"Rejected: Expired (age: {DateTimeOffset.UtcNow.ToUnixTimeSeconds() - signature.timestamp}s)");
    else
        Debug.LogWarning("Rejected: Unknown reason");
}
```

---

## Validation Flow

### Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PAGE LOAD / GAME START                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  REACT: Check localStorage for stored signature                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              No stored sig                   Has stored sig
                    │                               │
                    ▼                               ▼
         ┌──────────────────┐        ┌───────────────────────────────────┐
         │ Show Sign Button │        │ REACT: Validate stored signature  │
         └──────────────────┘        │ 1. Check expiry (< 24h)           │
                                     │ 2. Check address matches          │
                                     │ 3. Check isValid flag             │
                                     │ 4. Check message format ★         │
                                     └───────────────────────────────────┘
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │                               │
                              Validation                      Validation
                                PASS                            FAIL
                                    │                               │
                                    ▼                               ▼
                    ┌──────────────────────┐         ┌──────────────────────┐
                    │ Send to Unity via    │         │ Clear localStorage   │
                    │ SendMessage()        │         │ Request new signature│
                    └──────────────────────┘         └──────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  UNITY: OnSignatureDataReceived()                                        │
│  Re-validate in case of tampering:                                       │
│  1. Check cryptographic validity (isValid)                               │
│  2. Check message format (HasValidMessageFormat) ★                       │
│  3. Check expiry (IsNotExpired)                                          │
│  4. Check address match (AddressMatches)                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
              All checks                      Any check
                 PASS                           FAIL
                    │                               │
                    ▼                               ▼
       ┌───────────────────────┐     ┌───────────────────────────────────┐
       │ Set AuthState =       │     │ Mark signature.isValid = false    │
       │ Authenticated         │     │ Request new signature from user   │
       │ Fire OnFullyAuth      │     │                                   │
       └───────────────────────┘     └───────────────────────────────────┘

★ = Format validation (new feature)
```

### Validation Checkpoints

| Layer | Check | Failure Action |
|-------|-------|----------------|
| React (localStorage) | Expiry | Clear stored, request new |
| React (localStorage) | Address match | Clear stored, request new |
| React (localStorage) | isValid flag | Clear stored, request new |
| React (localStorage) | **Message format** | Clear stored, request new |
| Unity (OnReceive) | isValid flag | Mark invalid, request new |
| Unity (OnReceive) | **Message format** | Mark invalid, request new |
| Unity (OnReceive) | Expiry | Mark invalid, request new |
| Unity (HasValidSignature) | All above + address | Return false |

---

## Security Considerations

### Why Multi-Layer Validation?

1. **React Validation**: Prevents sending obviously invalid signatures to Unity (saves bandwidth/processing)

2. **Unity Validation**: Defense-in-depth - even if React validation is bypassed/modified by a malicious actor, Unity will reject invalid signatures

3. **Format Validation**: Prevents:
   - Reusing signatures from other dApps
   - Accepting old non-formatted signatures
   - Tampered messages with wrong structure

### Attack Prevention

| Attack | Prevention |
|--------|------------|
| Old signature replay | Format validation + 24h expiry |
| Cross-site signature reuse | Format validation (unique markers) |
| Tampered localStorage | Unity re-validates all checks |
| Expired signature reuse | Timestamp validation on both sides |
| Wallet swap attack | Address matching validation |

### Server-Side Verification

For multiplayer servers, verify signatures server-side:

```javascript
// Server-side signature verification
async function verifyPlayerSignature(signatureData) {
  // 1. Verify format
  if (!isValidSignatureFormat(signatureData.message)) {
    throw new Error('Invalid signature format');
  }

  // 2. Verify not expired
  const maxAge = 86400;
  const now = Math.floor(Date.now() / 1000);
  if (now - signatureData.timestamp > maxAge) {
    throw new Error('Signature expired');
  }

  // 3. Verify cryptographic signature
  const isValid = await verifySignature(
    signatureData.address,
    signatureData.message,
    signatureData.signature
  );

  if (!isValid) {
    throw new Error('Invalid signature');
  }

  // 4. Extract and verify embedded data
  const walletMatch = signatureData.message.match(/Wallet: (0x[a-fA-F0-9]+)/);
  if (walletMatch[1].toLowerCase() !== signatureData.address.toLowerCase()) {
    throw new Error('Message wallet mismatch');
  }

  return true;
}
```

---

## Testing & Debugging

### Test Cases

#### 1. Valid Signature Flow
```
1. Clear localStorage
2. Connect wallet
3. Click Sign button
4. Sign the message
5. Verify: Unity shows Authenticated
6. Refresh page
7. Verify: Auto-login works (stored signature used)
```

#### 2. Expired Signature
```
1. Sign and store a signature
2. Manually edit localStorage, set timestamp to 25 hours ago
3. Refresh page
4. Verify: New signature requested (not auto-login)
```

#### 3. Wrong Format Signature
```
1. Sign and store a signature
2. Manually edit localStorage, modify message to remove "AppleSnakes Authentication"
3. Refresh page
4. Verify: New signature requested (format validation failed)
```

#### 4. Address Mismatch
```
1. Sign with Wallet A
2. Disconnect Wallet A
3. Connect Wallet B
4. Verify: New signature requested (address mismatch)
```

### Debug Console Commands

**React (Browser Console):**
```javascript
// View stored signature
JSON.parse(localStorage.getItem('applesnakes_signature'))

// Clear stored signature
localStorage.removeItem('applesnakes_signature')

// Test format validation
isValidSignatureFormat(JSON.parse(localStorage.getItem('applesnakes_signature'))?.message)
```

**Unity (Debug Log):**
```
[WebGLBridge] Signature validated: Format OK, not expired
[WebGLBridge] Signature rejected: Invalid message format
[GameAuthManager] Valid signature received - authenticated!
[GameAuthManager] Signature rejected: Invalid format. Preview: ...
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Always requests new signature | Format markers changed | Ensure React and Unity markers match exactly |
| Auto-login fails silently | localStorage cleared | Check browser dev tools |
| "Invalid format" after signing | Message template changed | Clear old signatures, sign fresh |
| Smart wallet fails | EIP-1271 not implemented | Verify contract supports isValidSignature |

---

## TypeScript Types

```typescript
// types/signature.ts
export interface SignatureData {
  signature: string;
  message: string;
  hashedMessage: string;
  address: string;
  nonce: string;
  clientIP: string;
  timestamp: number;
  walletType: 'injected' | 'smart';
  isValid: boolean;
}

export interface SignatureRequest {
  requestId: string;
  gameMessage: string;
  storeInBrowser: boolean;
}
```

---

## Checklist

### React Implementation
- [ ] `createSignatureMessage()` creates correct format
- [ ] `isValidSignatureFormat()` checks ALL 6 markers
- [ ] `handleSignatureRequest()` creates and stores signatures
- [ ] `getStoredSignature()` validates format before returning
- [ ] `verifySignature()` supports both EOA and smart wallets
- [ ] Clear signature on wallet disconnect

### Unity Implementation
- [ ] `SignatureData.HasValidMessageFormat()` checks ALL 6 markers
- [ ] `SignatureData.IsNotExpired()` checks 24h expiry
- [ ] `SignatureData.AddressMatches()` compares case-insensitively
- [ ] `SignatureData.IsValidForReuse()` combines all checks
- [ ] `WebGLBridge.HasValidSignature` uses full validation
- [ ] `OnSignatureDataReceived()` validates before accepting
- [ ] `GameAuthManager` logs detailed rejection reasons

### Markers Match (CRITICAL)
- [ ] `AppleSnakes Authentication` - same in React and Unity
- [ ] `═══════════════════════════════════` - exact character match
- [ ] `Wallet:` - same in React and Unity
- [ ] `Session:` - same in React and Unity
- [ ] `Network: Base` - same in React and Unity
- [ ] `Sign to continue playing!` - same in React and Unity
