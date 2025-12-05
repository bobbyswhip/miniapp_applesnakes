/**
 * Signature data returned after wallet signs a message.
 * Used for authentication and multiplayer features.
 */
export interface SignatureData {
  /** The wallet signature (hex string) */
  signature: string;
  /** Full human-readable message that was signed */
  message: string;
  /** Keccak-256 hash of the message (hex string) */
  hashedMessage: string;
  /** Wallet address that created the signature */
  address: string;
  /** Random nonce (16 bytes hex) for uniqueness */
  nonce: string;
  /** Client IP address for security binding */
  clientIP: string;
  /** Unix timestamp when signature was created */
  timestamp: number;
  /** Type of wallet that signed */
  walletType: 'injected' | 'smart';
  /** Whether cryptographic verification passed */
  isValid: boolean;
}

/**
 * Signature request from Unity game.
 */
export interface SignatureRequest {
  /** Unique request ID for tracking */
  requestId: string;
  /** Message from game (may be empty) */
  gameMessage: string;
  /** Whether to store signature in browser localStorage */
  storeInBrowser: boolean;
}

/**
 * Partial signature data when validation fails.
 */
export interface SignatureResult {
  isValid: boolean;
  signature?: string;
  message?: string;
  hashedMessage?: string;
  address?: string;
  nonce?: string;
  clientIP?: string;
  timestamp?: number;
  walletType?: 'injected' | 'smart';
}
