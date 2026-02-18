'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, useBalance } from 'wagmi';
import { formatUnits, formatEther, parseEther } from 'viem';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { base } from 'wagmi/chains';
import { getContracts } from '@/config/contracts';
import {
  useMarketplaceStats,
  useWassBalance,
  useWassAllowance,
  useApproveWass,
  useBuyWithWass,
  useBuyWithEth,
  useQuoteEthForListing,
  MarketplaceListing,
} from '@/hooks/useMarketplace';
import {
  useItemsWithBalances,
  useItemInfo,
  useBuyQuote,
  useSellQuote,
  useBuyPresale,
  useBuyPresaleWithEth,
  useBuyFromCurve,
  useBuyFromCurveWithEth,
  useSellToCurve,
  useGlobalStats,
  useWassAllowanceForItems,
} from '@/hooks/useBondedItems';
import { TokenPhase, BondedItem, formatWass, parseWass } from '@/types/bonded-items';
import { getNFTImageUrl, resolveIPFSUrl } from '@/config/contracts';

// LOCAL price formatter - DIRECT MATH, no library dependencies
// Handles both 18-decimal (presale) and 36-decimal (bonding curve) prices
function formatItemPrice(price: bigint | number | string | undefined, decimals: number = 2): string {
  if (price === undefined || price === null) return '0.00';

  // Convert to string first to preserve precision
  let priceStr: string;
  if (typeof price === 'bigint') {
    priceStr = price.toString();
  } else if (typeof price === 'number') {
    priceStr = Math.floor(price).toString();
  } else {
    priceStr = String(price).split('.')[0];
  }

  // Detect scaling: bonding curve prices have 36 digits (double-scaled by 1e36)
  // Presale prices have ~18 digits (scaled by 1e18)
  // If length > 30, it's a bonding curve price - divide by 1e36
  // Otherwise, divide by 1e18
  const PRESALE_DECIMALS = 18;
  const CURVE_DECIMALS = 36;
  const weiDecimals = priceStr.length > 30 ? CURVE_DECIMALS : PRESALE_DECIMALS;

  // Pad with leading zeros if needed
  while (priceStr.length <= weiDecimals) {
    priceStr = '0' + priceStr;
  }

  // Insert decimal point at the right position
  const integerPart = priceStr.slice(0, -weiDecimals) || '0';
  const decimalPart = priceStr.slice(-weiDecimals);

  // Combine and parse
  const result = parseFloat(`${integerPart}.${decimalPart}`);
  return result.toFixed(decimals);
}

// =============================================================================
// TYPES
// =============================================================================

type MarketTab = 'nfts' | 'items';
type ItemFilter = 'all' | 'presale' | 'trading' | 'rare' | 'owned';

interface ListingWithMetadata extends MarketplaceListing {
  name?: string;
  imageUrl?: string;
  nftType?: string;
}

interface BondedItemWithBalance extends BondedItem {
  userBalance: bigint;
}

// =============================================================================
// NFT BUY MODAL
// =============================================================================

interface BuyModalProps {
  listing: ListingWithMetadata | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function BuyModal({ listing, isOpen, onClose, onSuccess }: BuyModalProps) {
  const { address } = useAccount();
  const [paymentMethod, setPaymentMethod] = useState<'wass' | 'eth'>('wass');
  const [step, setStep] = useState<'select' | 'approve' | 'buy' | 'success'>('select');

  const { balance: wassBalance, balanceFormatted: wassBalanceFormatted } = useWassBalance();
  const { allowance, refetch: refetchAllowance } = useWassAllowance();
  const { data: ethBalanceData } = useBalance({ address, chainId: base.id });
  const { ethNeeded, ethNeededFormatted } = useQuoteEthForListing(
    listing?.collection || '0x0000000000000000000000000000000000000000',
    listing?.tokenId || 0n
  );

  const {
    approveWass,
    isPending: isApproving,
    isConfirming: isApprovingConfirming,
    isSuccess: approveSuccess,
    error: approveError,
    reset: resetApprove,
  } = useApproveWass();

  const {
    buyWithWass,
    isPending: isBuyingWass,
    isConfirming: isBuyingWassConfirming,
    isSuccess: buyWassSuccess,
    error: buyWassError,
    reset: resetBuyWass,
  } = useBuyWithWass();

  const {
    buyWithEth,
    isPending: isBuyingEth,
    isConfirming: isBuyingEthConfirming,
    isSuccess: buyEthSuccess,
    error: buyEthError,
    reset: resetBuyEth,
  } = useBuyWithEth();

  useEffect(() => {
    if (isOpen) {
      setStep('select');
      setPaymentMethod('wass');
      resetApprove();
      resetBuyWass();
      resetBuyEth();
    }
  }, [isOpen, resetApprove, resetBuyWass, resetBuyEth]);

  useEffect(() => {
    if (approveSuccess) {
      refetchAllowance();
      setStep('buy');
      handleBuy();
    }
  }, [approveSuccess]);

  useEffect(() => {
    if (buyWassSuccess || buyEthSuccess) {
      setStep('success');
      onSuccess();
    }
  }, [buyWassSuccess, buyEthSuccess, onSuccess]);

  if (!isOpen || !listing) return null;

  const hasEnoughWass = wassBalance >= listing.price;
  const hasEnoughEth = ethBalanceData && ethBalanceData.value >= ethNeeded;
  const needsApproval = paymentMethod === 'wass' && allowance < listing.price;

  const handleBuy = async () => {
    if (!listing) return;

    if (paymentMethod === 'wass') {
      if (needsApproval) {
        setStep('approve');
        await approveWass();
      } else {
        setStep('buy');
        await buyWithWass(listing.collection, listing.tokenId);
      }
    } else {
      setStep('buy');
      await buyWithEth(listing.collection, listing.tokenId, ethNeededFormatted, 0n);
    }
  };

  const isProcessing = isApproving || isApprovingConfirming || isBuyingWass || isBuyingWassConfirming || isBuyingEth || isBuyingEthConfirming;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="rounded-2xl w-full max-w-md relative"
        style={{
          background: 'linear-gradient(135deg, rgba(197, 169, 123, 0.05), rgba(255, 208, 117, 0.08))',
          backgroundColor: 'rgba(10, 13, 12, 0.98)',
          border: '2px solid rgba(197, 169, 123, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(197, 169, 123, 0.3), rgba(255, 208, 117, 0.3))' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🛒</span>
              <div>
                <h2 className="font-bold text-lg text-white">Buy NFT</h2>
                <p className="text-[#ffd075] text-sm">{listing.name || `#${listing.tokenId.toString()}`}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-[#c5a97b] hover:text-[#ffd075] text-xl">✕</button>
          </div>
        </div>

        <div className="p-4 border-b border-[rgba(255,208,117,0.2)]">
          <div className="flex items-center gap-4">
            <img src={listing.imageUrl || getNFTImageUrl(Number(listing.tokenId))} alt={listing.name || `NFT #${listing.tokenId}`} className="w-24 h-24 rounded-lg object-cover" />
            <div className="flex-1">
              <p className="text-[#8a9090] text-sm">Price</p>
              <p className="text-3xl font-bold text-white">{listing.priceFormatted} wASS</p>
              <p className="text-[#6b7575] text-xs mt-1">≈ {ethNeededFormatted} ETH</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          {step === 'select' && (
            <>
              <div className="mb-4">
                <p className="text-[#8a9090] text-sm mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setPaymentMethod('wass')} className={`p-3 rounded-lg border-2 transition-all ${paymentMethod === 'wass' ? 'border-green-500 bg-[rgba(34,197,94,0.1)]' : 'border-[rgba(255,255,255,0.06)] bg-[#1a2221]/50'}`}>
                    <p className="font-bold text-white">wASS</p>
                    <p className="text-xs text-[#8a9090]">{parseFloat(wassBalanceFormatted).toFixed(2)} available</p>
                    {!hasEnoughWass && <p className="text-xs text-red-400 mt-1">Insufficient</p>}
                  </button>
                  <button onClick={() => setPaymentMethod('eth')} className={`p-3 rounded-lg border-2 transition-all ${paymentMethod === 'eth' ? 'border-[rgba(255,208,117,0.4)] bg-[rgba(255,208,117,0.1)]' : 'border-[rgba(255,255,255,0.06)] bg-[#1a2221]/50'}`}>
                    <p className="font-bold text-white">ETH</p>
                    <p className="text-xs text-[#8a9090]">{ethBalanceData ? parseFloat(formatUnits(ethBalanceData.value, 18)).toFixed(4) : '0'} available</p>
                    {!hasEnoughEth && <p className="text-xs text-red-400 mt-1">Insufficient</p>}
                  </button>
                </div>
              </div>
              <button onClick={handleBuy} disabled={isProcessing || (paymentMethod === 'wass' && !hasEnoughWass) || (paymentMethod === 'eth' && !hasEnoughEth)} className="w-full py-3 rounded-lg font-semibold disabled:opacity-50" style={{ background: 'linear-gradient(135deg, rgba(197, 169, 123, 0.8), rgba(255, 208, 117, 0.8))', color: '#0a0d0c' }}>
                {needsApproval ? 'Approve & Buy' : 'Buy Now'}
              </button>
            </>
          )}
          {step === 'approve' && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ffd075] mx-auto mb-4"></div>
              <p className="text-white font-medium mb-2">{isApproving ? 'Confirm in wallet...' : 'Approving wASS...'}</p>
              {approveError && <p className="text-red-400 text-sm mt-2">{approveError.message}</p>}
            </div>
          )}
          {step === 'buy' && (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ffd075] mx-auto mb-4"></div>
              <p className="text-white font-medium mb-2">{(isBuyingWass || isBuyingEth) ? 'Confirm in wallet...' : 'Processing...'}</p>
              {(buyWassError || buyEthError) && <p className="text-red-400 text-sm mt-2">{(buyWassError || buyEthError)?.message}</p>}
            </div>
          )}
          {step === 'success' && (
            <div className="text-center py-4">
              <div className="text-5xl mb-4">🎉</div>
              <p className="text-white font-bold text-xl mb-2">Purchased!</p>
              <button onClick={onClose} className="w-full py-3 rounded-lg font-semibold" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8))', color: 'white' }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ITEM BUY MODAL (Presale + Curve)
// =============================================================================

interface ItemBuyModalProps {
  item: BondedItemWithBalance | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ItemBuyModal({ item, isOpen, onClose, onSuccess }: ItemBuyModalProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState('1');
  const [step, setStep] = useState<'input' | 'processing' | 'success'>('input');
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'wass' | 'eth'>('wass');
  const [ethQuote, setEthQuote] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);

  const { balance: wassBalance, balanceFormatted: wassBalanceFormatted } = useWassBalance();
  const { data: ethBalance } = useBalance({ address });
  const { buyPresaleWithWass, isPending: isPresalePending, isApproving: isPresaleApproving, reset: resetPresale } = useBuyPresale();
  const { buyPresaleWithEth, isPending: isPresaleEthPending, reset: resetPresaleEth } = useBuyPresaleWithEth();
  const { buyFromCurve, isPending: isCurvePending, isApproving: isCurveApproving, reset: resetCurve } = useBuyFromCurve();
  const { buyFromCurveWithEth, isPending: isCurveEthPending, reset: resetCurveEth } = useBuyFromCurveWithEth();

  const amountNum = parseInt(amount) || 0;
  const isPresale = item?.phase === TokenPhase.Presale;
  const isCurve = item?.phase === TokenPhase.BondingCurve;

  // Calculate cost
  const totalCost = useMemo(() => {
    if (!item) return 0n;
    if (isPresale) {
      return item.presalePrice * BigInt(amountNum);
    }
    return item.currentPrice * BigInt(amountNum);
  }, [item, amountNum, isPresale]);

  const hasEnoughWass = wassBalance >= totalCost;

  // Get ETH quote when payment method is ETH
  useEffect(() => {
    if (paymentMethod === 'eth' && totalCost > 0n && isOpen) {
      setIsQuoting(true);
      // Estimate ETH needed: wASS price * 1.5 buffer (rough estimate without quoter)
      // In production, you'd want to use a proper quoter
      const wassInEth = Number(totalCost) / 1e18;
      const estimatedEth = (wassInEth * 0.0001 * 1.5).toFixed(6); // Rough estimate with 50% buffer
      setEthQuote(estimatedEth);
      setIsQuoting(false);
    }
  }, [paymentMethod, totalCost, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setAmount('1');
      setStep('input');
      setError(null);
      setPaymentMethod('wass');
      setEthQuote(null);
      resetPresale();
      resetPresaleEth();
      resetCurve();
      resetCurveEth();
    }
  }, [isOpen, resetPresale, resetPresaleEth, resetCurve, resetCurveEth]);

  if (!isOpen || !item) return null;

  const handleBuy = async () => {
    if (!item || amountNum <= 0) return;
    setError(null);
    setStep('processing');

    try {
      if (paymentMethod === 'wass') {
        // Pay with wASS
        if (isPresale) {
          await buyPresaleWithWass(Number(item.tokenId), amountNum, item.presalePrice);
        } else if (isCurve) {
          // V3: buyFromCurve(tokenId, tokenAmount, maxWassIn)
          const tokenAmount = BigInt(amountNum);
          const maxWassIn = (item.currentPrice * tokenAmount * 110n) / 100n; // 10% slippage buffer
          await buyFromCurve(Number(item.tokenId), tokenAmount, maxWassIn);
        }
      } else {
        // Pay with ETH
        const ethAmount = ethQuote || '0.01'; // Fallback
        if (isPresale) {
          const minWassOut = (totalCost * 90n) / 100n; // 10% slippage
          await buyPresaleWithEth(Number(item.tokenId), amountNum, ethAmount, minWassOut);
        } else if (isCurve) {
          // V3: buyFromCurveWithEth(tokenId, ethAmount, tokenAmount, minWassFromSwap)
          const tokenAmount = BigInt(amountNum);
          const minWassFromSwap = (item.currentPrice * tokenAmount * 90n) / 100n; // 10% slippage
          await buyFromCurveWithEth(Number(item.tokenId), ethAmount, tokenAmount, minWassFromSwap);
        }
      }
      setStep('success');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('input');
    }
  };

  const isProcessing = isPresalePending || isPresaleEthPending || isCurvePending || isCurveEthPending || isPresaleApproving || isCurveApproving;
  const canBuy = paymentMethod === 'wass' ? hasEnoughWass : true; // ETH balance check is handled by wallet

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="rounded-2xl w-full max-w-md relative"
        style={{
          background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.05), rgba(255, 208, 117, 0.08))',
          backgroundColor: 'rgba(10, 13, 12, 0.98)',
          border: '2px solid rgba(34, 197, 94, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(255, 208, 117, 0.3))' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{isPresale ? '🎯' : '📈'}</span>
              <div>
                <h2 className="font-bold text-lg text-white">{isPresale ? 'Buy Presale' : 'Buy from Curve'}</h2>
                <p className="text-green-200 text-sm">{item.name || `Item #${item.tokenId}`}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-green-300 hover:text-green-200 text-xl">✕</button>
          </div>
        </div>

        <div className="p-4">
          {step === 'input' && (
            <>
              {/* Payment Method Selector */}
              <div className="mb-4">
                <p className="text-[#8a9090] text-sm mb-2">Payment Method</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPaymentMethod('wass')}
                    className={`p-3 rounded-lg border-2 transition-all ${paymentMethod === 'wass' ? 'border-green-500 bg-[rgba(34,197,94,0.1)]' : 'border-[rgba(255,255,255,0.06)] bg-[#1a2221]/50'}`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <img src="/Images/Token.png" alt="wASS" className="w-5 h-5" />
                      <span className="font-bold text-white">wASS</span>
                    </div>
                    <p className="text-xs text-[#8a9090] mt-1">{parseFloat(wassBalanceFormatted).toFixed(2)} available</p>
                  </button>
                  <button
                    onClick={() => setPaymentMethod('eth')}
                    className={`p-3 rounded-lg border-2 transition-all ${paymentMethod === 'eth' ? 'border-[rgba(255,208,117,0.4)] bg-[rgba(255,208,117,0.1)]' : 'border-[rgba(255,255,255,0.06)] bg-[#1a2221]/50'}`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <img src="/Images/Ether.png" alt="ETH" className="w-5 h-5" />
                      <span className="font-bold text-white">ETH</span>
                    </div>
                    <p className="text-xs text-[#8a9090] mt-1">{ethBalance ? parseFloat(formatEther(ethBalance.value)).toFixed(4) : '0'} available</p>
                  </button>
                </div>
              </div>

              {/* Item Info */}
              <div className="mb-4 p-3 bg-[#171e1d]/50 rounded-lg">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#8a9090]">Phase</span>
                  <span className={`font-medium ${isPresale ? 'text-yellow-400' : 'text-green-400'}`}>{item.phaseName}</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#8a9090]">Price per Item</span>
                  <span className="text-white">{formatItemPrice(item.currentPrice, 4)} wASS</span>
                </div>
                {isPresale && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#8a9090]">Remaining</span>
                    <span className="text-white">{item.presaleRemaining.toString()} / {item.presaleSupply.toString()}</span>
                  </div>
                )}
              </div>

              {/* Amount Input */}
              <div className="mb-4">
                <label className="block text-[#8a9090] text-sm mb-2">Amount to Buy</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1"
                    max={isPresale ? item.presaleRemaining.toString() : '1000'}
                    className="flex-1 bg-[#1a2221]/50 border border-green-500/30 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-green-500"
                  />
                  <div className="flex gap-1">
                    {['1', '5', '10'].map((qty) => (
                      <button key={qty} onClick={() => setAmount(qty)} className="px-3 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.06)] rounded-lg text-[#cecece] hover:bg-[#1f2827] text-sm">
                        {qty}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cost Summary */}
              <div className="mb-4 p-3 bg-[#171e1d]/50 rounded-lg">
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-white">Total Cost</span>
                  <span className="text-green-400">{formatWass(totalCost, 4)} wASS</span>
                </div>
                {paymentMethod === 'eth' && (
                  <div className="flex justify-between text-xs mt-1 text-[#ffd075]">
                    <span>Paid via OTC Router</span>
                    <span>{isQuoting ? 'Quoting...' : `~${ethQuote || '?'} ETH`}</span>
                  </div>
                )}
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-[#6b7575]">Your {paymentMethod === 'wass' ? 'wASS' : 'ETH'} Balance</span>
                  <span className={paymentMethod === 'wass' ? (hasEnoughWass ? 'text-[#8a9090]' : 'text-red-400') : 'text-[#8a9090]'}>
                    {paymentMethod === 'wass' ? `${parseFloat(wassBalanceFormatted).toFixed(2)} wASS` : `${ethBalance ? parseFloat(formatEther(ethBalance.value)).toFixed(4) : '0'} ETH`}
                  </span>
                </div>
              </div>

              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

              <button
                onClick={handleBuy}
                disabled={isProcessing || !canBuy || amountNum <= 0}
                className="w-full py-3 rounded-lg font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8))', color: 'white' }}
              >
                {!canBuy ? 'Insufficient Balance' : `Buy with ${paymentMethod === 'wass' ? 'wASS' : 'ETH'}`}
              </button>
            </>
          )}

          {step === 'processing' && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
              <p className="text-white font-medium mb-2">
                {isPresaleApproving || isCurveApproving ? 'Approving wASS...' : paymentMethod === 'eth' ? 'Swapping ETH → wASS...' : 'Processing purchase...'}
              </p>
              <p className="text-[#8a9090] text-sm">Confirm in your wallet</p>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">🎉</div>
              <p className="text-white font-bold text-xl mb-2">Purchased!</p>
              <p className="text-[#8a9090] mb-4">You bought {amountNum} item{amountNum > 1 ? 's' : ''}</p>
              <button onClick={onClose} className="w-full py-3 rounded-lg font-semibold" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8))', color: 'white' }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ITEM SELL MODAL (Curve only)
// =============================================================================

interface ItemSellModalProps {
  item: BondedItemWithBalance | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ItemSellModal({ item, isOpen, onClose, onSuccess }: ItemSellModalProps) {
  const [amount, setAmount] = useState('1');
  const [step, setStep] = useState<'input' | 'processing' | 'success'>('input');
  const [error, setError] = useState<string | null>(null);

  const { sellToCurve, isPending, reset: resetSell } = useSellToCurve();
  const amountNum = parseInt(amount) || 0;
  const tokenAmount = BigInt(amountNum);
  const { quote } = useSellQuote(item?.tokenId || 0n, tokenAmount);

  useEffect(() => {
    if (isOpen) {
      setAmount('1');
      setStep('input');
      setError(null);
      resetSell();
    }
  }, [isOpen, resetSell]);

  if (!isOpen || !item || item.phase !== TokenPhase.BondingCurve) return null;

  const hasEnoughItems = item.userBalance >= tokenAmount;

  const handleSell = async () => {
    if (!item || amountNum <= 0 || !quote) return;
    setError(null);
    setStep('processing');

    try {
      // Use 10% slippage - V3 returns netReturn (after fees)
      const slippage = 10n;
      const minWassOut = (quote.netReturn * (100n - slippage)) / 100n;
      await sellToCurve(Number(item.tokenId), tokenAmount, minWassOut);
      setStep('success');
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
      setStep('input');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="rounded-2xl w-full max-w-md relative"
        style={{
          background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.05), rgba(255, 208, 117, 0.08))',
          backgroundColor: 'rgba(10, 13, 12, 0.98)',
          border: '2px solid rgba(239, 68, 68, 0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-t-2xl p-4" style={{ background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(255, 208, 117, 0.3))' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📉</span>
              <div>
                <h2 className="font-bold text-lg text-white">Sell to Curve</h2>
                <p className="text-red-200 text-sm">Item #{item.tokenId.toString()}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-red-300 hover:text-red-200 text-xl">✕</button>
          </div>
        </div>

        <div className="p-4">
          {step === 'input' && (
            <>
              <div className="mb-4 p-3 bg-[#171e1d]/50 rounded-lg">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#8a9090]">Your Balance</span>
                  <span className="text-white">{item.userBalance.toString()} items</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#8a9090]">Current Price</span>
                  <span className="text-white">{formatItemPrice(item.currentPrice, 4)} wASS</span>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-[#8a9090] text-sm mb-2">Amount to Sell</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1"
                    max={item.userBalance.toString()}
                    className="flex-1 bg-[#1a2221]/50 border border-red-500/30 rounded-lg px-4 py-3 text-white text-lg focus:outline-none focus:border-red-500"
                  />
                  <button onClick={() => setAmount(item.userBalance.toString())} className="px-4 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.06)] rounded-lg text-[#cecece] hover:bg-[#1f2827] text-sm">
                    Max
                  </button>
                </div>
              </div>

              <div className="mb-4 p-3 bg-[#171e1d]/50 rounded-lg">
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-white">You Receive</span>
                  <span className="text-green-400">{quote ? quote.netReturnFormatted : '0'} wASS</span>
                </div>
                {quote && (
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-[#6b7575]">Fee (5%)</span>
                    <span className="text-[#8a9090]">{quote.feeFormatted} wASS</span>
                  </div>
                )}
              </div>

              {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

              <button
                onClick={handleSell}
                disabled={isPending || !hasEnoughItems || amountNum <= 0}
                className="w-full py-3 rounded-lg font-semibold disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.8), rgba(220, 38, 38, 0.8))', color: 'white' }}
              >
                {!hasEnoughItems ? 'Insufficient Items' : `Sell ${amountNum} Item${amountNum > 1 ? 's' : ''}`}
              </button>
            </>
          )}

          {step === 'processing' && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
              <p className="text-white font-medium mb-2">Processing sale...</p>
              <p className="text-[#8a9090] text-sm">Confirm in your wallet</p>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4">💰</div>
              <p className="text-white font-bold text-xl mb-2">Sold!</p>
              <p className="text-[#8a9090] mb-4">You sold {amountNum} item{amountNum > 1 ? 's' : ''}</p>
              <button onClick={onClose} className="w-full py-3 rounded-lg font-semibold" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8))', color: 'white' }}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// NFT LISTING CARD
// =============================================================================

function ListingCard({ listing, onBuy, isOwner }: { listing: ListingWithMetadata; onBuy: (l: ListingWithMetadata) => void; isOwner: boolean }) {
  return (
    <div
      className="rounded-xl overflow-hidden transition-all hover:scale-[1.02] cursor-pointer"
      style={{ background: 'linear-gradient(135deg, rgba(10, 13, 12, 0.9), rgba(23, 30, 29, 0.9))', border: '1px solid rgba(255, 255, 255, 0.06)' }}
      onClick={() => !isOwner && onBuy(listing)}
    >
      <div className="relative aspect-square">
        <img src={listing.imageUrl || getNFTImageUrl(Number(listing.tokenId))} alt={listing.name || `NFT #${listing.tokenId}`} className="w-full h-full object-cover" />
        {isOwner && <div className="absolute top-2 right-2 px-2 py-1 bg-[#c5a97b] rounded text-xs text-white font-medium">Your Listing</div>}
      </div>
      <div className="p-3">
        <p className="text-white font-medium text-sm truncate">{listing.name || `AppleSnake #${listing.tokenId}`}</p>
        <div className="flex items-center justify-between mt-2">
          <div>
            <p className="text-[#6b7575] text-xs">Price</p>
            <p className="text-green-400 font-bold">{listing.priceFormatted} wASS</p>
          </div>
          {!isOwner && <button className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'linear-gradient(135deg, rgba(197, 169, 123, 0.8), rgba(255, 208, 117, 0.8))', color: '#0a0d0c' }}>Buy</button>}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ITEM CARD
// =============================================================================

function ItemCard({ item, onBuy, onSell }: { item: BondedItemWithBalance; onBuy: (i: BondedItemWithBalance) => void; onSell: (i: BondedItemWithBalance) => void }) {
  const isPresale = item.phase === TokenPhase.Presale;
  const isCurve = item.phase === TokenPhase.BondingCurve;
  const isRare = item.phase === TokenPhase.RareItem;
  const canBuy = isPresale || isCurve;
  const canSell = isCurve && item.userBalance > 0n;

  const phaseStyles = isPresale
    ? { badge: 'bg-yellow-500/30 text-yellow-400 border border-yellow-500/50', price: 'text-yellow-400' }
    : isCurve
    ? { badge: 'bg-green-500/30 text-green-400 border border-green-500/50', price: 'text-green-400' }
    : { badge: 'bg-[rgba(255,208,117,0.3)] text-[#ffd075] border border-[rgba(255,208,117,0.5)]', price: 'text-[#ffd075]' };

  return (
    <div
      className="rounded-xl overflow-hidden transition-all hover:scale-[1.02]"
      style={{ background: 'linear-gradient(135deg, rgba(10, 13, 12, 0.9), rgba(23, 30, 29, 0.9))', border: `1px solid rgba(${isPresale ? '234, 179, 8' : isCurve ? '34, 197, 94' : '255, 208, 117'}, 0.3)` }}
    >
      {/* Item Image */}
      <div className="relative aspect-square bg-gradient-to-br from-[#1f2827] to-[#1a2221]">
        <img
          src={item.imageUrl || `https://applesnakes.myfilebase.com/ipns/k51qzi5uqu5dhjx71frx5mayqp1qrxt86fb4j1xrensivrd3l2uq8n72b9ac7i/images/${item.tokenId.toString()}.png`}
          alt={item.name || `Item #${item.tokenId.toString()}`}
          className="w-full h-full object-cover"
          onError={(e) => {
            // Fallback to emoji if image fails
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            target.parentElement!.innerHTML = `<span class="text-6xl flex items-center justify-center h-full">${isPresale ? '🎯' : isCurve ? '📈' : '💎'}</span>`;
          }}
        />
        <div className={`absolute top-2 left-2 px-2 py-1 rounded text-xs font-medium ${phaseStyles.badge}`}>
          {item.phaseName}
        </div>
        {item.userBalance > 0n && (
          <div className="absolute top-2 right-2 px-2 py-1 bg-[#c5a97b] rounded text-xs text-white font-medium">
            x{item.userBalance.toString()}
          </div>
        )}
      </div>

      <div className="p-3">
        <p className="text-white font-medium text-sm">{item.name || `Item #${item.tokenId}`}</p>
        <p className="text-[#6b7575] text-xs">#{item.tokenId.toString()}</p>

        {/* Progress bar for presale */}
        {isPresale && (
          <div className="mt-2">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[#8a9090]">Progress</span>
              <span className="text-yellow-400">{item.presaleProgress}%</span>
            </div>
            <div className="h-1.5 bg-[#1f2827] rounded-full overflow-hidden">
              <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${item.presaleProgress}%` }} />
            </div>
          </div>
        )}

        {/* Price */}
        <div className="mt-2">
          <p className="text-[#6b7575] text-xs">Price</p>
          <p className={`font-bold ${phaseStyles.price}`}>{formatItemPrice(item.currentPrice)} wASS</p>
        </div>

        {/* Stats for curve */}
        {isCurve && item.curve && (
          <div className="mt-2 text-xs text-[#8a9090]">
            <span>Liquidity: {item.curve.realWassFormatted} wASS</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-3">
          {canBuy && (
            <button
              onClick={() => onBuy(item)}
              className="flex-1 py-2 rounded-lg text-sm font-medium"
              style={{ background: `linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8))`, color: 'white' }}
            >
              Buy
            </button>
          )}
          {canSell && (
            <button
              onClick={() => onSell(item)}
              className="flex-1 py-2 rounded-lg text-sm font-medium"
              style={{ background: `linear-gradient(135deg, rgba(239, 68, 68, 0.8), rgba(220, 38, 38, 0.8))`, color: 'white' }}
            >
              Sell
            </button>
          )}
          {isRare && (
            <button disabled className="flex-1 py-2 rounded-lg text-sm font-medium bg-[#1f2827] text-[#8a9090] cursor-not-allowed">
              Marketplace Only
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MARKET PAGE
// =============================================================================

export default function MarketPage() {
  const { address } = useAccount();
  const contracts = getContracts(base.id);

  // Tab state
  const [activeTab, setActiveTab] = useState<MarketTab>('nfts');
  const [itemFilter, setItemFilter] = useState<ItemFilter>('all');

  // NFT marketplace state
  const { stats: nftStats, refetch: refetchNftStats } = useMarketplaceStats();
  const [listings, setListings] = useState<ListingWithMetadata[]>([]);
  const [isLoadingListings, setIsLoadingListings] = useState(true);
  const [listingsError, setListingsError] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingWithMetadata | null>(null);
  const [sortBy, setSortBy] = useState<'price_asc' | 'price_desc' | 'newest'>('newest');

  // Items state
  const { items, presaleItems, tradingItems, rareItems, ownedItems, stats: itemStats, isLoading: itemsLoading, refetch: refetchItems } = useItemsWithBalances();
  const [selectedItemBuy, setSelectedItemBuy] = useState<BondedItemWithBalance | null>(null);
  const [selectedItemSell, setSelectedItemSell] = useState<BondedItemWithBalance | null>(null);

  // Fetch NFT listings
  const fetchListings = useCallback(async () => {
    setIsLoadingListings(true);
    setListingsError(null);
    try {
      const response = await fetch('/api/marketplace/listings');
      if (!response.ok) throw new Error('Failed to fetch listings');
      const data = await response.json();
      setListings(data.listings || []);
    } catch (err) {
      setListingsError(err instanceof Error ? err.message : 'Failed to load listings');
    } finally {
      setIsLoadingListings(false);
    }
  }, []);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  // Sort listings
  const sortedListings = useMemo(() => {
    return [...listings].sort((a, b) => {
      switch (sortBy) {
        case 'price_asc': return Number(a.price - b.price);
        case 'price_desc': return Number(b.price - a.price);
        default: return Number(b.tokenId - a.tokenId);
      }
    });
  }, [listings, sortBy]);

  // Filter items
  const filteredItems = useMemo(() => {
    switch (itemFilter) {
      case 'presale': return presaleItems;
      case 'trading': return tradingItems;
      case 'rare': return rareItems;
      case 'owned': return ownedItems;
      default: return items;
    }
  }, [items, presaleItems, tradingItems, rareItems, ownedItems, itemFilter]);

  const handleNftBuySuccess = () => {
    fetchListings();
    refetchNftStats();
  };

  const handleItemBuySuccess = () => {
    refetchItems();
    setSelectedItemBuy(null);
  };

  const handleItemSellSuccess = () => {
    refetchItems();
    setSelectedItemSell(null);
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">🏪 Marketplace</h1>
            <p className="text-[#8a9090]">Trade AppleSnakes NFTs and Items for wASS</p>
          </div>
          <ConnectButton />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('nfts')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'nfts'
                ? 'bg-[#c5a97b] text-white'
                : 'bg-[#1a2221] text-[#8a9090] hover:bg-[#1f2827]'
            }`}
          >
            🎨 NFTs
          </button>
          <button
            onClick={() => setActiveTab('items')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              activeTab === 'items'
                ? 'bg-green-600 text-white'
                : 'bg-[#1a2221] text-[#8a9090] hover:bg-[#1f2827]'
            }`}
          >
            📦 Items {items.length > 0 && <span className="ml-1 text-xs">({items.length})</span>}
          </button>
        </div>

        {/* =========================================== */}
        {/* NFTs TAB */}
        {/* =========================================== */}
        {activeTab === 'nfts' && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[#1a2221]/50 rounded-lg p-4">
                <p className="text-[#8a9090] text-sm mb-1">Listed</p>
                <p className="text-3xl font-bold text-white">{listings.length}</p>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-400 text-sm mb-1">Total Sales</p>
                <p className="text-3xl font-bold text-green-400">{nftStats ? nftStats.totalSales.toString() : '0'}</p>
              </div>
              <div className="bg-[rgba(255,208,117,0.1)] border border-[rgba(255,208,117,0.3)] rounded-lg p-4">
                <p className="text-[#ffd075] text-sm mb-1">Volume</p>
                <p className="text-2xl font-bold text-[#ffd075]">{nftStats ? parseFloat(nftStats.totalVolumeFormatted).toFixed(0) : '0'} wASS</p>
              </div>
              <div className="bg-[rgba(255,208,117,0.1)] border border-[rgba(255,208,117,0.3)] rounded-lg p-4">
                <p className="text-[#ffd075] text-sm mb-1">Fee</p>
                <p className="text-3xl font-bold text-[#ffd075]">{nftStats ? nftStats.feePercent : 5}%</p>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className="bg-[#1a2221] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-2 text-white">
                <option value="newest">Newest First</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
              </select>
              <button onClick={fetchListings} className="px-4 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.06)] rounded-lg text-[#cecece] hover:bg-[#1f2827]">🔄 Refresh</button>
            </div>

            {/* Loading/Error/Empty States */}
            {isLoadingListings && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#ffd075] mx-auto mb-4"></div>
                <p className="text-[#8a9090]">Loading listings...</p>
              </div>
            )}

            {listingsError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
                <p className="text-red-400">{listingsError}</p>
                <button onClick={fetchListings} className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500">Retry</button>
              </div>
            )}

            {!isLoadingListings && !listingsError && listings.length === 0 && (
              <div className="text-center py-12">
                <span className="text-6xl mb-4 block">🏪</span>
                <h2 className="text-2xl font-bold text-white mb-2">No Listings Yet</h2>
                <p className="text-[#8a9090] mb-4">Be the first to list your NFT!</p>
                <a href="/my-nfts" className="inline-block px-6 py-3 rounded-lg font-medium" style={{ background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.8))', color: 'white' }}>Go to My NFTs</a>
              </div>
            )}

            {/* Listings Grid */}
            {!isLoadingListings && !listingsError && listings.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {sortedListings.map((listing) => (
                  <ListingCard key={`${listing.collection}-${listing.tokenId}`} listing={listing} onBuy={setSelectedListing} isOwner={listing.seller.toLowerCase() === address?.toLowerCase()} />
                ))}
              </div>
            )}
          </>
        )}

        {/* =========================================== */}
        {/* ITEMS TAB */}
        {/* =========================================== */}
        {activeTab === 'items' && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <p className="text-yellow-400 text-sm mb-1">🎯 Presale</p>
                <p className="text-3xl font-bold text-yellow-400">{presaleItems.length}</p>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <p className="text-green-400 text-sm mb-1">📈 Trading</p>
                <p className="text-3xl font-bold text-green-400">{tradingItems.length}</p>
              </div>
              <div className="bg-[rgba(255,208,117,0.1)] border border-[rgba(255,208,117,0.3)] rounded-lg p-4">
                <p className="text-[#ffd075] text-sm mb-1">💎 Rare</p>
                <p className="text-3xl font-bold text-[#ffd075]">{rareItems.length}</p>
              </div>
              <div className="bg-[rgba(255,208,117,0.1)] border border-[rgba(255,208,117,0.3)] rounded-lg p-4">
                <p className="text-[#ffd075] text-sm mb-1">Volume</p>
                <p className="text-2xl font-bold text-[#ffd075]">{itemStats ? itemStats.totalVolumeFormatted : '0'} wASS</p>
              </div>
            </div>

            {/* Item Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'presale', 'trading', 'rare', 'owned'] as ItemFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setItemFilter(filter)}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    itemFilter === filter
                      ? filter === 'presale' ? 'bg-yellow-600 text-white'
                        : filter === 'trading' ? 'bg-green-600 text-white'
                        : filter === 'rare' ? 'bg-[#c5a97b] text-white'
                        : filter === 'owned' ? 'bg-[#c5a97b] text-white'
                        : 'bg-[#2a3533] text-white'
                      : 'bg-[#1a2221] text-[#8a9090] hover:bg-[#1f2827]'
                  }`}
                >
                  {filter === 'all' && '🏠 All'}
                  {filter === 'presale' && '🎯 Presale'}
                  {filter === 'trading' && '📈 Trading'}
                  {filter === 'rare' && '💎 Rare'}
                  {filter === 'owned' && `💰 Owned (${ownedItems.length})`}
                </button>
              ))}
              <button onClick={() => refetchItems()} className="px-4 py-2 bg-[#1a2221] border border-[rgba(255,255,255,0.06)] rounded-lg text-[#cecece] hover:bg-[#1f2827] ml-auto">🔄 Refresh</button>
            </div>

            {/* Loading State */}
            {itemsLoading && (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
                <p className="text-[#8a9090]">Loading items...</p>
              </div>
            )}

            {/* Empty State */}
            {!itemsLoading && filteredItems.length === 0 && (
              <div className="text-center py-12">
                <span className="text-6xl mb-4 block">📦</span>
                <h2 className="text-2xl font-bold text-white mb-2">
                  {itemFilter === 'owned' ? 'No Items Owned' : 'No Items Found'}
                </h2>
                <p className="text-[#8a9090] mb-4">
                  {itemFilter === 'presale' && 'No items currently in presale'}
                  {itemFilter === 'trading' && 'No items currently trading on bonding curves'}
                  {itemFilter === 'rare' && 'No rare items available'}
                  {itemFilter === 'owned' && 'Buy some items to see them here!'}
                  {itemFilter === 'all' && 'Items are being initialized...'}
                </p>
              </div>
            )}

            {/* Items Grid */}
            {!itemsLoading && filteredItems.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredItems.map((item) => (
                  <ItemCard
                    key={item.tokenId.toString()}
                    item={item}
                    onBuy={setSelectedItemBuy}
                    onSell={setSelectedItemSell}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      <BuyModal listing={selectedListing} isOpen={!!selectedListing} onClose={() => setSelectedListing(null)} onSuccess={handleNftBuySuccess} />
      <ItemBuyModal item={selectedItemBuy} isOpen={!!selectedItemBuy} onClose={() => setSelectedItemBuy(null)} onSuccess={handleItemBuySuccess} />
      <ItemSellModal item={selectedItemSell} isOpen={!!selectedItemSell} onClose={() => setSelectedItemSell(null)} onSuccess={handleItemSellSuccess} />
    </div>
  );
}
