// lib/prediction-market-error-handler.ts
// Error handling utilities for prediction market operations

export type ErrorAction = 'retry' | 'wait' | 'support' | 'adjust';

export interface HandledError {
  userMessage: string;
  action: ErrorAction;
  code?: string;
  waitMs?: number;
}

// Error codes from the backend
export type PredictionMarketErrorCode =
  | 'INVALID_PAYMENT_HEADER'
  | 'INVALID_RECIPIENT'
  | 'INSUFFICIENT_PAYMENT'
  | 'EXCEEDS_MAXIMUM'
  | 'MISSING_SIGNATURE'
  | 'TRANSFER_FAILED'
  | 'COOLDOWN_ACTIVE'
  | 'TX_PENDING'
  | 'USDC_SEND_FAILED'
  | 'MARKET_NOT_FOUND'
  | 'MARKET_CLOSED'
  | 'INSUFFICIENT_SHARES'
  | 'INVALID_SIDE'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED';

/**
 * Handle prediction market errors with user-friendly messages
 */
export function handlePredictionMarketError(
  code: string | undefined,
  message: string,
  waitMs?: number
): HandledError {
  switch (code) {
    case 'COOLDOWN_ACTIVE':
      return {
        userMessage: 'Please wait a few seconds before selling again',
        action: 'wait',
        code,
        waitMs,
      };

    case 'TX_PENDING':
      return {
        userMessage: 'Your previous transaction is still processing',
        action: 'wait',
        code,
      };

    case 'INSUFFICIENT_PAYMENT':
      return {
        userMessage: 'Minimum bet is $1 USDC',
        action: 'adjust',
        code,
      };

    case 'EXCEEDS_MAXIMUM':
      return {
        userMessage: 'Maximum bet is $10,000 USDC',
        action: 'adjust',
        code,
      };

    case 'TRANSFER_FAILED':
      return {
        userMessage: 'Transfer failed. Check your USDC balance and try again',
        action: 'retry',
        code,
      };

    case 'USDC_SEND_FAILED':
      return {
        userMessage: 'Failed to send USDC. Please contact support with the transaction ID',
        action: 'support',
        code,
      };

    case 'INVALID_PAYMENT_HEADER':
      return {
        userMessage: 'Payment signature invalid. Please try again',
        action: 'retry',
        code,
      };

    case 'MISSING_SIGNATURE':
      return {
        userMessage: 'Payment signature required. Please sign the transaction',
        action: 'retry',
        code,
      };

    case 'INVALID_RECIPIENT':
      return {
        userMessage: 'Payment configuration error. Please contact support',
        action: 'support',
        code,
      };

    case 'MARKET_NOT_FOUND':
      return {
        userMessage: 'Market not found. It may have been removed',
        action: 'retry',
        code,
      };

    case 'MARKET_CLOSED':
      return {
        userMessage: 'This market is no longer accepting bets',
        action: 'retry',
        code,
      };

    case 'INSUFFICIENT_SHARES':
      return {
        userMessage: 'Not enough shares to sell',
        action: 'adjust',
        code,
      };

    case 'INVALID_SIDE':
      return {
        userMessage: 'Invalid side selected. Choose YES or NO',
        action: 'adjust',
        code,
      };

    case 'UNAUTHORIZED':
      return {
        userMessage: 'Please connect your wallet and try again',
        action: 'retry',
        code,
      };

    case 'RATE_LIMITED':
      return {
        userMessage: 'Too many requests. Please wait and try again',
        action: 'wait',
        code,
        waitMs: waitMs || 5000,
      };

    default:
      // Check for common error patterns in message
      if (message.toLowerCase().includes('user rejected') ||
          message.toLowerCase().includes('user denied')) {
        return {
          userMessage: 'Transaction cancelled',
          action: 'retry',
        };
      }
      if (message.toLowerCase().includes('insufficient funds') ||
          message.toLowerCase().includes('insufficient balance')) {
        return {
          userMessage: 'Insufficient USDC balance',
          action: 'adjust',
        };
      }
      if (message.toLowerCase().includes('network') ||
          message.toLowerCase().includes('connection')) {
        return {
          userMessage: 'Network error. Please check your connection',
          action: 'retry',
        };
      }

      return {
        userMessage: message || 'Something went wrong. Please try again',
        action: 'retry',
      };
  }
}

/**
 * Format error for display
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'An unexpected error occurred';
}

/**
 * Check if error is recoverable
 */
export function isRecoverableError(code: string | undefined): boolean {
  const unrecoverable = ['INVALID_RECIPIENT', 'USDC_SEND_FAILED'];
  return !code || !unrecoverable.includes(code);
}

/**
 * Get suggested wait time for rate limited operations
 */
export function getSuggestedWaitTime(code: string | undefined, waitMs?: number): number {
  if (waitMs) return waitMs;
  switch (code) {
    case 'COOLDOWN_ACTIVE':
      return 5000;  // 5 seconds
    case 'TX_PENDING':
      return 10000; // 10 seconds
    case 'RATE_LIMITED':
      return 30000; // 30 seconds
    default:
      return 0;
  }
}
