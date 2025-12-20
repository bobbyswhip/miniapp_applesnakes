# Item Bridge v1.01 - Complete Frontend Integration Guide

NFT item bridge system for trait editor integration. Users can deposit NFTs (bonded items) into the bridge, use them in the trait editor, and withdraw them back to their wallet.

## Contract Address

**ItemBridge v1.01**: `0x374Aa24edAE24982eAB22d8994E8c1de9AF7A4A7`
**BondedItems V7**: `0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd`
**Network**: Base Mainnet (Chain ID: 8453)

## Key Features

1. **Max 32 Items Per Bridge**: Users can deposit up to 32 items per transaction
2. **Fee System**: $0.01 USDC per item, paid in ETH (auto-converted via Uniswap V2)
3. **Cancel Deposits**: Users can cancel unprocessed deposits and get NFTs back
4. **Secure 2-Step Flow**: Backend holds items after fulfil, deducts before withdraw
5. **60-Second Cooldowns**: Rate limiting on fulfil and withdraw operations
6. **Staker Rewards**: Fees are swapped to wASS and sent to stakers

## Complete Integration Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ITEM BRIDGE FLOW (v1.01)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. DEPOSIT (On-Chain)                2. FULFIL (API)                       │
│  ┌────────────────────────┐           ┌────────────────────────┐            │
│  │ User calls bridgeIn()  │           │ POST /api/item-bridge  │            │
│  │ • Max 32 items         │ ────────► │ action: "fulfil"       │            │
│  │ • Pays fee in ETH      │           │ • Adds to off-chain    │            │
│  │ • NFTs → Contract      │           │   balance              │            │
│  └────────────────────────┘           │ • Moves NFTs to backend│            │
│                                       └────────────────────────┘            │
│                                                  │                          │
│  3. CANCEL (On-Chain)                           │                          │
│  ┌────────────────────────┐                     ▼                          │
│  │ User calls             │           ┌────────────────────────┐           │
│  │ cancelDeposit()        │           │ 4. USE IN TRAIT EDITOR │           │
│  │ • Before fulfil only   │           │ POST /api/trait-editor │           │
│  │ • NFTs → User          │           │ • Equip/unequip items  │           │
│  └────────────────────────┘           │ • Balance updated      │           │
│                                       └────────────────────────┘           │
│                                                  │                          │
│                                                  ▼                          │
│                                       ┌────────────────────────┐           │
│                                       │ 5. WITHDRAW (API)      │           │
│                                       │ POST /api/item-bridge  │           │
│                                       │ action: "withdraw"     │           │
│                                       │ • Deducts balance FIRST│           │
│                                       │ • Transfers from backend│           │
│                                       │ • NFTs → User          │           │
│                                       └────────────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Contract Interaction (wagmi/viem)

### Contract ABI

```typescript
const ITEM_BRIDGE_ABI = [
  // User functions
  "function bridgeIn(uint256[] tokenIds, uint256[] amounts) payable",
  "function cancelDeposit(uint256 depositId)",
  "function requestWithdraw(uint256[] tokenIds, uint256[] amounts)",
  "function getCooldownRemaining(address user) view returns (uint256)",

  // View functions
  "function getBridgeFee(uint256 itemCount) view returns (uint256)",
  "function bridgeFeeUSDC() view returns (uint256)",
  "function MAX_ITEMS_PER_BRIDGE() view returns (uint256)",
  "function getBridgeBalance(uint256 tokenId) view returns (uint256)",
  "function getDeposit(uint256 depositId) view returns (address user, uint256[] tokenIds, uint256[] amounts, uint256 timestamp, bool processed, bool cancelled)",
  "function getUserDeposits(address user) view returns (uint256[])",

  // Events
  "event BridgedIn(uint256 indexed depositId, address indexed user, uint256[] tokenIds, uint256[] amounts, uint256 timestamp, uint256 feeEth, uint256 feeWass)",
  "event DepositCancelled(uint256 indexed depositId, address indexed user, uint256[] tokenIds, uint256[] amounts)",
] as const;

const BONDED_ITEMS_ABI = [
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
] as const;
```

### Contract Addresses

```typescript
const ITEM_BRIDGE_ADDRESS = "0x374Aa24edAE24982eAB22d8994E8c1de9AF7A4A7";
const BONDED_ITEMS_ADDRESS = "0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd";
```

## Step 1: Get Bridge Fee Quote

Before depositing, get the ETH fee required:

```typescript
import { useReadContract } from 'wagmi';

function useBridgeFee(itemCount: number) {
  const { data: feeWei, isLoading, error } = useReadContract({
    address: ITEM_BRIDGE_ADDRESS,
    abi: ITEM_BRIDGE_ABI,
    functionName: 'getBridgeFee',
    args: [BigInt(itemCount)],
    enabled: itemCount > 0,
  });

  return {
    feeWei,
    feeEth: feeWei ? Number(feeWei) / 1e18 : 0,
    isLoading,
    error,
  };
}

// Usage
const totalItems = tokenIds.reduce((sum, _, i) => sum + amounts[i], 0);
const { feeWei, feeEth } = useBridgeFee(totalItems);
console.log(`Fee for ${totalItems} items: ${feeEth.toFixed(8)} ETH`);
```

## Step 2: Approve NFTs for Bridge

Users must approve the bridge contract to transfer their NFTs:

```typescript
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

function useApproveBridge() {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const approve = async () => {
    writeContract({
      address: BONDED_ITEMS_ADDRESS,
      abi: BONDED_ITEMS_ABI,
      functionName: 'setApprovalForAll',
      args: [ITEM_BRIDGE_ADDRESS, true],
    });
  };

  return { approve, isPending, isConfirming, isSuccess, hash };
}

// Check if already approved
function useIsApproved(userAddress: `0x${string}`) {
  const { data: isApproved } = useReadContract({
    address: BONDED_ITEMS_ADDRESS,
    abi: BONDED_ITEMS_ABI,
    functionName: 'isApprovedForAll',
    args: [userAddress, ITEM_BRIDGE_ADDRESS],
    enabled: !!userAddress,
  });

  return isApproved ?? false;
}
```

## Step 3: Deposit Items (bridgeIn)

```typescript
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';

interface DepositResult {
  hash: `0x${string}`;
  depositId?: number;
}

function useBridgeIn() {
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash });

  const bridgeIn = async (
    tokenIds: number[],
    amounts: number[],
    feeWei: bigint
  ): Promise<DepositResult | null> => {
    // Validation
    if (tokenIds.length === 0) throw new Error("No items to deposit");
    if (tokenIds.length > 32) throw new Error("Max 32 items per deposit");
    if (tokenIds.length !== amounts.length) throw new Error("Arrays must match");

    // Add 2% buffer for price volatility
    const feeWithBuffer = (feeWei * 102n) / 100n;

    writeContract({
      address: ITEM_BRIDGE_ADDRESS,
      abi: ITEM_BRIDGE_ABI,
      functionName: 'bridgeIn',
      args: [
        tokenIds.map(BigInt),
        amounts.map(BigInt),
      ],
      value: feeWithBuffer,
    });

    return hash ? { hash } : null;
  };

  return {
    bridgeIn,
    isPending,
    isConfirming,
    isSuccess,
    error,
    hash,
  };
}
```

## Step 4: Cancel Deposit (Before Fulfil)

If a user changes their mind before calling the fulfil API:

```typescript
function useCancelDeposit() {
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const cancelDeposit = async (depositId: number) => {
    writeContract({
      address: ITEM_BRIDGE_ADDRESS,
      abi: ITEM_BRIDGE_ABI,
      functionName: 'cancelDeposit',
      args: [BigInt(depositId)],
    });
  };

  return { cancelDeposit, isPending, isConfirming, isSuccess, hash };
}
```

## API Endpoints

### Base URL

**Production**: `https://api.applesnakes.com`

### GET - Check Inventory & Status

```typescript
const API_BASE = 'https://api.applesnakes.com';

// Get user's bridge inventory and status
const response = await fetch(
  `${API_BASE}/api/item-bridge?action=inventory&address=${userAddress}`
);
const data = await response.json();
```

**Response:**
```typescript
{
  success: true,
  address: "0x...",
  balances: {
    1: 2,    // Base Shirt x2
    16: 1,   // Based Pants x1
    43: 3,   // Amulet of Apple x3
  },
  totalItems: 6,
  cooldowns: {
    fulfil: { canFulfil: true, remainingSeconds: 0 },
    withdraw: { canWithdraw: true, remainingSeconds: 0 }
  }
}
```

### POST - Fulfil Bridge (Claim Deposited Items)

After depositing on-chain, call this to add items to your off-chain balance:

```typescript
const response = await fetch(`${API_BASE}/api/item-bridge`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'fulfil',
    address: userAddress,
  }),
});

const result = await response.json();
```

**Success Response:**
```typescript
{
  success: true,
  depositsProcessed: 1,
  itemsReceived: [
    { tokenId: 1, amount: 2 },
    { tokenId: 16, amount: 1 },
  ],
  newBalance: {
    address: "0x...",
    balances: { 1: 2, 16: 1 },
    lastUpdated: 1702900000000
  }
}
```

**Cooldown Error (429):**
```typescript
{
  success: false,
  error: "Cooldown active. Please wait 45 seconds."
}
```

### POST - Withdraw Items

Withdraw items from your off-chain balance back to your wallet:

```typescript
const response = await fetch(`${API_BASE}/api/item-bridge`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'withdraw',
    address: userAddress,
    tokenIds: [1, 16],
    amounts: [1, 1],
  }),
});

const result = await response.json();
```

**Success Response:**
```typescript
{
  success: true,
  txHash: "0x...",
  itemsWithdrawn: [
    { tokenId: 1, amount: 1 },
    { tokenId: 16, amount: 1 },
  ],
  newBalance: {
    address: "0x...",
    balances: { 1: 1 },  // 1 Base Shirt remaining
    lastUpdated: 1702900060000
  },
  mintedToBackend: null  // or array if items needed minting
}
```

**Insufficient Balance Error (400):**
```typescript
{
  success: false,
  error: "Insufficient balance for withdrawal"
}
```

## Complete React Hook

```typescript
import { useState, useCallback, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

const API_BASE = 'https://api.applesnakes.com';
const ITEM_BRIDGE_ADDRESS = "0x374Aa24edAE24982eAB22d8994E8c1de9AF7A4A7" as const;
const BONDED_ITEMS_ADDRESS = "0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd" as const;

interface BridgeInventory {
  balances: Record<number, number>;
  totalItems: number;
  cooldowns: {
    fulfil: { canFulfil: boolean; remainingSeconds: number };
    withdraw: { canWithdraw: boolean; remainingSeconds: number };
  };
}

interface PendingDeposit {
  depositId: number;
  tokenIds: number[];
  amounts: number[];
  timestamp: number;
  canCancel: boolean;
}

export function useItemBridge() {
  const { address } = useAccount();
  const [inventory, setInventory] = useState<BridgeInventory | null>(null);
  const [pendingDeposits, setPendingDeposits] = useState<PendingDeposit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check approval status
  const { data: isApproved } = useReadContract({
    address: BONDED_ITEMS_ADDRESS,
    abi: [
      "function isApprovedForAll(address account, address operator) view returns (bool)",
    ],
    functionName: 'isApprovedForAll',
    args: address ? [address, ITEM_BRIDGE_ADDRESS] : undefined,
    enabled: !!address,
  });

  // Fetch inventory from API
  const fetchInventory = useCallback(async () => {
    if (!address) return;

    try {
      const response = await fetch(
        `${API_BASE}/api/item-bridge?action=inventory&address=${address}`
      );
      const data = await response.json();

      if (data.success) {
        setInventory({
          balances: data.balances,
          totalItems: data.totalItems,
          cooldowns: data.cooldowns,
        });
      }
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
    }
  }, [address]);

  // Fetch pending deposits from contract
  const fetchPendingDeposits = useCallback(async () => {
    if (!address) return;

    // This would use contract read to get user's deposit IDs
    // and filter for unprocessed ones
  }, [address]);

  // Refresh on mount and address change
  useEffect(() => {
    fetchInventory();
    fetchPendingDeposits();
  }, [fetchInventory, fetchPendingDeposits]);

  // Get fee quote
  const { data: feeForItems } = useReadContract({
    address: ITEM_BRIDGE_ADDRESS,
    abi: ["function getBridgeFee(uint256 itemCount) view returns (uint256)"],
    functionName: 'getBridgeFee',
    args: [1n], // Default to 1 item
  });

  // Approve bridge
  const { writeContract: writeApprove, data: approveHash } = useWriteContract();
  const { isLoading: isApproving, isSuccess: approveSuccess } =
    useWaitForTransactionReceipt({ hash: approveHash });

  const approve = useCallback(async () => {
    writeApprove({
      address: BONDED_ITEMS_ADDRESS,
      abi: ["function setApprovalForAll(address operator, bool approved)"],
      functionName: 'setApprovalForAll',
      args: [ITEM_BRIDGE_ADDRESS, true],
    });
  }, [writeApprove]);

  // Bridge in
  const { writeContract: writeBridgeIn, data: bridgeInHash } = useWriteContract();
  const { isLoading: isBridgingIn, isSuccess: bridgeInSuccess } =
    useWaitForTransactionReceipt({ hash: bridgeInHash });

  const bridgeIn = useCallback(async (
    tokenIds: number[],
    amounts: number[],
    feeWei: bigint
  ) => {
    if (tokenIds.length > 32) {
      throw new Error('Max 32 items per deposit');
    }

    // Add 2% buffer for price volatility
    const feeWithBuffer = (feeWei * 102n) / 100n;

    writeBridgeIn({
      address: ITEM_BRIDGE_ADDRESS,
      abi: ["function bridgeIn(uint256[] tokenIds, uint256[] amounts) payable"],
      functionName: 'bridgeIn',
      args: [tokenIds.map(BigInt), amounts.map(BigInt)],
      value: feeWithBuffer,
    });
  }, [writeBridgeIn]);

  // Cancel deposit
  const { writeContract: writeCancelDeposit, data: cancelHash } = useWriteContract();
  const { isLoading: isCancelling, isSuccess: cancelSuccess } =
    useWaitForTransactionReceipt({ hash: cancelHash });

  const cancelDeposit = useCallback(async (depositId: number) => {
    writeCancelDeposit({
      address: ITEM_BRIDGE_ADDRESS,
      abi: ["function cancelDeposit(uint256 depositId)"],
      functionName: 'cancelDeposit',
      args: [BigInt(depositId)],
    });
  }, [writeCancelDeposit]);

  // Fulfil (API call)
  const fulfil = useCallback(async () => {
    if (!address) throw new Error('No wallet connected');

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/item-bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fulfil', address }),
      });

      const result = await response.json();

      if (result.success) {
        await fetchInventory();
        return result;
      } else {
        throw new Error(result.error || 'Fulfil failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Fulfil failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [address, fetchInventory]);

  // Withdraw (API call)
  const withdraw = useCallback(async (tokenIds: number[], amounts: number[]) => {
    if (!address) throw new Error('No wallet connected');

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/item-bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'withdraw',
          address,
          tokenIds,
          amounts,
        }),
      });

      const result = await response.json();

      if (result.success) {
        await fetchInventory();
        return result;
      } else {
        throw new Error(result.error || 'Withdraw failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Withdraw failed';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [address, fetchInventory]);

  return {
    // State
    inventory,
    pendingDeposits,
    isApproved: isApproved ?? false,
    loading,
    error,

    // Contract actions
    approve,
    isApproving,
    approveSuccess,

    bridgeIn,
    isBridgingIn,
    bridgeInSuccess,

    cancelDeposit,
    isCancelling,
    cancelSuccess,

    // API actions
    fulfil,
    withdraw,
    fetchInventory,

    // Fee calculation
    feePerItem: feeForItems,
  };
}
```

## Complete React Component Example

```tsx
import { useState, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatEther, parseEther } from 'viem';

const API_BASE = 'https://api.applesnakes.com';
const ITEM_BRIDGE_ADDRESS = "0x374Aa24edAE24982eAB22d8994E8c1de9AF7A4A7";
const BONDED_ITEMS_ADDRESS = "0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd";

// Item name mapping
const ITEM_NAMES: Record<number, string> = {
  1: "Base Shirt",
  2: "Based Shirt",
  3: "Blue Shirt",
  // ... add all items
  63: "Santa Hat",
  64: "Doug Dimmadome",
  65: "Blue Partyhat",
  66: "Base Chain",
};

interface ItemBridgeProps {
  userItems: { tokenId: number; amount: number }[];
}

export function ItemBridgeComponent({ userItems }: ItemBridgeProps) {
  const { address } = useAccount();
  const [selectedItems, setSelectedItems] = useState<Map<number, number>>(new Map());
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [bridgeInventory, setBridgeInventory] = useState<Record<number, number>>({});
  const [status, setStatus] = useState<string>('');

  // Calculate total items selected
  const totalSelected = useMemo(() => {
    return Array.from(selectedItems.values()).reduce((sum, amt) => sum + amt, 0);
  }, [selectedItems]);

  // Get fee for selected items
  const { data: feeWei } = useReadContract({
    address: ITEM_BRIDGE_ADDRESS,
    abi: ["function getBridgeFee(uint256 itemCount) view returns (uint256)"],
    functionName: 'getBridgeFee',
    args: [BigInt(totalSelected || 1)],
    enabled: totalSelected > 0,
  });

  // Check approval
  const { data: isApproved } = useReadContract({
    address: BONDED_ITEMS_ADDRESS,
    abi: ["function isApprovedForAll(address, address) view returns (bool)"],
    functionName: 'isApprovedForAll',
    args: address ? [address, ITEM_BRIDGE_ADDRESS] : undefined,
    enabled: !!address,
  });

  // Contract writes
  const { writeContract: writeApprove, data: approveHash } = useWriteContract();
  const { isLoading: isApproving } = useWaitForTransactionReceipt({ hash: approveHash });

  const { writeContract: writeBridgeIn, data: bridgeInHash } = useWriteContract();
  const { isLoading: isBridgingIn } = useWaitForTransactionReceipt({ hash: bridgeInHash });

  // Handlers
  const handleItemSelect = (tokenId: number, amount: number) => {
    const newSelected = new Map(selectedItems);
    if (amount > 0) {
      newSelected.set(tokenId, amount);
    } else {
      newSelected.delete(tokenId);
    }
    setSelectedItems(newSelected);
  };

  const handleApprove = () => {
    writeApprove({
      address: BONDED_ITEMS_ADDRESS,
      abi: ["function setApprovalForAll(address, bool)"],
      functionName: 'setApprovalForAll',
      args: [ITEM_BRIDGE_ADDRESS, true],
    });
  };

  const handleDeposit = () => {
    if (totalSelected === 0 || totalSelected > 32) return;
    if (!feeWei) return;

    const tokenIds = Array.from(selectedItems.keys());
    const amounts = Array.from(selectedItems.values());

    // Add 2% buffer
    const feeWithBuffer = (feeWei * 102n) / 100n;

    writeBridgeIn({
      address: ITEM_BRIDGE_ADDRESS,
      abi: ["function bridgeIn(uint256[], uint256[]) payable"],
      functionName: 'bridgeIn',
      args: [tokenIds.map(BigInt), amounts.map(BigInt)],
      value: feeWithBuffer,
    });

    setStatus('Depositing items...');
  };

  const handleFulfil = async () => {
    if (!address) return;

    setStatus('Claiming items to bridge inventory...');

    try {
      const response = await fetch(`${API_BASE}/api/item-bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fulfil', address }),
      });

      const result = await response.json();

      if (result.success) {
        setBridgeInventory(result.newBalance?.balances || {});
        setStatus(`Claimed ${result.itemsReceived?.length || 0} items!`);
      } else {
        setStatus(`Error: ${result.error}`);
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  };

  const handleWithdraw = async () => {
    if (!address || totalSelected === 0) return;

    const tokenIds = Array.from(selectedItems.keys());
    const amounts = Array.from(selectedItems.values());

    setStatus('Withdrawing items to wallet...');

    try {
      const response = await fetch(`${API_BASE}/api/item-bridge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'withdraw',
          address,
          tokenIds,
          amounts,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setBridgeInventory(result.newBalance?.balances || {});
        setSelectedItems(new Map());
        setStatus('Items withdrawn to wallet!');
      } else {
        setStatus(`Error: ${result.error}`);
      }
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    }
  };

  return (
    <div className="item-bridge">
      <h2>Item Bridge</h2>

      {/* Tab selector */}
      <div className="tabs">
        <button
          className={activeTab === 'deposit' ? 'active' : ''}
          onClick={() => setActiveTab('deposit')}
        >
          Deposit Items
        </button>
        <button
          className={activeTab === 'withdraw' ? 'active' : ''}
          onClick={() => setActiveTab('withdraw')}
        >
          Withdraw Items
        </button>
      </div>

      {/* Status message */}
      {status && <div className="status-message">{status}</div>}

      {activeTab === 'deposit' ? (
        <>
          {/* Deposit flow */}
          <div className="info-banner">
            <p>Deposit items to use in the trait editor.</p>
            <p>Fee: {feeWei ? formatEther(feeWei) : '...'} ETH ({totalSelected} items)</p>
            <p>Max 32 items per deposit.</p>
          </div>

          {/* Item selector */}
          <div className="item-grid">
            {userItems.map(item => (
              <div key={item.tokenId} className="item-card">
                <span>{ITEM_NAMES[item.tokenId] || `Item #${item.tokenId}`}</span>
                <span>You have: {item.amount}</span>
                <input
                  type="number"
                  min={0}
                  max={item.amount}
                  value={selectedItems.get(item.tokenId) || 0}
                  onChange={(e) => handleItemSelect(item.tokenId, parseInt(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="actions">
            {!isApproved ? (
              <button onClick={handleApprove} disabled={isApproving}>
                {isApproving ? 'Approving...' : '1. Approve Bridge'}
              </button>
            ) : (
              <button
                onClick={handleDeposit}
                disabled={totalSelected === 0 || totalSelected > 32 || isBridgingIn}
              >
                {isBridgingIn ? 'Depositing...' : `2. Deposit ${totalSelected} Items`}
              </button>
            )}

            <button onClick={handleFulfil}>
              3. Claim to Bridge Inventory
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Withdraw flow */}
          <div className="info-banner">
            <p>Withdraw items from bridge inventory to your wallet.</p>
          </div>

          {/* Bridge inventory */}
          <div className="item-grid">
            {Object.entries(bridgeInventory).map(([tokenId, amount]) => (
              <div key={tokenId} className="item-card">
                <span>{ITEM_NAMES[Number(tokenId)] || `Item #${tokenId}`}</span>
                <span>In bridge: {amount}</span>
                <input
                  type="number"
                  min={0}
                  max={amount}
                  value={selectedItems.get(Number(tokenId)) || 0}
                  onChange={(e) => handleItemSelect(Number(tokenId), parseInt(e.target.value) || 0)}
                />
              </div>
            ))}
          </div>

          <div className="actions">
            <button
              onClick={handleWithdraw}
              disabled={totalSelected === 0}
            >
              Withdraw {totalSelected} Items
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

## Item Token ID Reference

| Category | Trait Slot | Token IDs | Items |
|----------|------------|-----------|-------|
| Shirts | Clothes | 1-15 | Base Shirt, Based Shirt, Blue-Yellow Shirts |
| Pants | Pants | 16-23 | Based Pants, Blue-White Pants |
| Weapons | Accessory1 | 24-34 | Apple Shooter, Wands, Melee weapons |
| Gloves | Hands | 35-39 | Grey-White Gloves |
| Fanny Packs | Accessory2 | 40-42 | Purple, Red, Yellow |
| Amulets | Accessory3 | 43-45, 66 | Amulets + Base Chain |
| Beard | Accessory5 | 46 | White Beard |
| Hair | Hair | 47-55 | Various hair styles |
| Backgrounds | Background | 56-62 | Cave, Moon, etc. |
| Hats | Accessory4 | 63-65 | Santa Hat, Doug Dimmadome, Blue Partyhat |

## Fee System

| Items | USDC Fee | ~ETH (at $3400/ETH) |
|-------|----------|---------------------|
| 1 | $0.01 | ~0.000003 ETH |
| 10 | $0.10 | ~0.00003 ETH |
| 32 | $0.32 | ~0.0001 ETH |

- **Fee per item**: $0.01 USDC
- **Max fee per item**: $0.10 USDC (owner configurable)
- **Max items per deposit**: 32
- **Fee payment**: ETH (converted to USDC equivalent via Uniswap V2)
- **Fee destination**: Swapped to wASS and sent to stakers

## Error Handling

```typescript
// Common errors and handling
const ERROR_MESSAGES: Record<string, string> = {
  'TooManyItems': 'Maximum 32 items per deposit',
  'InsufficientFee': 'Not enough ETH for fee (add 2% buffer)',
  'CooldownActive': 'Please wait before trying again',
  'DepositAlreadyProcessed': 'This deposit has already been claimed',
  'NotDepositOwner': 'You can only cancel your own deposits',
  'InsufficientBridgeBalance': 'Not enough items in bridge',
};

function parseContractError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  for (const [key, value] of Object.entries(ERROR_MESSAGES)) {
    if (message.includes(key)) {
      return value;
    }
  }

  return 'Transaction failed. Please try again.';
}
```

## Testing

```bash
# Get fee for 5 items
curl "https://api.applesnakes.com/api/item-bridge?action=fee&itemCount=5"

# Get user inventory
curl "https://api.applesnakes.com/api/item-bridge?action=inventory&address=0x..."

# Fulfil deposits
curl -X POST "https://api.applesnakes.com/api/item-bridge" \
  -H "Content-Type: application/json" \
  -d '{"action":"fulfil","address":"0x..."}'

# Withdraw items
curl -X POST "https://api.applesnakes.com/api/item-bridge" \
  -H "Content-Type: application/json" \
  -d '{"action":"withdraw","address":"0x...","tokenIds":[1,16],"amounts":[1,1]}'
```

## Security Considerations

1. **Approval Safety**: Users only need to approve once. The bridge cannot transfer more than specified in `bridgeIn()`.

2. **Fee Protection**: Contract rejects transactions with insufficient fee (<99% of quoted amount).

3. **Cooldowns**: 60-second cooldowns prevent spam and rate limiting abuse.

4. **Cancel Safety**: Users can only cancel their own unprocessed deposits.

5. **Deduct Before Send**: Withdraw always deducts from balance BEFORE sending, preventing double-spend.

6. **Max Items Limit**: 32 items per deposit prevents gas limit issues.

## Contract Events

Listen for events to update UI in real-time:

```typescript
import { useWatchContractEvent } from 'wagmi';

// Watch for deposits
useWatchContractEvent({
  address: ITEM_BRIDGE_ADDRESS,
  abi: ITEM_BRIDGE_ABI,
  eventName: 'BridgedIn',
  onLogs(logs) {
    logs.forEach(log => {
      console.log('Deposit:', {
        depositId: log.args.depositId,
        user: log.args.user,
        tokenIds: log.args.tokenIds,
        feeEth: log.args.feeEth,
      });
    });
  },
});

// Watch for cancellations
useWatchContractEvent({
  address: ITEM_BRIDGE_ADDRESS,
  abi: ITEM_BRIDGE_ABI,
  eventName: 'DepositCancelled',
  onLogs(logs) {
    logs.forEach(log => {
      console.log('Cancelled:', log.args.depositId);
    });
  },
});
```

## Dependencies

```bash
npm install wagmi viem @tanstack/react-query
```

## Environment Variables

```env
# Frontend (optional - API URL)
NEXT_PUBLIC_API_URL=https://api.applesnakes.com

# Backend (.env)
ITEM_BRIDGE_ADDRESS=0x374Aa24edAE24982eAB22d8994E8c1de9AF7A4A7
BONDED_ITEMS_ADDRESS=0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd
BACKEND_WALLET=0x...
```
