import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Profile, UserRole, WorkDayState } from '../types';
import { Plus, Pencil, Trash2, X, ShieldCheck } from 'lucide-react';
import { formatDate, cn } from '../lib/utils';

// ─── Weekly working-pattern helpers ─────────────────────────────────────────
const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;        // 0=Sun..6=Sat
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const STATE_LABEL: Record<WorkDayState, string> = { work: 'Working', off: 'Not working', pto: 'Time off' };
const DEFAULT_SCHED: WorkDayState[] = ['work', 'work', 'work', 'work', 'work', 'work', 'work'];

const DAY_CHIP: Record<WorkDayState, string> = {
  work: 'bg-white border-gray-300 text-gray-700 hover:border-gray-400',
  off:  'bg-gray-100 border-gray-200 text-gray-400 line-through',
  pto:  'bg-emerald-100 border-emerald-300 text-emerald-700',
};

function normalizeSched(s: WorkDayState[] | null | undefined): WorkDayState[] {
  return Array.isArray(s) && s.length === 7 ? s : DEFAULT_SCHED;
}
// Click cycles: Working → Not working → Time off → Working
function nextState(s: WorkDayState): WorkDayState {
  return s === 'work' ? 'off' : s === 'off' ? 'pto' : 'work';
}

function WorkDays({ value, onChange }: { value: WorkDayState[]; onChange: (next: WorkDayState[]) => void }) {
  return (
    <div className="flex items-center gap-1">
      {value.map((st, i) => (
        <button
          key={i}
          type="button"
          onClick={() => { const next = value.slice(); next[i] = nextState(st); onChange(next); }}
          title={`${FULL_DAYS[i]} — ${STATE_LABEL[st]} (click to change)`}
          aria-label={`${FULL_DAYS[i]}: ${STATE_LABEL[st]}`}
          className={cn(
            'w-6 h-6 rounded-md text-[11px] font-semibold flex items-center justify-center border transition-colors',
            DAY_CHIP[st]
          )}
        >
          {DAY_LABELS[i]}
        </button>
      ))}
    </div>
  );
}

const ROLES: UserRole[] = ['admin', 'author', 'approver', 'operator', 'lab'];

const ROLE_STYLES: Record<UserRole, string> = {
  admin:    'bg-purple-100 text-purple-700',
  author:   'bg-blue-100 text-blue-700',
  approver: 'bg-green-100 text-green-700',
  operator: 'bg-gray-100 text-gray-700',
  lab:      'bg-amber-100 text-amber-700',
};

type AdminUserRow = Profile;

async function callAdmin<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  // Call the function directly via fetch so we always get the response body,
  // even on non-2xx (supabase-js swallows the body and just reports the status).
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(payload),
  });

  let data: unknown;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const detail =
      (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>))
        ? String((data as { error: unknown }).error)
        : (typeof data === 'string' && data) || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return data as T;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { profile: me } = useAuth();
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: users = [], isLoading, error } = useQuery<AdminUserRow[]>({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const res = await callAdmin<{ users: AdminUserRow[] }>({ action: 'list' });
      return res.users;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => callAdmin({ action: 'delete', user_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  // Working patterns live on profiles.work_schedule (the admin-users list edge
  // function doesn't return them), so fetch + save them directly.
  const { data: schedules = {} } = useQuery<Record<string, WorkDayState[] | null>>({
    queryKey: ['user-schedules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, work_schedule');
      if (error) throw error;
      const m: Record<string, WorkDayState[] | null> = {};
      for (const r of (data ?? []) as { id: string; work_schedule: WorkDayState[] | null }[]) m[r.id] = r.work_schedule;
      return m;
    },
  });

  const saveSchedule = useMutation({
    mutationFn: async ({ id, schedule }: { id: string; schedule: WorkDayState[] }) => {
      const { error } = await supabase.from('profiles').update({ work_schedule: schedule }).eq('id', id);
      if (error) throw error;
    },
    // Optimistic so the chips respond instantly.
    onMutate: async ({ id, schedule }) => {
      await qc.cancelQueries({ queryKey: ['user-schedules'] });
      const prev = qc.getQueryData<Record<string, WorkDayState[] | null>>(['user-schedules']);
      qc.setQueryData<Record<string, WorkDayState[] | null>>(['user-schedules'], old => ({ ...(old ?? {}), [id]: schedule }));
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['user-schedules'], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['user-schedules'] }),
  });

  function handleDelete(u: AdminUserRow) {
    if (u.id === me?.id) {
      alert('You cannot delete your own account.');
      return;
    }
    if (!window.confirm(`Permanently delete ${u.email ?? u.full_name}? This cannot be undone.`)) return;
    deleteMutation.mutate(u.id, {
      onError: (e) => alert((e as Error).message),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck size={22} className="text-purple-600" />
            User Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">Add, edit and remove application users (admin only)</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          New User
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : users.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No users found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Working-days legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60 text-xs text-gray-500">
            <span className="font-medium text-gray-400 uppercase tracking-wide">Working days</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('w-5 h-5 rounded border flex items-center justify-center text-[10px] font-semibold', DAY_CHIP.work)}>M</span> Working
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('w-5 h-5 rounded border flex items-center justify-center text-[10px] font-semibold', DAY_CHIP.off)}>M</span> Not working
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cn('w-5 h-5 rounded border flex items-center justify-center text-[10px] font-semibold', DAY_CHIP.pto)}>M</span> Time off
            </span>
            <span className="text-gray-400">· click a day to cycle</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Working Days</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Created</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {u.full_name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium capitalize', ROLE_STYLES[u.role])}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <WorkDays
                      value={normalizeSched(schedules[u.id])}
                      onChange={next => saveSchedule.mutate({ id: u.id, schedule: next })}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-400">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setEditing(u)}
                        title="Edit user"
                        className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        disabled={u.id === me?.id}
                        title={u.id === me?.id ? "You can't delete yourself" : 'Delete user'}
                        className="p-1 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <UserDialog
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
        />
      )}
      {editing && (
        <UserDialog
          mode="edit"
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['admin-users'] }); }}
        />
      )}
    </div>
  );
}

// ─── Create / Edit dialog ───────────────────────────────────────────────────
function UserDialog({
  mode, user, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  user?: AdminUserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email] = useState(user?.email ?? '');
  const [emailInput, setEmailInput] = useState(user?.email ?? '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [role, setRole] = useState<UserRole>(user?.role ?? 'operator');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    setSaving(true);
    setErr('');
    try {
      if (mode === 'create') {
        if (!emailInput.trim() || !password || !fullName.trim()) {
          throw new Error('Email, password and full name are required.');
        }
        await callAdmin({
          action: 'create',
          email: emailInput.trim(),
          password,
          full_name: fullName.trim(),
          role,
        });
      } else {
        const payload: Record<string, unknown> = {
          action: 'update',
          user_id: user!.id,
          full_name: fullName.trim(),
          role,
        };
        if (password) payload.password = password;
        await callAdmin(payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {mode === 'create' ? 'New User' : `Edit ${user?.full_name}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {err && <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{err}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email {mode === 'create' && <span className="text-red-500">*</span>}
            </label>
            <input
              type="email"
              value={mode === 'create' ? emailInput : email}
              onChange={e => setEmailInput(e.target.value)}
              disabled={mode === 'edit'}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="user@example.com"
            />
            {mode === 'edit' && <p className="text-xs text-gray-400 mt-1">Email cannot be changed.</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Full Name {mode === 'create' && <span className="text-red-500">*</span>}
            </label>
            <input
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as UserRole)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ROLES.map(r => (
                <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password {mode === 'create' && <span className="text-red-500">*</span>}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={mode === 'edit' ? 'Leave blank to keep current password' : 'Minimum 8 characters'}
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create User' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
