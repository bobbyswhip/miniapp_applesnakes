# Trait Editor - Image Refresh After Successful Swap

## THE PROBLEM

After a successful trait swap via x402 payment, the frontend continues showing the **old cached image** for a long time. Users see their old NFT even though the traits were successfully updated.

**Why this happens:**
1. IPFS gateways cache images aggressively (hours to days)
2. Browser caches the old image URL
3. Frontend doesn't fetch fresh preview after successful update

---

## THE SOLUTION

**Immediately after successful x402 payment, fetch the NEW base64 preview from EC2.**

The EC2 `/api/customize/{tokenId}/preview` endpoint generates images on-demand from the **current database state** - no IPFS caching involved.

---

## IMPLEMENTATION

### Step 1: Track Success State

```typescript
const [isUpdating, setIsUpdating] = useState(false);
const [updateSuccess, setUpdateSuccess] = useState(false);
```

### Step 2: Refresh Preview After Successful Swap

After `customizeWithX402Payment()` returns success, immediately fetch the new preview:

```typescript
import { customizeWithX402Payment } from "@/lib/x402-customize-client";

const handleApplyChanges = async () => {
  if (!walletClient || !tokenId) return;

  setIsUpdating(true);
  setUpdateSuccess(false);

  try {
    // Execute x402 payment and trait update
    const result = await customizeWithX402Payment(
      tokenId,
      selectedTraits,
      "human",
      walletClient,
      true // autoPublish
    );

    if (result.success) {
      console.log("Trait update successful, fetching fresh preview...");

      // ═══════════════════════════════════════════════════════════════════════
      // CRITICAL: Immediately fetch the NEW preview after successful update
      // This bypasses all caching and shows the updated image instantly
      // ═══════════════════════════════════════════════════════════════════════
      await refreshPreviewFromEC2();

      setUpdateSuccess(true);

      // Optional: Show success notification
      toast.success("NFT updated successfully!");
    } else {
      console.error("Update failed:", result.error);
      toast.error(result.error || "Failed to update traits");
    }
  } catch (error) {
    console.error("Error applying changes:", error);
    toast.error("Failed to apply changes");
  } finally {
    setIsUpdating(false);
  }
};
```

### Step 3: Implement the Refresh Function

```typescript
const NFT_GENERATOR_URL = "https://api.applesnakes.com";

// Trait name conversion (frontend NEW → EC2 OLD)
const NEW_TO_OLD: Record<string, string> = {
  "Hat": "Accessory4",
  "Weapons": "Accessory1",
  "Hip": "Accessory2",
  "Neck": "Accessory3",
  "Face": "Accessory5",
  "Shirt": "Clothes",
};

function convertToEC2Format(traits: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(traits)) {
    const ec2Key = NEW_TO_OLD[key] || key;
    result[ec2Key] = value;
  }
  return result;
}

const refreshPreviewFromEC2 = async () => {
  if (!tokenId) return;

  try {
    // First, fetch the CURRENT traits from EC2 (what's actually in the database)
    const availableRes = await fetch(
      `${NFT_GENERATOR_URL}/api/customize/${tokenId}/available`
    );
    const availableData = await availableRes.json();

    if (!availableData.success) {
      console.error("Failed to fetch current traits");
      return;
    }

    // Filter to only OLD trait names (remove duplicate NEW names)
    const NEW_TRAIT_NAMES = ["Hat", "Weapons", "Hip", "Neck", "Face", "Shirt"];
    const cleanTraits: Record<string, string> = {};

    for (const [key, value] of Object.entries(availableData.currentTraits || {})) {
      if (!NEW_TRAIT_NAMES.includes(key)) {
        cleanTraits[key] = value as string;
      }
    }

    // Now fetch the preview with the CURRENT database traits
    const previewRes = await fetch(
      `${NFT_GENERATOR_URL}/api/customize/${tokenId}/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traits: cleanTraits }),
      }
    );

    const previewData = await previewRes.json();

    if (previewData.success && previewData.preview) {
      // Update the preview image state with fresh base64 data
      setPreviewBase64(previewData.preview);

      // Also update currentTraits to reflect the new state
      // (Normalize OLD names to NEW names for display)
      const normalizedTraits = normalizeTraitsForDisplay(cleanTraits);
      setCurrentTraits(normalizedTraits);
      setSelectedTraits(normalizedTraits);

      console.log("Preview refreshed successfully!");
    }
  } catch (error) {
    console.error("Failed to refresh preview:", error);
  }
};

// Helper: Convert EC2 OLD names back to frontend NEW names for display
function normalizeTraitsForDisplay(ec2Traits: Record<string, string>): Record<string, string> {
  const OLD_TO_NEW: Record<string, string> = {
    "Accessory4": "Hat",
    "Accessory1": "Weapons",
    "Accessory2": "Hip",
    "Accessory3": "Neck",
    "Accessory5": "Face",
    "Clothes": "Shirt",
  };

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(ec2Traits)) {
    const displayKey = OLD_TO_NEW[key] || key;
    result[displayKey] = value;
  }
  return result;
}
```

---

## COMPLETE FLOW

```
User clicks "Apply Changes"
         ↓
setIsUpdating(true)
         ↓
customizeWithX402Payment() - Pays $0.05 USDC, updates traits on EC2
         ↓
result.success === true
         ↓
refreshPreviewFromEC2()
    ├── GET /api/customize/{tokenId}/available  → Get CURRENT database traits
    ├── Filter out duplicate NEW trait names
    ├── POST /api/customize/{tokenId}/preview   → Get fresh base64 image
    └── setPreviewBase64(newImage)              → Update UI immediately
         ↓
User sees UPDATED image instantly (no IPFS delay!)
```

---

## ALTERNATIVE: Optimistic Update with Result Data

If the x402 response includes the new image CIDs, you can use them directly:

```typescript
if (result.success && result.result?.normal?.imageCid) {
  // Option 1: Use the returned CID (still goes through IPFS gateway)
  const newIpfsUrl = `https://ipfs.io/ipfs/${result.result.normal.imageCid}`;

  // Option 2 (RECOMMENDED): Fetch fresh base64 preview instead
  await refreshPreviewFromEC2();
}
```

**Always prefer the base64 preview** because:
- IPFS gateways cache aggressively
- Even new CIDs may take minutes to propagate
- EC2 preview is generated on-demand from current database state

---

## UI FEEDBACK DURING UPDATE

Show loading state while the update is in progress:

```tsx
<button
  onClick={handleApplyChanges}
  disabled={isUpdating || !hasChanges}
  className={`px-4 py-2 rounded ${
    isUpdating ? "bg-gray-500" : "bg-blue-600 hover:bg-blue-700"
  }`}
>
  {isUpdating ? (
    <span className="flex items-center gap-2">
      <span className="animate-spin">⏳</span>
      Updating...
    </span>
  ) : (
    `Apply Changes ($0.05 USDC)`
  )}
</button>

{/* Show success message */}
{updateSuccess && (
  <div className="mt-2 text-green-500 text-sm">
    NFT updated successfully! Image refreshed.
  </div>
)}
```

---

## IMAGE CONTAINER WITH LOADING STATE

```tsx
<div className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative">
  {previewBase64 ? (
    <img
      src={previewBase64}
      alt={`Token #${tokenId}`}
      className={`w-full h-full object-cover transition-opacity ${
        isUpdating ? "opacity-50" : "opacity-100"
      }`}
    />
  ) : (
    <div className="w-full h-full flex items-center justify-center text-gray-500">
      No image
    </div>
  )}

  {/* Loading overlay during update */}
  {isUpdating && (
    <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-white border-t-transparent rounded-full"></div>
      <span className="mt-2 text-white text-sm">Updating NFT...</span>
    </div>
  )}
</div>
```

---

## COST INFORMATION

The trait editor now costs **$0.05 USDC** per update via x402 payment.

Display this to users:

```tsx
<div className="text-sm text-gray-400 mb-4">
  Cost: $0.05 USDC per update
</div>
```

---

## SUMMARY

| Step | Action | Result |
|------|--------|--------|
| 1 | User clicks "Apply Changes" | Loading state shown |
| 2 | `customizeWithX402Payment()` | $0.05 USDC paid, traits updated on EC2 |
| 3 | `refreshPreviewFromEC2()` | Fetch fresh base64 from EC2 |
| 4 | `setPreviewBase64(newImage)` | UI shows updated NFT immediately |

**Key Points:**
- Always fetch base64 preview after successful update
- Never rely on IPFS URLs for immediate display
- EC2 preview endpoint reflects current database state
- No waiting for IPFS propagation or cache invalidation
