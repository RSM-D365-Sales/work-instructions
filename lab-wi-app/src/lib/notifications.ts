import { supabase } from './supabase';
import type { NotificationChannel, NotificationSeverity, UserRole } from '../types';

/** Write a notification row — the E3 notification-service seam.
 *
 *  In-app delivery IS the notifications table (the admin Notifications page
 *  reads it). Email / Teams delivery is still simulated for the demo; when a
 *  real sender (SMTP / MS Graph edge function) lands, it hooks in behind this
 *  same call without touching any trigger point.
 *
 *  Fire-and-forget by design: a notification failure must never block the
 *  lab flow that raised it, so errors are logged and swallowed. Call sites
 *  use `void createNotification({...})`. */
export async function createNotification(input: {
  type: string;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  channels?: NotificationChannel[];
  audience?: UserRole[];
  link?: string;
  production_order_id?: string;
  reagent_order_id?: string;
  work_instruction_id?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) throw new Error('No active session');
    const { error } = await supabase.from('notifications').insert({
      severity: 'info',
      channels: ['in_app'],
      ...input,
      created_by: userId,
    });
    if (error) throw error;
  } catch (e) {
    console.error('Failed to record notification:', e);
  }
}
