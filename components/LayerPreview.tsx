// components/LayerPreview.tsx
// Live preview for NFT trait editing using client-side canvas compositing
// Uses the CanvasPreview component for layer-by-layer rendering
'use client';

import {
  CanvasPreview,
  TraitEditorPreview as CanvasTraitEditorPreview,
  NFT_IPNS_BASE,
  TRAIT_TO_LAYER,
} from './CanvasPreview';

// =============================================================================
// LayerPreview Component - Uses Client-Side Canvas Compositing
// =============================================================================

export interface LayerPreviewProps {
  /** Current traits to render */
  traits: Record<string, string>;
  /** Type of NFT - "human" or "snake" */
  nftType: 'human' | 'snake';
  /** Additional CSS classes */
  className?: string;
  /** Show loading spinner */
  showLoading?: boolean;
  /** Callback when rendering complete */
  onRenderComplete?: () => void;
}

export function LayerPreview({
  traits,
  nftType,
  className = '',
  showLoading = true,
  onRenderComplete,
}: LayerPreviewProps) {
  // Pass traits directly - CanvasPreview handles the mapping
  return (
    <CanvasPreview
      traits={traits}
      nftType={nftType}
      className={className}
      showLoading={showLoading}
      onRenderComplete={onRenderComplete ? () => onRenderComplete() : undefined}
    />
  );
}

// =============================================================================
// TraitEditorPreview - Side by Side Comparison (uses client-side canvas)
// Re-exports from CanvasPreview for backwards compatibility
// =============================================================================

export interface TraitEditorPreviewProps {
  /** Token ID of the NFT */
  tokenId: number;
  /** Current traits (equippable traits from API) */
  currentTraits: Record<string, string>;
  /** Pending/selected traits for preview */
  pendingTraits: Record<string, string>;
  /** Type of NFT */
  nftType: 'human' | 'snake';
  /** Additional class names */
  className?: string;
}

export function TraitEditorPreview({
  tokenId,
  currentTraits,
  pendingTraits,
  nftType,
  className = '',
}: TraitEditorPreviewProps) {
  return (
    <CanvasTraitEditorPreview
      tokenId={tokenId}
      currentTraits={currentTraits}
      pendingTraits={pendingTraits}
      nftType={nftType}
      className={className}
    />
  );
}

// =============================================================================
// Exports
// =============================================================================

export default LayerPreview;
export { NFT_IPNS_BASE, TRAIT_TO_LAYER };
