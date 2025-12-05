/**
 * Signature Verification for EOA and Smart Wallets (EIP-1271)
 *
 * This module provides signature verification that works with both:
 * - EOA (Externally Owned Accounts) using standard ECDSA
 * - Smart Wallets using EIP-1271 isValidSignature
 */

import { createPublicClient, http, hashMessage } from 'viem';
import { base } from 'viem/chains';

/** EIP-1271 magic value returned for valid signatures */
const EIP1271_MAGIC_VALUE = '0x1626ba7e';

/** ABI for EIP-1271 isValidSignature function */
const EIP1271_ABI = [{
  name: 'isValidSignature',
  type: 'function',
  inputs: [
    { name: 'hash', type: 'bytes32' },
    { name: 'signature', type: 'bytes' }
  ],
  outputs: [{ name: '', type: 'bytes4' }]
}] as const;

/**
 * Creates a public client for Base network.
 * Uses the configured RPC endpoint from wagmi config.
 */
function getPublicClient() {
  return createPublicClient({
    chain: base,
    transport: http()
  });
}

/**
 * Checks if an address is a smart wallet (has contract code).
 *
 * @param address - The wallet address to check
 * @returns true if the address has contract code deployed
 */
export async function isSmartWallet(address: string): Promise<boolean> {
  try {
    const publicClient = getPublicClient();
    const code = await publicClient.getBytecode({
      address: address as `0x${string}`
    });
    return !!(code && code !== '0x');
  } catch (error) {
    console.error('[verifySignature] Error checking wallet type:', error);
    return false;
  }
}

/**
 * Verifies a signature using EIP-1271 for smart wallets.
 *
 * @param address - The smart wallet address
 * @param message - The original message that was signed
 * @param signature - The signature to verify
 * @returns true if the signature is valid
 */
async function verifySmartWalletSignature(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    const publicClient = getPublicClient();
    const messageHash = hashMessage(message);

    const result = await publicClient.readContract({
      address: address as `0x${string}`,
      abi: EIP1271_ABI,
      functionName: 'isValidSignature',
      args: [messageHash, signature as `0x${string}`]
    });

    return result === EIP1271_MAGIC_VALUE;
  } catch (error) {
    console.error('[verifySignature] EIP-1271 verification failed:', error);
    return false;
  }
}

/**
 * Verifies a signature using standard ECDSA for EOA wallets.
 *
 * @param address - The EOA address
 * @param message - The original message that was signed
 * @param signature - The signature to verify
 * @returns true if the signature is valid
 */
async function verifyEOASignature(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    const publicClient = getPublicClient();
    const isValid = await publicClient.verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`
    });
    return isValid;
  } catch (error) {
    console.error('[verifySignature] ECDSA verification failed:', error);
    return false;
  }
}

/**
 * Verifies a signature from either an EOA or smart wallet.
 *
 * This function automatically detects the wallet type and uses
 * the appropriate verification method:
 * - EOA: Standard ECDSA signature recovery
 * - Smart Wallet: EIP-1271 isValidSignature call
 *
 * @param address - The address that supposedly signed the message
 * @param message - The original message that was signed
 * @param signature - The signature to verify
 * @returns true if the signature is valid for the given address
 */
export async function verifySignature(
  address: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    // Check if smart wallet (has code)
    const smartWallet = await isSmartWallet(address);

    if (smartWallet) {
      console.log('[verifySignature] Using EIP-1271 for smart wallet');
      return await verifySmartWalletSignature(address, message, signature);
    } else {
      console.log('[verifySignature] Using ECDSA for EOA wallet');
      return await verifyEOASignature(address, message, signature);
    }
  } catch (error) {
    console.error('[verifySignature] Verification failed:', error);
    return false;
  }
}

/**
 * Determines the wallet type for a given address.
 *
 * @param address - The wallet address to check
 * @returns 'smart' for smart wallets, 'injected' for EOA
 */
export async function getWalletType(address: string): Promise<'injected' | 'smart'> {
  const smart = await isSmartWallet(address);
  return smart ? 'smart' : 'injected';
}
