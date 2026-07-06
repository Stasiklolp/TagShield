'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireOrg } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { generateSiteKey } from '@/lib/keys';
import { compileConfigBlob, DEFAULT_SETTINGS, pushConfigToEdge } from '@/lib/edge';

export async function createSite(formData: FormData) {
  const { org } = await requireOrg();
  const domain = String(formData.get('domain') || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!domain) redirect('/?error=' + encodeURIComponent('Enter a domain'));

  const db = adminClient();
  const key = generateSiteKey();
  const { data: site, error } = await db
    .from('sites')
    .insert({ org_id: org.id, domain, public_site_key: key, status: 'pending_install' })
    .select()
    .single();
  if (error || !site) redirect('/?error=' + encodeURIComponent(error?.message || 'Could not create site'));

  await db.from('banner_configs').insert({
    site_id: site.id,
    version: 1,
    layout: DEFAULT_SETTINGS.position,
    theme_json: {
      accent: DEFAULT_SETTINGS.accent,
      bg: DEFAULT_SETTINGS.bg,
      fg: DEFAULT_SETTINGS.fg,
      radius: DEFAULT_SETTINGS.radius,
    },
    copy_json: { title: DEFAULT_SETTINGS.title, body: DEFAULT_SETTINGS.body },
  });
  await pushConfigToEdge(key, compileConfigBlob(site.id, '1', DEFAULT_SETTINGS));

  revalidatePath('/');
  redirect(`/sites/${site.id}`);
}
