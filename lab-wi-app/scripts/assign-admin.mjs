/**
 * Assign admin role to a user by email.
 *
 * Usage:
 *   node scripts/assign-admin.mjs ryan@lab.com
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://txjqoynbucpjhrkjedeo.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4anFveW5idWNwamhya2plZGVvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODE4NDMxMCwiZXhwIjoyMDkzNzYwMzEwfQ.aPA6UBZCePAuAawWr8vB5cIlvA-Smtb09Q4WFE_6U_s';

const targetEmail = process.argv[2];
if (!targetEmail) {
  console.error('Usage: node scripts/assign-admin.mjs <email>');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Find the user by email
const { data: usersData, error: listError } = await supabase.auth.admin.listUsers();
if (listError) {
  console.error('Failed to list users:', listError.message);
  process.exit(1);
}

const user = usersData.users.find(u => u.email === targetEmail);
if (!user) {
  console.error(`No user found with email: ${targetEmail}`);
  process.exit(1);
}

// Upsert their profile with admin role
const { error } = await supabase
  .from('profiles')
  .upsert({
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name ?? targetEmail,
    role: 'admin',
  }, { onConflict: 'id' });

if (error) {
  console.error('Failed to update profile:', error.message);
} else {
  console.log(`✓  ${targetEmail} is now an admin`);
}
