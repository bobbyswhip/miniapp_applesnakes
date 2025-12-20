'use client';

import { useState, useCallback } from 'react';
import { useAccount, useWalletClient, usePublicClient } from 'wagmi';
import { encodeFunctionData } from 'viem';
import type { OpenSeaListing } from './useOpenSeaListings';

// Seaport 1.6 ABI fragment for fulfillBasicOrder_efficient_6GL6yc
const SEAPORT_ABI = [
  {
    name: 'fulfillBasicOrder_efficient_6GL6yc',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'parameters',
        type: 'tuple',
        components: [
          { name: 'considerationToken', type: 'address' },
          { name: 'considerationIdentifier', type: 'uint256' },
          { name: 'considerationAmount', type: 'uint256' },
          { name: 'offerer', type: 'address' },
          { name: 'zone', type: 'address' },
          { name: 'offerToken', type: 'address' },
          { name: 'offerIdentifier', type: 'uint256' },
          { name: 'offerAmount', type: 'uint256' },
          { name: 'basicOrderType', type: 'uint8' },
          { name: 'startTime', type: 'uint256' },
          { name: 'endTime', type: 'uint256' },
          { name: 'zoneHash', type: 'bytes32' },
          { name: 'salt', type: 'uint256' },
          { name: 'offererConduitKey', type: 'bytes32' },
          { name: 'fulfillerConduitKey', type: 'bytes32' },
          { name: 'totalOriginalAdditionalRecipients', type: 'uint256' },
          {
            name: 'additionalRecipients',
            type: 'tuple[]',
            components: [
              { name: 'amount', type: 'uint256' },
              { name: 'recipient', type: 'address' },
            ],
          },
          { name: 'signature', type: 'bytes' },
        ],
      },
    ],
    outputs: [{ name: 'fulfilled', type: 'bool' }],
  },
] as const;

interface BuyResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

interface UseOpenSeaBuyResult {
  buyListing: (listing: OpenSeaListing) => Promise<BuyResult>;
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Hook for buying NFT listings from OpenSea
 *
 * Uses OpenSea's fulfillment API to get transaction data,
 * then executes the transaction on-chain via Seaport protocol.
 */
export function useOpenSeaBuy(): UseOpenSeaBuyResult {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buyListing = useCallback(async (listing: OpenSeaListing): Promise<BuyResult> => {
    if (!address) {
      setError('Connect wallet first');
      return { success: false, error: 'Connect wallet first' };
    }

    if (!walletClient) {
      setError('Wallet not available');
      return { success: false, error: 'Wallet not available' };
    }

    if (!publicClient) {
      setError('Public client not available');
      return { success: false, error: 'Public client not available' };
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('[OpenSeaBuy] Getting fulfillment data for:', {
        orderHash: listing.orderHash,
        tokenId: listing.tokenId,
        price: listing.price,
      });

      // Step 1: Get fulfillment data from OpenSea via our API
      const fulfillResponse = await fetch('/api/opensea/fulfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderHash: listing.orderHash,
          protocolAddress: listing.protocolAddress,
          fulfillerAddress: address,
          tokenId: listing.tokenId.toString(),
        }),
      });

      const fulfillData = await fulfillResponse.json();

      if (!fulfillData.success) {
        throw new Error(fulfillData.error || 'Failed to get fulfillment data');
      }

      console.log('[OpenSeaBuy] Got fulfillment data:', JSON.stringify(fulfillData, null, 2));

      // Step 2: Extract transaction parameters
      // OpenSea API returns different structures - try multiple paths
      let transaction = fulfillData.fulfillmentData?.fulfillment_data?.transaction;

      // Alternative path: direct transaction object
      if (!transaction) {
        transaction = fulfillData.fulfillmentData?.transaction;
      }

      // Alternative path: orders array format
      if (!transaction && fulfillData.fulfillmentData?.orders?.[0]?.fulfillment_data?.transaction) {
        transaction = fulfillData.fulfillmentData.orders[0].fulfillment_data.transaction;
      }

      if (!transaction) {
        console.error('[OpenSeaBuy] Could not find transaction in response:', fulfillData);
        throw new Error('Invalid fulfillment data: missing transaction object');
      }

      // Log the full transaction object to debug structure
      console.log('[OpenSeaBuy] Full transaction object:', transaction);
      console.log('[OpenSeaBuy] Transaction keys:', Object.keys(transaction));

      // Extract transaction parameters
      const to = transaction.to;
      const value = transaction.value;

      // OpenSea can return data in different formats:
      // 1. 'data': hex string (preferred, ready to use)
      // 2. 'input_data': object with 'parameters' (needs encoding with Seaport ABI)
      let data: string | undefined;

      // First try direct 'data' field (should be hex string)
      if (typeof transaction.data === 'string' && transaction.data.startsWith('0x')) {
        console.log('[OpenSeaBuy] Using direct data field');
        data = transaction.data;
      }
      // Check if input_data is a hex string directly
      else if (typeof transaction.input_data === 'string' && transaction.input_data.startsWith('0x')) {
        console.log('[OpenSeaBuy] Using input_data as hex string');
        data = transaction.input_data;
      }
      // Check if input_data is an object with parameters (Seaport format)
      else if (transaction.input_data && typeof transaction.input_data === 'object') {
        console.log('[OpenSeaBuy] input_data is object, encoding with Seaport ABI');

        const inputData = transaction.input_data;

        // If it has a 'parameters' field, encode it using Seaport ABI
        if (inputData.parameters) {
          const params = inputData.parameters;
          console.log('[OpenSeaBuy] Encoding parameters:', JSON.stringify(params, null, 2));

          // Build the tuple for Seaport's fulfillBasicOrder_efficient_6GL6yc
          const orderParams = {
            considerationToken: params.considerationToken as `0x${string}`,
            considerationIdentifier: BigInt(params.considerationIdentifier || '0'),
            considerationAmount: BigInt(params.considerationAmount || '0'),
            offerer: params.offerer as `0x${string}`,
            zone: params.zone as `0x${string}`,
            offerToken: params.offerToken as `0x${string}`,
            offerIdentifier: BigInt(params.offerIdentifier || '0'),
            offerAmount: BigInt(params.offerAmount || '0'),
            basicOrderType: Number(params.basicOrderType || 0),
            startTime: BigInt(params.startTime || '0'),
            endTime: BigInt(params.endTime || '0'),
            zoneHash: params.zoneHash as `0x${string}`,
            salt: BigInt(params.salt || '0'),
            offererConduitKey: params.offererConduitKey as `0x${string}`,
            fulfillerConduitKey: params.fulfillerConduitKey as `0x${string}`,
            totalOriginalAdditionalRecipients: BigInt(params.totalOriginalAdditionalRecipients || '0'),
            additionalRecipients: (params.additionalRecipients || []).map((r: { amount: string; recipient: string }) => ({
              amount: BigInt(r.amount || '0'),
              recipient: r.recipient as `0x${string}`,
            })),
            signature: params.signature as `0x${string}`,
          };

          // Encode the function call
          data = encodeFunctionData({
            abi: SEAPORT_ABI,
            functionName: 'fulfillBasicOrder_efficient_6GL6yc',
            args: [orderParams],
          });

          console.log('[OpenSeaBuy] Encoded calldata:', data.substring(0, 66) + '...');
        }
        // Fallback: check if there's a data field inside
        else if (typeof inputData.data === 'string') {
          console.log('[OpenSeaBuy] Using input_data.data field');
          data = inputData.data;
        }
      }

      if (!to || !data) {
        console.error('[OpenSeaBuy] Transaction missing fields:', {
          to,
          hasData: !!data,
          transaction,
        });
        throw new Error('Invalid fulfillment data: missing to or data');
      }

      console.log('[OpenSeaBuy] Transaction params:', {
        to,
        value: value || '0',
        dataLength: data?.length,
        dataPreview: data?.substring(0, 66),
      });

      // Step 3: Execute the transaction
      console.log('[OpenSeaBuy] Sending transaction...');

      const txHash = await walletClient.sendTransaction({
        to: to as `0x${string}`,
        value: BigInt(value || '0'),
        data: data as `0x${string}`,
        account: address,
      });

      console.log('[OpenSeaBuy] Transaction sent:', txHash);

      // Step 4: Wait for confirmation
      console.log('[OpenSeaBuy] Waiting for confirmation...');
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted');
      }

      console.log('[OpenSeaBuy] Transaction confirmed!', receipt.transactionHash);

      return {
        success: true,
        txHash: receipt.transactionHash,
      };

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[OpenSeaBuy] Error:', message, err);

      // Handle common errors with user-friendly messages
      let friendlyError = message;
      if (message.includes('user rejected') || message.includes('User rejected')) {
        friendlyError = 'Transaction cancelled';
      } else if (message.includes('insufficient funds')) {
        friendlyError = 'Insufficient ETH balance';
      } else if (message.includes('Order not found') || message.includes('not found')) {
        friendlyError = 'This listing is no longer available';
      }

      setError(friendlyError);
      return { success: false, error: friendlyError };

    } finally {
      setIsLoading(false);
    }
  }, [address, walletClient, publicClient]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    buyListing,
    isLoading,
    error,
    clearError,
  };
}
