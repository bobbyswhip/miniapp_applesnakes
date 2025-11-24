'use client';

import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { getContracts, BLACKJACK_ADDRESS, PREDICTION_HUB_ADDRESS, TOKEN_ADDRESS } from '@/config';
import { base } from 'wagmi/chains';
import { formatEther, parseEther, formatUnits, parseUnits } from 'viem';
import { useTokenBalance } from '@/hooks/useTokenBalance';

interface BuyMarketModalProps {
  gameId: bigint;
  onClose: () => void;
}

type ActionType = 'buy' | 'sell';
type PositionType = 'yes' | 'no';
type PaymentMethod = 'token' | 'eth';

export function BuyMarketModal({ gameId, onClose }: BuyMarketModalProps) {
  const { address } = useAccount();
  const contracts = getContracts(base.id);
  const { balance: tokenBalance, formattedBalance: formattedTokenBalance, symbol: tokenSymbol } = useTokenBalance();

  const [actionType, setActionType] = useState<ActionType>('buy');
  const [position, setPosition] = useState<PositionType>('yes');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('token');
  const [amount, setAmount] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch game info
  const { data: gameInfoData } = useReadContract({
    address: BLACKJACK_ADDRESS(base.id),
    abi: contracts.blackjack.abi,
    functionName: 'getGameInfo',
    args: [gameId],
    chainId: base.id,
  });

  const gameInfo = gameInfoData as any;

  // Fetch market display
  const { data: marketDisplayData, refetch: refetchMarket } = useReadContract({
    address: PREDICTION_HUB_ADDRESS(base.id),
    abi: contracts.predictionHub.abi,
    functionName: 'getMarketDisplay',
    args: address ? [gameId, address] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address,
      refetchInterval: 3000,
    },
  });

  const marketDisplay = marketDisplayData as any;

  // Fetch token allowance
  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: TOKEN_ADDRESS(base.id),
    abi: contracts.token.abi,
    functionName: 'allowance',
    args: address ? [address, PREDICTION_HUB_ADDRESS(base.id)] : undefined,
    chainId: base.id,
    query: {
      enabled: !!address && paymentMethod === 'token',
    },
  });

  const allowance = allowanceData as bigint | undefined;

  // Get token decimals
  const { data: decimalsData } = useReadContract({
    address: TOKEN_ADDRESS(base.id),
    abi: contracts.token.abi,
    functionName: 'decimals',
    chainId: base.id,
  });

  const tokenDecimals = decimalsData as number | undefined;

  // Approval transaction
  const {
    data: approveHash,
    writeContract: writeApprove,
    isPending: isApprovePending,
  } = useWriteContract();

  const {
    isLoading: isApproveConfirming,
    isSuccess: isApproveConfirmed,
  } = useWaitForTransactionReceipt({ hash: approveHash });

  // Buy/Sell transaction
  const {
    data: txHash,
    writeContract: writeTx,
    isPending: isTxPending,
  } = useWriteContract();

  const {
    isLoading: isTxConfirming,
    isSuccess: isTxConfirmed,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // Default to token if user has tokens, otherwise ETH
  useEffect(() => {
    if (tokenBalance && tokenBalance > 0n) {
      setPaymentMethod('token');
    } else {
      setPaymentMethod('eth');
    }
  }, [tokenBalance]);

  // Refetch market after successful transaction
  useEffect(() => {
    if (isTxConfirmed) {
      refetchMarket();
      setAmount('');
      setErrorMessage('');
    }
  }, [isTxConfirmed, refetchMarket]);

  // Refetch allowance after approval
  useEffect(() => {
    if (isApproveConfirmed) {
      refetchAllowance();
    }
  }, [isApproveConfirmed, refetchAllowance]);

  const handleApprove = async () => {
    if (!amount || !tokenDecimals) return;
    setErrorMessage('');

    try {
      const amountInWei = parseUnits(amount, tokenDecimals);
      writeApprove({
        address: TOKEN_ADDRESS(base.id),
        abi: contracts.token.abi,
        functionName: 'approve',
        args: [PREDICTION_HUB_ADDRESS(base.id), amountInWei],
      });
    } catch (error: any) {
      setErrorMessage(error.message || 'Approval failed');
    }
  };

  const handleTransaction = async () => {
    if (!amount) return;
    setErrorMessage('');

    try {
      if (actionType === 'buy') {
        if (paymentMethod === 'eth') {
          // Buy with ETH
          const amountInWei = parseEther(amount);
          const functionName = position === 'yes' ? 'buyYesWithETH' : 'buyNoWithETH';

          writeTx({
            address: PREDICTION_HUB_ADDRESS(base.id),
            abi: contracts.predictionHub.abi,
            functionName,
            args: [gameId],
            value: amountInWei,
          });
        } else {
          // Buy with tokens
          if (!tokenDecimals) return;
          const amountInWei = parseUnits(amount, tokenDecimals);
          const isYes = position === 'yes';

          writeTx({
            address: PREDICTION_HUB_ADDRESS(base.id),
            abi: contracts.predictionHub.abi,
            functionName: 'buyShares',
            args: [gameId, amountInWei, isYes],
          });
        }
      } else {
        // Sell shares
        if (!tokenDecimals) return;
        const sharesIn = parseUnits(amount, tokenDecimals);
        const isYes = position === 'yes';

        writeTx({
          address: PREDICTION_HUB_ADDRESS(base.id),
          abi: contracts.predictionHub.abi,
          functionName: 'sellShares',
          args: [gameId, sharesIn, isYes],
        });
      }
    } catch (error: any) {
      setErrorMessage(error.message || 'Transaction failed');
    }
  };

  const needsApproval = () => {
    if (actionType === 'sell') return false; // Selling doesn't need approval
    if (paymentMethod === 'eth') return false; // ETH doesn't need approval
    if (!amount || !tokenDecimals || !allowance) return true;

    try {
      const amountInWei = parseUnits(amount, tokenDecimals);
      return allowance < amountInWei;
    } catch {
      return true;
    }
  };

  const getButtonText = () => {
    if (isApprovePending || isApproveConfirming) return 'Approving...';
    if (isTxPending || isTxConfirming) return 'Processing...';
    if (needsApproval()) return `Approve ${tokenSymbol || 'Tokens'}`;

    if (actionType === 'buy') {
      const method = paymentMethod === 'eth' ? 'ETH' : tokenSymbol || 'Tokens';
      return `Buy ${position.toUpperCase()} with ${method}`;
    } else {
      return `Sell ${position.toUpperCase()} Shares`;
    }
  };

  const handleButtonClick = () => {
    if (needsApproval()) {
      handleApprove();
    } else {
      handleTransaction();
    }
  };

  if (!gameInfo || !marketDisplay) {
    return (
      <>
        <div
          className="fixed inset-0 cursor-pointer"
          style={{
            zIndex: 200,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
          }}
          onClick={onClose}
        />
        <div
          className="fixed"
          style={{
            zIndex: 201,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'clamp(280px, 92vw, 600px)',
            padding: '20px',
          }}
        >
          <div className="bg-gray-800/50 p-6 rounded-lg animate-pulse">
            <div className="h-32 bg-gray-700/50 rounded"></div>
          </div>
        </div>
      </>
    );
  }

  const yesPrice = marketDisplay.yesPrice ? Number(marketDisplay.yesPrice) / 100 : 50;
  const noPrice = marketDisplay.noPrice ? Number(marketDisplay.noPrice) / 100 : 50;
  const userYesShares = marketDisplay.userYesShares ? formatUnits(marketDisplay.userYesShares, tokenDecimals || 18) : '0';
  const userNoShares = marketDisplay.userNoShares ? formatUnits(marketDisplay.userNoShares, tokenDecimals || 18) : '0';

  const stateNames = ['Inactive', 'Dealing', 'Active', 'Hitting', 'Standing', 'Busted', 'Finished'];
  const stateName = stateNames[Number(gameInfo.state)] || 'Unknown';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 cursor-pointer"
        style={{
          zIndex: 200,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed"
        style={{
          zIndex: 201,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'clamp(280px, 92vw, 600px)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(168, 85, 247, 0.08), rgba(99, 102, 241, 0.05))',
          backgroundColor: 'rgba(17, 24, 39, 0.98)',
          border: '2px solid rgba(139, 92, 246, 0.3)',
          borderRadius: '16px',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 0 50px rgba(139, 92, 246, 0.3), 0 0 100px rgba(168, 85, 247, 0.2)',
          padding: '20px',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-red-400 transition-colors text-2xl font-bold z-10"
        >
          ✕
        </button>

        {/* Title */}
        <h2
          className="text-2xl font-bold text-center mb-4"
          style={{
            color: '#fff',
            textShadow: '0 0 20px rgba(168, 85, 247, 0.8)',
          }}
        >
          Prediction Market
        </h2>

        {/* Game Info */}
        <div className="bg-gray-800/50 p-4 rounded-lg mb-4">
          <div className="flex justify-between items-center mb-2">
            <div className="text-white font-semibold">Game #{gameId.toString()}</div>
            <div className={`px-2 py-1 rounded text-xs font-semibold ${
              stateName === 'Active' ? 'bg-green-900/50 text-green-300' :
              stateName === 'Dealing' ? 'bg-yellow-900/50 text-yellow-300' :
              stateName === 'Busted' ? 'bg-red-900/50 text-red-300' :
              'bg-gray-700/50 text-gray-300'
            }`}>
              {stateName}
            </div>
          </div>

          <div className="flex gap-4 text-sm mb-3">
            <div>
              <div className="text-gray-400 text-xs">Player</div>
              <div className="text-white font-bold">{gameInfo.playerTotal.toString()}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs">Dealer</div>
              <div className="text-white font-bold">{gameInfo.dealerTotal.toString()}</div>
            </div>
          </div>

          {/* Market Prices */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-green-900/30 p-3 rounded-lg">
              <div className="text-green-300 text-xs mb-1">YES Price</div>
              <div className="text-white font-bold text-lg">{yesPrice.toFixed(1)}%</div>
            </div>
            <div className="bg-red-900/30 p-3 rounded-lg">
              <div className="text-red-300 text-xs mb-1">NO Price</div>
              <div className="text-white font-bold text-lg">{noPrice.toFixed(1)}%</div>
            </div>
          </div>

          {/* User Shares */}
          {(Number(userYesShares) > 0 || Number(userNoShares) > 0) && (
            <div className="mt-3 pt-3 border-t border-gray-700">
              <div className="text-gray-400 text-xs mb-2">Your Shares</div>
              <div className="flex gap-4 text-sm">
                {Number(userYesShares) > 0 && (
                  <div>
                    <span className="text-green-300">YES: </span>
                    <span className="text-white font-semibold">{Number(userYesShares).toFixed(4)}</span>
                  </div>
                )}
                {Number(userNoShares) > 0 && (
                  <div>
                    <span className="text-red-300">NO: </span>
                    <span className="text-white font-semibold">{Number(userNoShares).toFixed(4)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Trading Status */}
          {!marketDisplay.tradingActive && (
            <div className="mt-3 text-yellow-300 text-xs text-center">
              Trading is not active for this market
            </div>
          )}
          {marketDisplay.resolved && (
            <div className="mt-3 text-purple-300 text-xs text-center">
              Market resolved
            </div>
          )}
        </div>

        {/* Action Type Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActionType('buy')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
              actionType === 'buy'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setActionType('sell')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
              actionType === 'sell'
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Sell
          </button>
        </div>

        {/* Position Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setPosition('yes')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
              position === 'yes'
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            YES
          </button>
          <button
            onClick={() => setPosition('no')}
            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
              position === 'no'
                ? 'bg-red-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            NO
          </button>
        </div>

        {/* Payment Method Toggle (only for buying) */}
        {actionType === 'buy' && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setPaymentMethod('token')}
              disabled={!tokenBalance || tokenBalance === 0n}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
                paymentMethod === 'token'
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {tokenSymbol || 'Token'}
            </button>
            <button
              onClick={() => setPaymentMethod('eth')}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all ${
                paymentMethod === 'eth'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              ETH
            </button>
          </div>
        )}

        {/* Amount Input */}
        <div className="mb-4">
          <label className="block text-gray-300 text-sm mb-2">
            {actionType === 'buy'
              ? `Amount (${paymentMethod === 'eth' ? 'ETH' : tokenSymbol || 'Tokens'})`
              : 'Shares to Sell'
            }
          </label>
          <input
            type="text"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
          />

          {/* Balance display */}
          <div className="mt-2 text-xs text-gray-400">
            {actionType === 'buy' && paymentMethod === 'token' && (
              <div>Balance: {formattedTokenBalance} {tokenSymbol}</div>
            )}
            {actionType === 'sell' && (
              <div>
                Your Shares: {position === 'yes' ? userYesShares : userNoShares}
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded-lg text-red-200 text-sm">
            {errorMessage}
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleButtonClick}
          disabled={
            !amount ||
            !marketDisplay.tradingActive ||
            isApprovePending ||
            isApproveConfirming ||
            isTxPending ||
            isTxConfirming
          }
          className="w-full py-3 px-6 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold rounded-lg transition-all"
        >
          {getButtonText()}
        </button>

        {/* Market Stats */}
        <div className="mt-4 pt-4 border-t border-gray-700">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-gray-400">Total Deposits</div>
              <div className="text-white font-semibold">
                {marketDisplay.totalDeposits ? formatUnits(marketDisplay.totalDeposits, tokenDecimals || 18) : '0'} {tokenSymbol}
              </div>
            </div>
            <div>
              <div className="text-gray-400">Volume</div>
              <div className="text-white font-semibold">
                {marketDisplay.volume ? formatUnits(marketDisplay.volume, tokenDecimals || 18) : '0'} {tokenSymbol}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
