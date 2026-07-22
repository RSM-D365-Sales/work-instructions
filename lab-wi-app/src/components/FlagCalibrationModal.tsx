import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wrench, X, CheckCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import type { Scale } from '../types';

// ─── Flag-for-calibration modal ───────────────────────────────────────────────
// Raises the calibration flag on an equipment record and drops it in the admin
// notification inbox. Opened from the Quality Trends instrument pivot and from
// the equipment-health summary; `context` names where the flag came from so the
// reason text reads sensibly either way.
export default function FlagCalibrationModal({
  instrumentLabel, defaultScaleId, scales, context = 'Quality Trends', onClose,
}: {
  instrumentLabel: string;
  defaultScaleId: string;
  scales: Scale[];
  context?: string;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [scaleId, setScaleId] = useState(defaultScaleId);
  const [reason, setReason] = useState(
    `"${instrumentLabel}" flagged from ${context} — results trending against spec.`
  );
  const [error, setError] = useState('');

  const flagMutation = useMutation({
    mutationFn: async () => {
      if (!scaleId) throw new Error('Select the equipment record to flag');
      const scale = scales.find(s => s.id === scaleId);
      const { error: updErr } = await supabase
        .from('scales')
        .update({
          calibration_flagged_at: new Date().toISOString(),
          calibration_flagged_by: profile!.id,
          calibration_flag_reason: reason.trim() || null,
        })
        .eq('id', scaleId);
      if (updErr) throw updErr;
      // E3: land the flag in the admin notification inbox too.
      void createNotification({
        type: 'calibration_flag',
        severity: 'warning',
        title: `${scale?.name ?? 'Equipment'} flagged for calibration`,
        body: reason.trim() || undefined,
        channels: ['in_app', 'email'],
        link: '/scales',
        metadata: { scale_id: scaleId, instrument: instrumentLabel },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scales'] });
      qc.invalidateQueries({ queryKey: ['scales-with-flagger'] });
      onClose();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to flag equipment'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-amber-500 text-white px-5 py-4 flex items-center gap-3">
          <Wrench size={20} />
          <div className="flex-1">
            <h2 className="font-bold">Flag for Calibration</h2>
            <p className="text-xs text-amber-100">Instrument: {instrumentLabel}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Equipment record *</label>
            <select
              value={scaleId}
              onChange={e => setScaleId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">— select equipment —</option>
              {scales.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.serial_number ? ` · ${s.serial_number}` : ''}{s.calibration_flagged_at ? ' (already flagged)' : ''}
                </option>
              ))}
            </select>
            {!defaultScaleId && (
              <p className="text-xs text-gray-400 mt-1">
                No equipment record matched "{instrumentLabel}" — pick the record it corresponds to.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <button
            onClick={() => flagMutation.mutate()}
            disabled={flagMutation.isPending || !scaleId}
            className="w-full flex items-center justify-center gap-2 bg-amber-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {flagMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
            Flag Equipment
          </button>
          <p className="text-xs text-gray-400">
            The flag appears on the Equipment page and notifies administrators. Clearing it there records the calibration date.
          </p>
        </div>
      </div>
    </div>
  );
}
