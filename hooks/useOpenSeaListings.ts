'use client';

import { useState, useEffect, useCallback } from 'react';

export interface OpenSeaListing {
  tokenId: number;
  price: string;
  priceWei: string;
  currency: string;
  seller: string;
  orderHash: string;
  imageUrl: string;
  name: string;
  openseaUrl: string;
}

interface UseOpenSeaListingsResult {
  listings: OpenSeaListing[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
  floorPrice: string | null;
  totalListings: number;
}

/**
 * Hook to fetch OpenSea listings for the AppleSnakes collection
 *
 * Fetches active listings sorted by price (cheapest first)
 * Caches results and auto-refreshes every 60 seconds
 */
export function useOpenSeaListings(limit: number = 50): UseOpenSeaListingsResult {
  const [listings, setListings] = useState<OpenSeaListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const fetchListings = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/opensea?limit=${limit}`);
      const data = await response.json();

      if (data.success) {
        setListings(data.listings);
      } else {
        setError(data.error || 'Failed to fetch listings');
        setListings([]);
      }
    } catch (err) {
      console.error('Error fetching OpenSea listings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch listings');
      setListings([]);
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  // Initial fetch and refetch on trigger
  useEffect(() => {
    fetchListings();
  }, [fetchListings, refetchTrigger]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchListings();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchListings]);

  const refetch = useCallback(() => {
    setRefetchTrigger(prev => prev + 1);
  }, []);

  // Calculate floor price (cheapest listing)
  const floorPrice = listings.length > 0 ? listings[0].price : null;
  const totalListings = listings.length;

  return {
    listings,
    isLoading,
    error,
    refetch,
    floorPrice,
    totalListings,
  };
}
