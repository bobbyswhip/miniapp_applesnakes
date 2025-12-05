/**
 * AppleSnakes Signature Message Creation and Validation
 *
 * This module handles the human-readable signature format for wallet authentication.
 * The format MUST match Unity's SignatureData.HasValidMessageFormat() exactly.
 */

/**
 * Required format markers for valid AppleSnakes signatures.
 * These MUST match the markers in Unity's HasValidMessageFormat().
 */
export const SIGNATURE_FORMAT_MARKERS = {
  HEADER: 'AppleSnakes Authentication',
  BORDER: '═══════════════════════════════════',
  WALLET: 'Wallet:',
  SESSION: 'Session:',
  NETWORK: 'Network: Base',
  SIGN_PROMPT: 'Sign to continue playing!',
} as const;

/**
 * Creates a human-readable signature message for wallet authentication.
 *
 * @param address - The wallet address signing the message
 * @param nonce - Random nonce (16 bytes hex string starting with 0x)
 * @param clientIP - Client IP address for security binding
 * @returns The formatted signature message
 */
export function createSignatureMessage(
  address: string,
  nonce: string,
  clientIP: string
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const readableTime = new Date(timestamp * 1000).toISOString();

  return `🐍 ${SIGNATURE_FORMAT_MARKERS.HEADER}

Welcome to AppleSnakes!
Sign this message to verify your wallet and enable multiplayer features.

This signature:
• Proves you own this wallet
• Enables secure multiplayer
• Is valid for 24 hours
• Never touches your funds

${SIGNATURE_FORMAT_MARKERS.BORDER}
${SIGNATURE_FORMAT_MARKERS.WALLET} ${address}
Time: ${readableTime}
${SIGNATURE_FORMAT_MARKERS.SESSION} ${nonce}
${SIGNATURE_FORMAT_MARKERS.NETWORK}
Origin: ${clientIP}
${SIGNATURE_FORMAT_MARKERS.BORDER}

${SIGNATURE_FORMAT_MARKERS.SIGN_PROMPT}`;
}

/**
 * Validates that a message has the correct AppleSnakes signature format.
 * This MUST match Unity's SignatureData.HasValidMessageFormat() exactly.
 *
 * @param message - The message to validate
 * @returns true if the message contains all required format markers
 */
export function isValidSignatureFormat(message: string | null | undefined): boolean {
  if (!message) return false;

  // Check for ALL required human-readable format markers
  // These MUST match SignatureData.HasValidMessageFormat() in Unity
  const hasHeader = message.includes(SIGNATURE_FORMAT_MARKERS.HEADER);
  const hasBorder = message.includes(SIGNATURE_FORMAT_MARKERS.BORDER);
  const hasWalletLine = message.includes(SIGNATURE_FORMAT_MARKERS.WALLET);
  const hasSessionLine = message.includes(SIGNATURE_FORMAT_MARKERS.SESSION);
  const hasNetworkLine = message.includes(SIGNATURE_FORMAT_MARKERS.NETWORK);
  const hasSignPrompt = message.includes(SIGNATURE_FORMAT_MARKERS.SIGN_PROMPT);

  return hasHeader && hasBorder && hasWalletLine && hasSessionLine && hasNetworkLine && hasSignPrompt;
}

/**
 * Generates a cryptographic nonce for signature uniqueness.
 *
 * @returns A hex string nonce starting with 0x (32 characters total)
 */
export function generateNonce(): string {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  return '0x' + Array.from(nonceBytes)
    .map(x => x.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Extracts the wallet address from a signature message.
 *
 * @param message - The signature message
 * @returns The wallet address or null if not found
 */
export function extractWalletFromMessage(message: string): string | null {
  const match = message.match(/Wallet:\s*(0x[a-fA-F0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Extracts the session nonce from a signature message.
 *
 * @param message - The signature message
 * @returns The session nonce or null if not found
 */
export function extractSessionFromMessage(message: string): string | null {
  const match = message.match(/Session:\s*(0x[a-fA-F0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Extracts the timestamp from a signature message.
 *
 * @param message - The signature message
 * @returns The Unix timestamp or null if not found
 */
export function extractTimestampFromMessage(message: string): number | null {
  const match = message.match(/Time:\s*(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
  if (!match) return null;
  return Math.floor(new Date(match[1]).getTime() / 1000);
}

/** Storage key for persisted signatures */
export const SIGNATURE_STORAGE_KEY = 'applesnakes_signature';

/** Maximum signature age in seconds (24 hours) */
export const MAX_SIGNATURE_AGE_SECONDS = 86400;
