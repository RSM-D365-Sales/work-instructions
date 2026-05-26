import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Lab } from '../types';
import { FlaskConical } from 'lucide-react';

/**
 * Compact selector that lets the signed-in user pick their default lab.
 * The value is persisted to profiles.default_lab_id via RLS (own row only).
 */
export default function DefaultLabSelector() {
  const { profile, refreshProfile } = useAuth();
  const qc = useQueryClient();

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ['labs', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (labId: string | null) => {
      if (!profile) return;
      const { error } = await supabase
        .from('profiles')
        .update({ default_lab_id: labId })
        .eq('id', profile.id);
      if (error) throw error;
    },
    // Refresh the cached profile via a full reload of dependent queries.
    onSuccess: async () => {
      await refreshProfile();
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  if (!profile) return null;

  // Hide the selector if no labs are configured yet — keeps the sidebar tidy.
  if (labs.length === 0) return null;

  return (
    <div className="mb-3">
      <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
        <FlaskConical size={11} /> Default Lab
      </label>
      <select
        value={profile.default_lab_id ?? ''}
        onChange={e => mutation.mutate(e.target.value || null)}
        disabled={mutation.isPending}
        className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        <option value="">— none —</option>
        {labs.map(l => (
          <option key={l.id} value={l.id}>
            {l.name} {l.warehouse_id !== l.name && `(${l.warehouse_id})`}
          </option>
        ))}
      </select>
    </div>
  );
}
