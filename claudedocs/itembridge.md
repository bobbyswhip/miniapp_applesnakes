# ItemBridge v1.04 - Frontend Migration Guide

## Status: DEPLOYED

---

## What Changed

**Problem:** Presale items couldn't be bridged

**Solution:** ItemBridge v1.04 - new bridge contract with no restrictions, works with existing BondedItems v7

**Key Point:** We are NOT deploying a new NFT contract. We use the existing BondedItems v7.

---

## Contract Addresses

```typescript
// EXISTING - Do NOT change
const BONDED_ITEMS_ADDRESS = "0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd";

// NEW ItemBridge v1.04
const ITEM_BRIDGE_ADDRESS = "0xc92adf6B4A55b9f58AcCb4EC07b5728473e4533c";
```

**Basescan:** https://basescan.org/address/0xc92adf6B4A55b9f58AcCb4EC07b5728473e4533c

---

## Frontend Changes Required

### Update `lib/item-bridge-service.ts` (line ~35)

```typescript
// OLD bridge (v1.02)
const ITEM_BRIDGE_ADDRESS = "0xF799bDC992f7B7F78a138FC17913908e7a332710";

// NEW bridge (v1.04)
const ITEM_BRIDGE_ADDRESS = "0xc92adf6B4A55b9f58AcCb4EC07b5728473e4533c";
```

That's it! No other changes needed:
- **No ABI changes** - Same functions, same parameters
- **No API changes** - Same endpoints work
- **BondedItems stays the same** - We don't change the NFT contract

---

## Testing

1. **Bridge in a presale item** - Should work now
2. **Bridge in a normal item** - Should still work
3. **x402 withdraw** - Should still work
4. **Check inventory** - Should still work

---

## Quick Reference

| Contract | Address |
|----------|---------|
| BondedItems v7 (unchanged) | `0xE89F37D8F1fc369B11fdAA2b0362D4D290f2cfdd` |
| ItemBridge v1.04 (new) | `0xc92adf6B4A55b9f58AcCb4EC07b5728473e4533c` |
