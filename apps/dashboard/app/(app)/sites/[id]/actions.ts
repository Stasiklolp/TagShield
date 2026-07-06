'use server';

import { revalidatePath } from 'next/cache';
import { requireOrg } from '@/lib/auth';
import { adminClient } from '@/lib/supabase/admin';
import { checkInstalled } from '@/lib/install';
import { compileConfigBlob, DEFAULT_SETTINGS, pushConfigToEdge, type BannerSettings } from '@/lib/edge';

/** Load a site only if it belongs to the current user's org. */
async function ownedSite(siteId: string) {
  const { org } = await requireOrg();
  const db = adminClient();
  const { data: site } = await db
    .from('sites')
    .select('*')
    .eq('id', siteId)
    .eq('org_id', org.id)
    .maybeSingle();
  return { db, site: site as { id: string; domain: string; public_site_key: string } | null };
}

export async function verifyInstall(siteId: string) {
  const { db, site } = await ownedSite(siteId);
  if (!site) return;
  const res = await checkInstalled(site.domain, site.public_site_key);
  if (res.ok) {
    await db
      .from('sites')
      .update({ status: 'active', install_verified_at: new Date().toISOString() })
      .eq('id', siteId);
  }
  revalidatePath(`/sites/${siteId}`);
}

export async function saveBanner(siteId: string, formData: FormData) {
  const { db, site } = await ownedSite(siteId);
  if (!site) return;

  const { data: latest } = await db
    .from('banner_configs')
    .select('version')
    .eq('site_id', siteId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = ((latest?.version as number | undefined) ?? 0) + 1;

  const position = String(formData.get('position') || 'bottom');
  const settings: BannerSettings = {
    ...DEFAULT_SETTINGS,
    title: String(formData.get('title') || DEFAULT_SETTINGS.title),
    body: String(formData.get('body') || DEFAULT_SETTINGS.body),
    accent: String(formData.get('accent') || DEFAULT_SETTINGS.accent),
    position: (['bottom', 'top', 'corner'].includes(position) ? position : 'bottom') as BannerSettings['position'],
  };

  await db.from('banner_configs').insert({
    site_id: siteId,
    version: nextVersion,
    layout: settings.position,
    theme_json: { accent: settings.accent, bg: settings.bg, fg: settings.fg, radius: settings.radius },
    copy_json: { title: settings.title, body: settings.body },
  });
  await pushConfigToEdge(site.public_site_key, compileConfigBlob(siteId, String(nextVersion), settings));
  revalidatePath(`/sites/${siteId}`);
}
