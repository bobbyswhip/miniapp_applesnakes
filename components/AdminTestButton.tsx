// components/AdminTestButton.tsx
// Admin buttons for Token Wars: Test End, Cancel, and Remove

'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Call production API directly - no proxy needed
const API_BASE = 'https://api.applesnakes.com';

interface AdminTestButtonProps {
  warId: string;
  warSymbol?: string;
  onSuccess?: () => void;
}

// ============================================
// Test End Button - Sets war timer to 5 seconds
// ============================================
export function AdminTestButton({ warId, warSymbol, onSuccess }: AdminTestButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const queryClient = useQueryClient();

  const handleTestTimer = async () => {
    setLoading(true);
    setShowConfirm(false);

    try {
      const res = await fetch(`${API_BASE}/api/token-wars/admin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_test_timer', warId }),
      });

      const data = await res.json();

      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['token-war', warId] });
        queryClient.invalidateQueries({ queryKey: ['token-wars'] });
        onSuccess?.();
      } else {
        console.error('[AdminTestButton] Error:', data.error);
      }
    } catch (err) {
      console.error('[AdminTestButton] Failed:', err);
    } finally {
      setLoading(false);
    }
  };

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/50 rounded-lg px-3 py-2">
        <span className="text-xs text-red-300">End war now?</span>
        <button
          onClick={handleTestTimer}
          disabled={loading}
          className="px-2 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Yes'}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          disabled={loading}
          className="px-2 py-1 text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/50 rounded-lg transition-colors disabled:opacity-50"
      title={`End ${warSymbol || 'war'} in 5 seconds for testing`}
    >
      <span>&#9889;</span>
      <span>{loading ? 'Setting...' : 'Test End (5s)'}</span>
    </button>
  );
}

// ============================================
// Cancel War Button - Marks war as cancelled (keeps data)
// ============================================
interface CancelWarButtonProps {
  warId: string;
  warSymbol?: string;
  onCancelled?: () => void;
}

export function CancelWarButton({ warId, warSymbol, onCancelled }: CancelWarButtonProps) {
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const queryClient = useQueryClient();

  const handleCancel = async () => {
    setLoading(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/token-wars/admin?warId=${encodeURIComponent(warId)}`,
        { method: 'DELETE' }
      );

      const data = await res.json();

      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['token-war', warId] });
        queryClient.invalidateQueries({ queryKey: ['token-wars'] });
        onCancelled?.();
      } else {
        console.error('[CancelWarButton] Error:', data.error);
      }
    } catch (err) {
      console.error('[CancelWarButton] Failed:', err);
    } finally {
      setLoading(false);
      setShowConfirm(false);
    }
  };

  if (showConfirm) {
    return (
      <div className="flex items-center gap-2 bg-red-500/20 border border-red-500/50 rounded-lg px-3 py-2">
        <span className="text-xs text-red-300">Cancel {warSymbol || 'war'}?</span>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="px-2 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded transition-colors disabled:opacity-50"
        >
          {loading ? '...' : 'Yes'}
        </button>
        <button
          onClick={() => setShowConfirm(false)}
          disabled={loading}
          className="px-2 py-1 text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowConfirm(true)}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/50 rounded-lg transition-colors disabled:opacity-50"
      title={`Cancel ${warSymbol || 'war'} (keeps data)`}
    >
      <span>&#x2715;</span>
      <span>{loading ? 'Cancelling...' : 'Cancel War'}</span>
    </button>
  );
}

// ============================================
// Remove War Button - Permanently deletes war and all data
// ============================================
interface RemoveWarButtonProps {
  warId: string;
  warSymbol?: string;
  onRemoved?: () => void;
}

export function RemoveWarButton({ warId, warSymbol, onRemoved }: RemoveWarButtonProps) {
  const [loading, setLoading] = useState(false);
  const [confirmStep, setConfirmStep] = useState(0); // 0 = initial, 1 = first confirm, 2 = final confirm
  const queryClient = useQueryClient();

  const handleRemove = async () => {
    // Two-step confirmation for permanent deletion
    if (confirmStep === 0) {
      setConfirmStep(1);
      return;
    }
    if (confirmStep === 1) {
      setConfirmStep(2);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `${API_BASE}/api/token-wars/admin?warId=${encodeURIComponent(warId)}&permanent=true`,
        { method: 'DELETE' }
      );

      const data = await res.json();

      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['token-war', warId] });
        queryClient.invalidateQueries({ queryKey: ['token-wars'] });
        onRemoved?.();
      } else {
        console.error('[RemoveWarButton] Error:', data.error);
      }
    } catch (err) {
      console.error('[RemoveWarButton] Failed:', err);
    } finally {
      setLoading(false);
      setConfirmStep(0);
    }
  };

  const getButtonText = () => {
    if (loading) return 'Removing...';
    if (confirmStep === 0) return 'Remove War';
    if (confirmStep === 1) return 'Are you sure?';
    return 'CONFIRM DELETE';
  };

  const getButtonStyle = () => {
    if (confirmStep === 0) return 'bg-red-900/30 hover:bg-red-900/50 text-red-500 border-red-900/50';
    if (confirmStep === 1) return 'bg-red-700/50 hover:bg-red-700/70 text-red-200 border-red-700/50';
    return 'bg-red-600 hover:bg-red-700 text-white border-red-600 font-bold';
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRemove}
        disabled={loading}
        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-lg transition-colors disabled:opacity-50 ${getButtonStyle()}`}
        title={`Permanently delete ${warSymbol || 'war'} and all data`}
      >
        <span>&#128465;</span>
        <span>{getButtonText()}</span>
      </button>
      {confirmStep > 0 && (
        <button
          onClick={() => setConfirmStep(0)}
          disabled={loading}
          className="px-2 py-1 text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

// ============================================
// Combined Admin Button Row - All admin actions in one row
// ============================================
interface AdminButtonRowProps {
  warId: string;
  warSymbol?: string;
  onAction?: () => void;
}

export function AdminButtonRow({ warId, warSymbol, onAction }: AdminButtonRowProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <AdminTestButton warId={warId} warSymbol={warSymbol} onSuccess={onAction} />
      <CancelWarButton warId={warId} warSymbol={warSymbol} onCancelled={onAction} />
      <RemoveWarButton warId={warId} warSymbol={warSymbol} onRemoved={onAction} />
    </div>
  );
}
