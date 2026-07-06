'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect('/login?error=' + encodeURIComponent(error.message));
  redirect('/');
}

export async function signUp(formData: FormData) {
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const supabase = createClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) redirect('/login?error=' + encodeURIComponent(error.message));
  // If email confirmation is enabled in Supabase, the user must confirm before a session exists.
  redirect('/login?message=' + encodeURIComponent('Account created — sign in (confirm your email first if required).'));
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
