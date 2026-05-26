/**
 * Run once to create the 3 demo users in Supabase.
 *
 * Usage:
 *   1. Paste your SERVICE ROLE key below (found in Supabase → Project Settings → API → service_role)
 *   2. node scripts/create-demo-users.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://txjqoynbucpjhrkjedeo.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4anFveW5idWNwamhya2plZGVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE4NDMxMCwiZXhwIjoyMDkzNzYwMzEwfQ.aPA6UBZCePAuAawWr8vB5cIlvA-Smtb09Q4WFE_6U_s'; // ← replace this

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = 'Demo@Lab2026';

const DEMO_USERS = [
  { email: 'author@demolab.com',   full_name: 'Demo Author',   role: 'author' },
  { email: 'approver@demolab.com', full_name: 'Demo Approver', role: 'approver' },
  { email: 'operator@demolab.com', full_name: 'Demo Operator', role: 'operator' },
];

// Fetch all existing users so we can update passwords if they already exist
const { data: existingData } = await supabase.auth.admin.listUsers();
const existingEmails = new Map(existingData?.users.map(u => [u.email, u.id]) ?? []);

for (const u of DEMO_USERS) {
  if (existingEmails.has(u.email)) {
    // User already exists — update their password
    const userId = existingEmails.get(u.email);
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.full_name, role: u.role },
    });
    if (error) {
      console.error(`✗  Failed to update ${u.email}:`, error.message);
    } else {
      console.log(`✓  Updated password for ${u.email}`);
    }
  } else {
    // Create new user
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.full_name, role: u.role },
    });
    if (error) {
      console.error(`✗  ${u.email}:`, error.message);
    } else {
      console.log(`✓  Created ${u.email} (id: ${data.user.id})`);
    }
  }
}

console.log(`\nDone. Log in with password: ${DEMO_PASSWORD}`);
