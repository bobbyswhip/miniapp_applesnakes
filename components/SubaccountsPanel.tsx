'use client';

import { useState } from 'react';
import { useSubaccounts, shortenAddress } from '@/hooks/useSubaccounts';
import { useBalance, useSendTransaction, useWriteContract } from 'wagmi';
import { base } from 'wagmi/chains';
import { formatEther, parseEther, formatUnits, parseUnits } from 'viem';
import { getContracts } from '@/config/contracts';
import { useTransactions } from '@/contexts/TransactionContext';

interface SubaccountsPanelProps {
  onAccountChange?: (address: `0x${string}`) => void;
}

export function SubaccountsPanel({ onAccountChange }: SubaccountsPanelProps) {
  const {
    supportsSubaccounts,
    isLoading,
    mainAccount,
    subaccounts,
    activeAccount,
    createSubaccount,
    switchToSubaccount,
    switchToMainAccount,
    refreshSubaccounts,
    isCreating,
    error,
  } = useSubaccounts();

  const { addTransaction } = useTransactions();

  const [newLabel, setNewLabel] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferType, setTransferType] = useState<'deposit' | 'withdraw'>('deposit');
  const [transferAsset, setTransferAsset] = useState<'ETH' | 'TOKEN'>('ETH');
  const [transferAmount, setTransferAmount] = useState('');
  const [selectedSubaccount, setSelectedSubaccount] = useState<`0x${string}` | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const contracts = getContracts(base.id);

  // Get balances
  const { data: mainBalance } = useBalance({
    address: mainAccount,
    chainId: base.id,
  });

  const { data: mainTokenBalance } = useBalance({
    address: mainAccount,
    token: contracts.token.address as `0x${string}`,
    chainId: base.id,
  });

  const { data: activeBalance } = useBalance({
    address: activeAccount,
    chainId: base.id,
  });

  const { data: activeTokenBalance } = useBalance({
    address: activeAccount,
    token: contracts.token.address as `0x${string}`,
    chainId: base.id,
  });

  // Transaction hooks
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const handleCreateSubaccount = async () => {
    const result = await createSubaccount(newLabel || 'Gaming Account');
    if (result) {
      setNewLabel('');
      setShowCreateForm(false);
      switchToSubaccount(result.address);
      onAccountChange?.(result.address);
    }
  };

  const handleSwitchAccount = (accountAddress: `0x${string}`) => {
    if (accountAddress === mainAccount) {
      switchToMainAccount();
    } else {
      switchToSubaccount(accountAddress);
    }
    onAccountChange?.(accountAddress);
  };

  const openTransferModal = (type: 'deposit' | 'withdraw', subaccountAddr: `0x${string}`) => {
    setTransferType(type);
    setSelectedSubaccount(subaccountAddr);
    setTransferAmount('');
    setTransferAsset('ETH');
    setShowTransferModal(true);
  };

  const handleTransfer = async () => {
    if (!mainAccount || !selectedSubaccount || !transferAmount) return;

    setIsTransferring(true);
    try {
      const toAddress = transferType === 'deposit' ? selectedSubaccount : mainAccount;

      if (transferAsset === 'ETH') {
        const hash = await sendTransactionAsync({
          to: toAddress,
          value: parseEther(transferAmount),
        });
        addTransaction(hash, `${transferType === 'deposit' ? 'Deposit' : 'Withdraw'} ${transferAmount} ETH`);
      } else {
        const hash = await writeContractAsync({
          address: contracts.token.address as `0x${string}`,
          abi: contracts.token.abi,
          functionName: 'transfer',
          args: [toAddress, parseUnits(transferAmount, 18)],
        });
        addTransaction(hash, `${transferType === 'deposit' ? 'Deposit' : 'Withdraw'} ${transferAmount} $wASS`);
      }

      setShowTransferModal(false);
      setTransferAmount('');
    } catch (err) {
      console.error('Transfer error:', err);
    } finally {
      setIsTransferring(false);
    }
  };

  // If wallet doesn't support subaccounts, show info message
  if (!supportsSubaccounts) {
    return (
      <div className="space-y-4">
        <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-purple-600/30 flex items-center justify-center">
              <span className="text-xl">👤</span>
            </div>
            <div>
              <div className="text-white font-semibold">Sub Accounts</div>
              <div className="text-gray-400 text-sm">Manage gaming accounts</div>
            </div>
          </div>

          <div className="bg-yellow-900/30 border border-yellow-600/50 p-3 rounded-lg">
            <div className="text-yellow-300 text-sm font-medium mb-1">
              Not Available
            </div>
            <div className="text-yellow-200/80 text-xs">
              Sub Accounts require a Coinbase Smart Wallet. Connect with a smart wallet to unlock this feature.
            </div>
          </div>

          <div className="mt-4 text-gray-400 text-xs">
            <strong className="text-gray-300">Why use Sub Accounts?</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Keep gaming funds separate from your main wallet</li>
              <li>Better organization and spending tracking</li>
              <li>Enhanced security for gaming activities</li>
              <li>Seamless gasless transactions with paymaster</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Seamless Experience Banner */}
      <div className="bg-gradient-to-r from-green-900/40 to-emerald-900/40 p-4 rounded-lg border border-green-500/30">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xl">✨</span>
          <span className="text-green-300 font-semibold">Seamless Gaming Experience</span>
        </div>
        <p className="text-green-200/80 text-sm">
          Your Smart Wallet supports sub accounts with <strong>gasless transactions</strong>.
          Play games without worrying about gas fees - we sponsor your transactions through our paymaster!
        </p>
      </div>

      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 p-4 rounded-lg border border-purple-500/30">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-600/30 flex items-center justify-center">
              <span className="text-xl">👥</span>
            </div>
            <div>
              <div className="text-white font-semibold">Gaming Sub Accounts</div>
              <div className="text-gray-400 text-sm">
                {subaccounts.length} account{subaccounts.length !== 1 ? 's' : ''} created
              </div>
            </div>
          </div>
          <button
            onClick={() => refreshSubaccounts()}
            disabled={isLoading}
            className="p-2 rounded-lg bg-gray-700/50 hover:bg-gray-600/50 transition-colors text-gray-400 hover:text-white"
            title="Refresh accounts"
          >
            <span className={isLoading ? 'animate-spin inline-block' : ''}>🔄</span>
          </button>
        </div>

        {/* Active account display */}
        <div className="bg-gray-900/50 p-3 rounded-lg">
          <div className="text-xs text-gray-400 mb-1">Active Account</div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${activeAccount === mainAccount ? 'bg-blue-500' : 'bg-green-500'}`} />
              <span className="text-white font-mono text-sm">
                {activeAccount ? shortenAddress(activeAccount) : 'Not connected'}
              </span>
              <span className="text-xs text-gray-500">
                ({activeAccount === mainAccount ? 'Main' : 'Gaming'})
              </span>
            </div>
            <div className="text-right">
              {activeBalance && (
                <div className="text-purple-300 text-sm">
                  {parseFloat(formatEther(activeBalance.value)).toFixed(4)} ETH
                </div>
              )}
              {activeTokenBalance && (
                <div className="text-green-300 text-xs">
                  {parseFloat(formatUnits(activeTokenBalance.value, 18)).toFixed(2)} $wASS
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* What are Sub Accounts? */}
      <div className="bg-blue-900/20 p-4 rounded-lg border border-blue-500/30">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">💡</span>
          <span className="text-blue-300 font-medium text-sm">What are Sub Accounts?</span>
        </div>
        <p className="text-blue-200/70 text-xs mb-2">
          Sub Accounts are separate wallet addresses linked to your Coinbase Smart Wallet.
          They allow you to organize funds for different purposes while keeping your main wallet secure.
        </p>
        <ul className="text-blue-200/60 text-xs space-y-1">
          <li>• <strong>Isolated Funds:</strong> Gaming money stays separate from savings</li>
          <li>• <strong>Gas Sponsorship:</strong> Transactions can be sponsored (no gas fees!)</li>
          <li>• <strong>Easy Management:</strong> Transfer between accounts anytime</li>
          <li>• <strong>Full Control:</strong> You maintain custody of all accounts</li>
        </ul>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-900/30 border border-red-500/50 p-3 rounded-lg">
          <div className="text-red-300 text-sm">{error}</div>
        </div>
      )}

      {/* Account list */}
      <div className="space-y-2">
        {/* Main account */}
        <div
          className={`p-3 rounded-lg border transition-all ${
            activeAccount === mainAccount
              ? 'bg-blue-900/30 border-blue-500'
              : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
          }`}
        >
          <div className="flex items-center justify-between">
            <div
              className="flex items-center gap-3 cursor-pointer flex-1"
              onClick={() => handleSwitchAccount(mainAccount!)}
            >
              <div className="w-8 h-8 rounded-full bg-blue-600/30 flex items-center justify-center">
                <span>🏠</span>
              </div>
              <div>
                <div className="text-white font-medium text-sm">Main Wallet</div>
                <div className="text-gray-400 text-xs font-mono">
                  {mainAccount ? shortenAddress(mainAccount) : '---'}
                </div>
              </div>
            </div>
            <div className="text-right">
              {mainBalance && (
                <div className="text-white text-sm">
                  {parseFloat(formatEther(mainBalance.value)).toFixed(4)} ETH
                </div>
              )}
              {mainTokenBalance && (
                <div className="text-green-300 text-xs">
                  {parseFloat(formatUnits(mainTokenBalance.value, 18)).toFixed(2)} $wASS
                </div>
              )}
              {activeAccount === mainAccount && (
                <div className="text-blue-400 text-xs">Active</div>
              )}
            </div>
          </div>
        </div>

        {/* Subaccounts */}
        {subaccounts.map((sub, index) => (
          <SubaccountCard
            key={sub.address}
            subaccount={sub}
            index={index}
            isActive={activeAccount?.toLowerCase() === sub.address.toLowerCase()}
            onClick={() => handleSwitchAccount(sub.address)}
            onDeposit={() => openTransferModal('deposit', sub.address)}
            onWithdraw={() => openTransferModal('withdraw', sub.address)}
            tokenAddress={contracts.token.address as `0x${string}`}
          />
        ))}

        {/* Create new subaccount */}
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            disabled={isCreating}
            className="w-full p-3 rounded-lg border border-dashed border-gray-600 hover:border-purple-500 bg-gray-800/30 hover:bg-gray-800/50 transition-all text-gray-400 hover:text-purple-300"
          >
            <span className="text-lg mr-2">+</span>
            Create Gaming Account
          </button>
        ) : (
          <div className="p-4 rounded-lg border border-purple-500/50 bg-purple-900/20">
            <div className="text-white font-medium mb-3">Create New Gaming Account</div>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Account name (optional)"
              className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 text-sm focus:border-purple-500 focus:outline-none mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateSubaccount}
                disabled={isCreating}
                className="flex-1 py-2 px-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all text-sm"
              >
                {isCreating ? 'Creating...' : 'Create Account'}
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  setNewLabel('');
                }}
                disabled={isCreating}
                className="py-2 px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-all text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="bg-gray-800/30 p-3 rounded-lg border border-gray-700/50">
        <div className="text-gray-400 text-xs">
          <strong className="text-gray-300">Quick Tips</strong>
          <ul className="list-disc list-inside mt-1 space-y-1">
            <li>Transfer funds to your gaming account before playing</li>
            <li>Winnings are automatically sent to your active account</li>
            <li>Gas fees are sponsored - play for free!</li>
            <li>Switch between accounts anytime using the cards above</li>
          </ul>
        </div>
      </div>

      {/* Transfer Modal */}
      {showTransferModal && selectedSubaccount && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 max-w-sm w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">
                {transferType === 'deposit' ? '⬇️ Deposit to Gaming' : '⬆️ Withdraw to Main'}
              </h3>
              <button
                onClick={() => setShowTransferModal(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Transfer direction display */}
            <div className="bg-gray-800/50 p-3 rounded-lg mb-4 text-sm">
              <div className="flex items-center justify-between text-gray-400">
                <span>From:</span>
                <span className="text-white font-mono">
                  {shortenAddress(transferType === 'deposit' ? mainAccount! : selectedSubaccount)}
                </span>
              </div>
              <div className="text-center my-1 text-gray-500">↓</div>
              <div className="flex items-center justify-between text-gray-400">
                <span>To:</span>
                <span className="text-white font-mono">
                  {shortenAddress(transferType === 'deposit' ? selectedSubaccount : mainAccount!)}
                </span>
              </div>
            </div>

            {/* Asset selection */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setTransferAsset('ETH')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  transferAsset === 'ETH'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                ETH
              </button>
              <button
                onClick={() => setTransferAsset('TOKEN')}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                  transferAsset === 'TOKEN'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                $wASS
              </button>
            </div>

            {/* Amount input */}
            <div className="mb-4">
              <label className="text-gray-400 text-xs mb-1 block">Amount</label>
              <input
                type="number"
                value={transferAmount}
                onChange={(e) => setTransferAmount(e.target.value)}
                placeholder="0.0"
                step="0.001"
                min="0"
                className="w-full p-3 rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              />
              <div className="text-gray-500 text-xs mt-1">
                Balance: {transferAsset === 'ETH'
                  ? `${parseFloat(formatEther(
                      (transferType === 'deposit' ? mainBalance?.value : activeBalance?.value) || BigInt(0)
                    )).toFixed(4)} ETH`
                  : `${parseFloat(formatUnits(
                      (transferType === 'deposit' ? mainTokenBalance?.value : activeTokenBalance?.value) || BigInt(0),
                      18
                    )).toFixed(2)} $wASS`
                }
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleTransfer}
                disabled={isTransferring || !transferAmount || parseFloat(transferAmount) <= 0}
                className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all"
              >
                {isTransferring ? 'Transferring...' : `${transferType === 'deposit' ? 'Deposit' : 'Withdraw'}`}
              </button>
              <button
                onClick={() => setShowTransferModal(false)}
                disabled={isTransferring}
                className="py-3 px-4 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component for individual subaccount cards
interface SubaccountCardProps {
  subaccount: { address: `0x${string}`; label?: string };
  index: number;
  isActive: boolean;
  onClick: () => void;
  onDeposit: () => void;
  onWithdraw: () => void;
  tokenAddress: `0x${string}`;
}

function SubaccountCard({ subaccount, index, isActive, onClick, onDeposit, onWithdraw, tokenAddress }: SubaccountCardProps) {
  const { data: balance } = useBalance({
    address: subaccount.address,
    chainId: base.id,
  });

  const { data: tokenBalance } = useBalance({
    address: subaccount.address,
    token: tokenAddress,
    chainId: base.id,
  });

  const emojis = ['🎮', '🎲', '🃏', '🎰', '🎯', '🏆'];
  const emoji = emojis[index % emojis.length];

  return (
    <div
      className={`p-3 rounded-lg border transition-all ${
        isActive
          ? 'bg-green-900/30 border-green-500'
          : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={onClick}>
          <div className="w-8 h-8 rounded-full bg-green-600/30 flex items-center justify-center">
            <span>{emoji}</span>
          </div>
          <div>
            <div className="text-white font-medium text-sm">
              {subaccount.label || `Gaming Account ${index + 1}`}
            </div>
            <div className="text-gray-400 text-xs font-mono">
              {shortenAddress(subaccount.address)}
            </div>
          </div>
        </div>
        <div className="text-right">
          {balance && (
            <div className="text-white text-sm">
              {parseFloat(formatEther(balance.value)).toFixed(4)} ETH
            </div>
          )}
          {tokenBalance && (
            <div className="text-green-300 text-xs">
              {parseFloat(formatUnits(tokenBalance.value, 18)).toFixed(2)} $wASS
            </div>
          )}
          {isActive && (
            <div className="text-green-400 text-xs">Active</div>
          )}
        </div>
      </div>

      {/* Transfer buttons */}
      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-700/50">
        <button
          onClick={(e) => { e.stopPropagation(); onDeposit(); }}
          className="flex-1 py-1.5 px-3 bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 text-xs font-medium rounded-lg transition-colors"
        >
          ⬇️ Deposit
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onWithdraw(); }}
          className="flex-1 py-1.5 px-3 bg-orange-600/30 hover:bg-orange-600/50 text-orange-300 text-xs font-medium rounded-lg transition-colors"
        >
          ⬆️ Withdraw
        </button>
      </div>
    </div>
  );
}
