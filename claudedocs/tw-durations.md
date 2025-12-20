# Token Wars Duration Selection - Frontend Implementation Guide

## Overview

This guide covers implementing the war duration selection feature in your Token Wars creation form. Users can now set how long their Token War will run, from a minimum of 8 hours to a maximum of 30 days.

## API Changes Summary

### Duration Limits
| Property | Value | Description |
|----------|-------|-------------|
| `MIN_DURATION_HOURS` | 8 | Minimum 8 hours |
| `MAX_DURATION_HOURS` | 720 | Maximum 30 days (720 hours) |
| `DEFAULT_DURATION_HOURS` | 24 | Default 24 hours |

### API Endpoint
```
POST /api/token-wars/create
```

### New/Updated Field
```typescript
durationHours: number // Optional, default 24, min 8, max 720
```

## Frontend Implementation

### 1. Add Duration State

```typescript
// In your Token Wars creation component
const [durationHours, setDurationHours] = useState<number>(24);

// Constants for UI
const MIN_DURATION_HOURS = 8;
const MAX_DURATION_HOURS = 720;
const DEFAULT_DURATION_HOURS = 24;
```

### 2. Duration Input Options

#### Option A: Slider Component (Recommended)

```tsx
// Hours-based slider with preset labels
<div className="duration-selector">
  <label>War Duration</label>

  {/* Preset buttons for common durations */}
  <div className="preset-buttons">
    <button
      onClick={() => setDurationHours(8)}
      className={durationHours === 8 ? 'active' : ''}
    >
      8h
    </button>
    <button
      onClick={() => setDurationHours(24)}
      className={durationHours === 24 ? 'active' : ''}
    >
      1 Day
    </button>
    <button
      onClick={() => setDurationHours(72)}
      className={durationHours === 72 ? 'active' : ''}
    >
      3 Days
    </button>
    <button
      onClick={() => setDurationHours(168)}
      className={durationHours === 168 ? 'active' : ''}
    >
      1 Week
    </button>
    <button
      onClick={() => setDurationHours(336)}
      className={durationHours === 336 ? 'active' : ''}
    >
      2 Weeks
    </button>
    <button
      onClick={() => setDurationHours(720)}
      className={durationHours === 720 ? 'active' : ''}
    >
      30 Days
    </button>
  </div>

  {/* Slider for fine-tuning */}
  <input
    type="range"
    min={MIN_DURATION_HOURS}
    max={MAX_DURATION_HOURS}
    value={durationHours}
    onChange={(e) => setDurationHours(Number(e.target.value))}
    step={1}
  />

  {/* Display current value */}
  <div className="duration-display">
    {formatDuration(durationHours)}
  </div>
</div>
```

#### Option B: Dropdown Select

```tsx
<select
  value={durationHours}
  onChange={(e) => setDurationHours(Number(e.target.value))}
>
  <option value={8}>8 Hours (Minimum)</option>
  <option value={12}>12 Hours</option>
  <option value={24}>24 Hours (1 Day) - Default</option>
  <option value={48}>48 Hours (2 Days)</option>
  <option value={72}>72 Hours (3 Days)</option>
  <option value={168}>168 Hours (1 Week)</option>
  <option value={336}>336 Hours (2 Weeks)</option>
  <option value={504}>504 Hours (3 Weeks)</option>
  <option value={720}>720 Hours (30 Days - Maximum)</option>
</select>
```

#### Option C: Custom Number Input with Days/Hours Toggle

```tsx
const [unit, setUnit] = useState<'hours' | 'days'>('days');
const [inputValue, setInputValue] = useState<number>(1);

// Convert to hours for API
const durationHours = unit === 'days' ? inputValue * 24 : inputValue;

// Validate range
const isValidDuration = durationHours >= MIN_DURATION_HOURS && durationHours <= MAX_DURATION_HOURS;

<div className="duration-input">
  <input
    type="number"
    value={inputValue}
    onChange={(e) => setInputValue(Number(e.target.value))}
    min={unit === 'hours' ? MIN_DURATION_HOURS : 1}
    max={unit === 'hours' ? MAX_DURATION_HOURS : 30}
  />

  <div className="unit-toggle">
    <button
      onClick={() => {
        if (unit === 'days') {
          setUnit('hours');
          setInputValue(inputValue * 24);
        }
      }}
      className={unit === 'hours' ? 'active' : ''}
    >
      Hours
    </button>
    <button
      onClick={() => {
        if (unit === 'hours') {
          setUnit('days');
          setInputValue(Math.round(inputValue / 24));
        }
      }}
      className={unit === 'days' ? 'active' : ''}
    >
      Days
    </button>
  </div>

  {!isValidDuration && (
    <span className="error">
      Duration must be between 8 hours and 30 days
    </span>
  )}
</div>
```

### 3. Helper Functions

```typescript
/**
 * Format duration for display
 */
function formatDuration(hours: number): string {
  if (hours < 24) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  const days = hours / 24;
  if (days === Math.floor(days)) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  }

  const wholeDays = Math.floor(days);
  const remainingHours = hours % 24;
  return `${wholeDays} day${wholeDays !== 1 ? 's' : ''} ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
}

/**
 * Validate duration is within limits
 */
function validateDuration(hours: number): { valid: boolean; error?: string } {
  if (hours < MIN_DURATION_HOURS) {
    return { valid: false, error: `Minimum duration is ${MIN_DURATION_HOURS} hours` };
  }
  if (hours > MAX_DURATION_HOURS) {
    return { valid: false, error: `Maximum duration is ${MAX_DURATION_HOURS} hours (30 days)` };
  }
  return { valid: true };
}

/**
 * Calculate end time from duration
 */
function calculateEndTime(durationHours: number): Date {
  const endTime = new Date();
  endTime.setHours(endTime.getHours() + durationHours);
  return endTime;
}
```

### 4. Update Form Submission

#### For JSON body:
```typescript
const createWar = async () => {
  const response = await fetch('/api/token-wars/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PAYMENT': paymentHeader, // EIP-3009 payment header
    },
    body: JSON.stringify({
      name: tokenName,
      symbol: tokenSymbol,
      description: tokenDescription,
      targetAmount: targetAmount || undefined,
      dexVote: selectedDex,
      pairVote: selectedPair,
      durationHours: durationHours, // Add this field
      lockedDex: rawIcoMode ? lockedDex : undefined,
      lockedPair: rawIcoMode ? lockedPair : undefined,
    }),
  });

  return response.json();
};
```

#### For FormData (with image upload):
```typescript
const createWarWithImage = async () => {
  const formData = new FormData();
  formData.append('name', tokenName);
  formData.append('symbol', tokenSymbol);
  formData.append('description', tokenDescription);
  formData.append('dexVote', selectedDex);
  formData.append('pairVote', selectedPair);
  formData.append('durationHours', String(durationHours)); // Add this field

  if (targetAmount) {
    formData.append('targetAmount', String(targetAmount));
  }

  if (imageFile) {
    formData.append('image', imageFile);
  }

  const response = await fetch('/api/token-wars/create', {
    method: 'POST',
    headers: {
      'X-PAYMENT': paymentHeader,
    },
    body: formData,
  });

  return response.json();
};
```

### 5. UI/UX Best Practices

#### Show End Time Preview
```tsx
<div className="end-time-preview">
  <span>War will end:</span>
  <strong>
    {calculateEndTime(durationHours).toLocaleString()}
  </strong>
</div>
```

#### Explain Duration Impact
```tsx
<div className="duration-info">
  <p>
    <strong>Shorter durations (8-24h):</strong> Quick campaigns,
    urgency drives participation
  </p>
  <p>
    <strong>Medium durations (1-7 days):</strong> Balanced time for
    community building and voting
  </p>
  <p>
    <strong>Longer durations (1-4 weeks):</strong> Extended marketing
    campaigns, larger community reach
  </p>
</div>
```

#### Validation Error Display
```tsx
{!validateDuration(durationHours).valid && (
  <div className="error-message">
    {validateDuration(durationHours).error}
  </div>
)}
```

### 6. API Response

The API will return the war with `endsAt` timestamp calculated from your `durationHours`:

```typescript
interface CreateWarResponse {
  success: boolean;
  war: {
    id: string;
    name: string;
    symbol: string;
    createdAt: number;      // Unix timestamp (ms)
    endsAt: number;         // Unix timestamp (ms) = createdAt + (durationHours * 3600000)
    timeRemainingMs: number; // Milliseconds until war ends
    // ... other fields
  };
}
```

### 7. Fetch Duration Limits from API

You can fetch the current limits from the GET endpoint:

```typescript
const fetchDurationLimits = async () => {
  const response = await fetch('/api/token-wars/create');
  const data = await response.json();

  return data.durationLimits;
  // {
  //   min: 8,
  //   max: 720,
  //   default: 24,
  //   unit: "hours",
  //   minDays: 0.333...,
  //   maxDays: 30
  // }
};
```

## Complete Example Component

```tsx
import { useState, useEffect } from 'react';

const PRESET_DURATIONS = [
  { hours: 8, label: '8 Hours' },
  { hours: 24, label: '1 Day' },
  { hours: 72, label: '3 Days' },
  { hours: 168, label: '1 Week' },
  { hours: 336, label: '2 Weeks' },
  { hours: 720, label: '30 Days' },
];

export function DurationSelector({
  value,
  onChange,
  minHours = 8,
  maxHours = 720,
}: {
  value: number;
  onChange: (hours: number) => void;
  minHours?: number;
  maxHours?: number;
}) {
  const formatDuration = (hours: number): string => {
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    if (remainingHours === 0) return `${days}d`;
    return `${days}d ${remainingHours}h`;
  };

  const endDate = new Date(Date.now() + value * 60 * 60 * 1000);

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium">
        War Duration
      </label>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2">
        {PRESET_DURATIONS.map(({ hours, label }) => (
          <button
            key={hours}
            type="button"
            onClick={() => onChange(hours)}
            className={`px-3 py-1 rounded-full text-sm ${
              value === hours
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 hover:bg-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Slider */}
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={minHours}
          max={maxHours}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-sm font-medium w-20 text-right">
          {formatDuration(value)}
        </span>
      </div>

      {/* End time preview */}
      <p className="text-sm text-gray-500">
        War ends: {endDate.toLocaleDateString()} at {endDate.toLocaleTimeString()}
      </p>
    </div>
  );
}
```

## Error Handling

The API will return clear errors for invalid durations:

```typescript
// Duration too short
{
  "success": false,
  "error": "Duration must be at least 8 hours (0.333 days minimum)"
}

// Duration too long
{
  "success": false,
  "error": "Duration cannot exceed 720 hours (30 days maximum)"
}

// Invalid value
{
  "success": false,
  "error": "durationHours must be a valid integer"
}
```

## Summary

1. Add `durationHours` to your form state (default: 24)
2. Provide UI for selection (slider, presets, or dropdown)
3. Validate: 8 <= hours <= 720
4. Include in API request body
5. Show end time preview to users
