// hooks/useCountdown.ts
// Real-time countdown hook for ICO timers and airdrop drip schedules
'use client';

import { useState, useEffect, useCallback } from 'react';

interface CountdownResult {
  timeRemaining: number;
  formatted: string;
  isExpired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/**
 * Format milliseconds into human-readable countdown string
 */
function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Ended';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Parse time components from milliseconds
 */
function parseTimeComponents(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  return { days, hours, minutes, seconds };
}

/**
 * useCountdown - Real-time countdown to a target timestamp
 *
 * @param targetTimestamp - Unix timestamp in milliseconds when countdown ends
 * @param updateInterval - How often to update (default: 1000ms)
 * @returns CountdownResult with time remaining and formatted string
 */
export function useCountdown(
  targetTimestamp: number | null | undefined,
  updateInterval: number = 1000
): CountdownResult {
  const calculateTimeRemaining = useCallback(() => {
    if (!targetTimestamp) return 0;
    return Math.max(0, targetTimestamp - Date.now());
  }, [targetTimestamp]);

  const [timeRemaining, setTimeRemaining] = useState(calculateTimeRemaining);

  useEffect(() => {
    if (!targetTimestamp) {
      setTimeRemaining(0);
      return;
    }

    // Initial calculation
    setTimeRemaining(calculateTimeRemaining());

    // Update interval
    const interval = setInterval(() => {
      const remaining = calculateTimeRemaining();
      setTimeRemaining(remaining);

      // Stop interval when countdown reaches zero
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, updateInterval);

    return () => clearInterval(interval);
  }, [targetTimestamp, updateInterval, calculateTimeRemaining]);

  const { days, hours, minutes, seconds } = parseTimeComponents(timeRemaining);

  return {
    timeRemaining,
    formatted: formatCountdown(timeRemaining),
    isExpired: timeRemaining <= 0,
    days,
    hours,
    minutes,
    seconds,
  };
}

/**
 * useMultipleCountdowns - Track multiple countdowns efficiently
 *
 * @param timestamps - Array of target timestamps
 * @param updateInterval - How often to update (default: 1000ms)
 * @returns Array of CountdownResults
 */
export function useMultipleCountdowns(
  timestamps: (number | null | undefined)[],
  updateInterval: number = 1000
): CountdownResult[] {
  const [results, setResults] = useState<CountdownResult[]>([]);

  useEffect(() => {
    const calculate = () => {
      const now = Date.now();
      return timestamps.map(ts => {
        const timeRemaining = ts ? Math.max(0, ts - now) : 0;
        const { days, hours, minutes, seconds } = parseTimeComponents(timeRemaining);
        return {
          timeRemaining,
          formatted: formatCountdown(timeRemaining),
          isExpired: timeRemaining <= 0,
          days,
          hours,
          minutes,
          seconds,
        };
      });
    };

    // Initial calculation
    setResults(calculate());

    // Update interval
    const interval = setInterval(() => {
      setResults(calculate());
    }, updateInterval);

    return () => clearInterval(interval);
  }, [timestamps.join(','), updateInterval]);

  return results;
}

export default useCountdown;
