// GET /api/catalog — public, read-only list of VISIBLE categories and PUBLISHED samples
// used by the client website. Exposes no admin or client data.
'use strict';

const { rest, send, handle, allowMethods, configured } = require('./_lib/supabase');

const CAT_FIELDS = 'id,parent_id,slug,name,description,page_title,page_description,badge,icon,page_url,hash,view_id,card_id,custom_thumbnail_url,sort_order';
const SAMPLE_FIELDS = 'id,legacy_id,category_id,subcategory_id,title,description,media_url,media_provider,share_url,auto_thumbnail_url,custom_thumbnail_url,thumbnail_fallbacks,alt_text,vertical_thumb,fill_label,fill_category,link_title,tag_title,sort_order,uploaded_at';

module.exports = handle(async (req, res) => {
  allowMethods(req, ['GET', 'HEAD']);
  if (!configured()) {
    return send(res, 503, { ok: false, error: 'not configured' }, { 'Cache-Control': 'no-store' });
  }
  const [cats, samples] = await Promise.all([
    rest(`categories?select=${CAT_FIELDS}&is_visible=eq.true&order=sort_order.asc,name.asc`),
    rest(`samples?select=${SAMPLE_FIELDS}&status=eq.published&order=sort_order.asc,uploaded_at.desc`),
  ]);

  const byId = new Map(cats.map((c) => [c.id, c]));
  // A subcategory is only visible when its parent is visible too.
  const visible = cats.filter((c) => !c.parent_id || byId.has(c.parent_id));
  const visibleIds = new Set(visible.map((c) => c.id));

  const categories = visible.map((c) => ({
    id: c.id,
    parent: c.parent_id ? byId.get(c.parent_id).slug : null,
    slug: c.slug,
    name: c.name,
    description: c.description,
    pageTitle: c.page_title,
    pageDescription: c.page_description,
    badge: c.badge,
    icon: c.icon,
    pageUrl: c.page_url,
    hash: c.hash,
    viewId: c.view_id,
    cardId: c.card_id,
    thumbnail: c.custom_thumbnail_url,
    order: c.sort_order,
  }));

  const out = samples
    .filter((s) => visibleIds.has(s.category_id) && (!s.subcategory_id || visibleIds.has(s.subcategory_id)))
    .map((s) => ({
      id: s.id,
      domId: s.legacy_id || `sample-${s.id.slice(0, 8)}`,
      category: byId.get(s.category_id).slug,
      subcategory: s.subcategory_id ? byId.get(s.subcategory_id).slug : null,
      title: s.title,
      description: s.description,
      mediaUrl: s.media_url,
      provider: s.media_provider,
      shareUrl: s.share_url,
      thumbnail: s.custom_thumbnail_url || s.auto_thumbnail_url || '',
      fallbacks: s.thumbnail_fallbacks || [],
      alt: s.alt_text,
      vertical: s.vertical_thumb,
      fillLabel: s.fill_label,
      fillCategory: s.fill_category,
      linkTitle: s.link_title,
      tagTitle: s.tag_title,
      order: s.sort_order,
      uploadedAt: s.uploaded_at,
    }));

  send(res, 200, { ok: true, generatedAt: new Date().toISOString(), categories, samples: out }, {
    // Short CDN cache so admin changes appear on the live site within ~15 seconds.
    'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=120',
  });
});
