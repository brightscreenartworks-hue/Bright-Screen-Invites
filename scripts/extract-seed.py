#!/usr/bin/env python3
"""One-time generator: reads the existing static pages and writes supabase/seed.sql
so every sample and category that is live today is preserved in the database.
Usage:  python3 scripts/extract-seed.py  (run from the repo root; needs beautifulsoup4)
The generated SQL only INSERTs (on conflict do nothing) — it never overwrites data."""
import json, re, sys, os
from urllib.parse import urlparse, parse_qs
from bs4 import BeautifulSoup

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "supabase", "seed.sql")

def read(f): return open(os.path.join(ROOT, f), encoding="utf-8").read()
def soup(f): return BeautifulSoup(read(f), "html.parser")

def provider(url):
    h = (urlparse(url or "").hostname or "").lower()
    if "youtube.com" in h or h == "youtu.be": return "youtube"
    if "instagram.com" in h: return "instagram"
    if "vimeo.com" in h: return "vimeo"
    if h.startswith("photos.google") or h == "photos.app.goo.gl": return "google_photos"
    if h == "drive.google.com": return "google_drive"
    if "facebook.com" in h or h == "fb.watch": return "facebook"
    if "pinterest." in h or h == "pin.it": return "pinterest"
    if h == "wa.me" or not h: return "other"
    return "website"

# ---- top-level categories (index.html MAIN_SERVICES) ----
idx = read("index.html")
ms = re.search(r"const MAIN_SERVICES = \[(.*?)\n    \];", idx, re.S).group(1)
tops = []
for i, m in enumerate(re.finditer(r'id: "([^"]+)",\s*name: "([^"]+)",\s*thumbnail: "([^"]+)",\s*url: "([^"]+)"', ms)):
    tops.append(dict(slug=m[1], name=m[2], thumb=m[3], page_url=m[4], sort_order=i))

def hero(f):
    s = soup(f); h = s.select_one(".page-hero h1, .hero-sec h1"); p = s.select_one(".page-hero p, .hero-sec p")
    return (h.get_text(strip=True) if h else None, p.get_text(strip=True) if p else None)

top_meta = {
  "website-invites": dict(page_title="Website Invites", page_description="Select a wedding website category below to explore live interactive demo samples.", custom_thumb="RW 01.jpeg"),
  "video-invites": dict(page_title="Video Invites Collection", page_description="Explore our exclusive video invitation categories below with live video playback and instant customization options.", custom_thumb="3WI 01.jpg"),
}
for t in tops:
    if t["slug"] not in top_meta:
        ttl, desc = hero(t["page_url"])
        top_meta[t["slug"]] = dict(page_title=ttl, page_description=desc, custom_thumb=None)

def card_data(card, top, sub):
    a = card.select_one("a.gig-thumb-wrap"); img = card.select_one("img.gig-thumb-img")
    title = card.select_one(".gig-category-name").get_text(strip=True)
    fd = card.select_one(".btn-fill-details"); share = card.select_one(".action-share-btn")
    tag = card.select_one("a.sample-tag-line")
    fill_label = fill_cat = None
    href = fd.get("href", "") if fd else ""
    if href.startswith("fill-details.html"):
        q = parse_qs(urlparse(href).query)
        fill_label = q.get("sample", [None])[0]; fill_cat = q.get("cat", [None])[0]
    media = a.get("href") if a else None
    src = img.get("src") if img else ""
    fb = re.findall(r"this\.src='([^']+)'", img.get("onerror", "") if img else "")
    is_auto = "ytimg.com" in src
    return dict(legacy_id=card.get("id"), title=title, top=top, sub=sub, media_url=media,
        provider=provider(media), share_url=(share.get("data-share-url") if share else None) or media,
        auto_thumb=src if is_auto else None, custom_thumb=None if is_auto else src, fallbacks=fb,
        alt=img.get("alt") if img else title, vertical="yt-shorts-thumb" in (img.get("class") or []),
        uploaded_at=card.get("data-upload-date"), fill_label=fill_label, fill_cat=fill_cat,
        link_title=a.get("title") if a else None, tag_title=tag.get("title") if tag else None)

subs, samples = [], []
v = soup("video-invites.html"); vtxt = read("video-invites.html")
catobj = re.search(r"const CATEGORIES = \{(.*?)\n    \};", vtxt, re.S).group(1)
cats = {m[1]: dict(view=m[2], hash=m[3], name=m[4], desc=m[5].replace("\\'", "'")) for m in re.finditer(
    r"'(\w+)': \{\s*viewId: '([^']+)',\s*hash: '([^']+)',\s*name: '([^']+)',\s*desc: '((?:[^'\\]|\\.)*)'", catobj)}
for i, cc in enumerate(v.select("#view-categories .gig-card")):
    key = re.search(r"showCategory\('(\w+)'\)", cc.get("onclick", "")).group(1)
    c = cats[key]; badge = cc.select_one(".gig-badge-count")
    subs.append(dict(slug=key, name=c["name"], parent="video-invites", description=c["desc"], hash=c["hash"],
        view_id=c["view"], card_id=cc.get("id"), badge=badge.get_text(strip=True) if badge else None,
        icon=None, custom_thumb=None, sort_order=i))
    for card in v.select(f"#{c['view']} .sample-gig-card"):
        samples.append(card_data(card, "video-invites", key))

w = soup("wedding-websites.html")
web_desc = {
  "royal": "Palace-inspired royal wedding invitation website showcasing live RSVP, ceremony timeline, audio, and venue directions.",
  "cinematic": "Contemporary motion-driven wedding website with video trailer integration, modern typography, and guest RSVP.",
}
for i, cc in enumerate(w.select("#view-categories .gig-card")):
    key = re.search(r"showSample\('(\w+)'\)", cc.get("onclick", "")).group(1)
    sec = w.select_one(f"#view-{key}"); h2 = sec.select_one("h2"); img = cc.select_one("img")
    icon = h2.select_one("span").get_text() if h2 and h2.select_one("span") else None
    subs.append(dict(slug=key, name=cc.select_one(".gig-category-name").get_text(strip=True), parent="website-invites",
        description=web_desc.get(key), hash=cc.get("href", "#").lstrip("#"), view_id=f"view-{key}", card_id=cc.get("id"),
        badge=None, icon=icon, custom_thumb=img.get("src"), sort_order=i))
    for card in sec.select(".sample-gig-card"):
        samples.append(card_data(card, "website-invites", key))

for page, grid, top in [("static-invites.html", "#static-grid", "static-invites"),
                        ("itinerary-stationery.html", "#itinerary-grid", "itinerary-stationery")]:
    for card in soup(page).select(f"{grid} .sample-gig-card"):
        samples.append(card_data(card, top, None))

# Order exactly as visitors see it today: newest upload first (the pages sort by data-upload-date).
from datetime import datetime
def ts(s):
    try: return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception: return 0
groups = {}
for s in samples: groups.setdefault((s["top"], s["sub"]), []).append(s)
for g in groups.values():
    if any(x["uploaded_at"] for x in g):
        g.sort(key=lambda x: -ts(x["uploaded_at"] or ""))
    for i, x in enumerate(g): x["sort_order"] = i

def q(v):
    if v is None: return "null"
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, int): return str(v)
    if isinstance(v, list): return "array[" + ",".join(q(x) for x in v) + "]::text[]" if v else "'{}'::text[]"
    return "'" + str(v).replace("'", "''") + "'"

L = ["-- Generated by scripts/extract-seed.py from the live static pages.",
     "-- Inserts only; existing rows are never modified (safe to re-run).",
     "begin;",
     "select set_config('bs.silent', 'on', true);  -- don't flood Recent Activity with import rows"]
for t in tops:
    m = top_meta[t["slug"]]
    L.append(f"insert into public.categories (slug, name, page_url, page_title, page_description, custom_thumbnail_url, sort_order) values "
             f"({q(t['slug'])}, {q(t['name'])}, {q(t['page_url'])}, {q(m['page_title'])}, {q(m['page_description'])}, {q(m['custom_thumb'])}, {t['sort_order']}) "
             f"on conflict (slug) where parent_id is null do nothing;")
for s in subs:
    L.append(f"insert into public.categories (parent_id, slug, name, description, hash, view_id, card_id, badge, icon, custom_thumbnail_url, sort_order) "
             f"select id, {q(s['slug'])}, {q(s['name'])}, {q(s['description'])}, {q(s['hash'])}, {q(s['view_id'])}, {q(s['card_id'])}, {q(s['badge'])}, {q(s['icon'])}, {q(s['custom_thumb'])}, {s['sort_order']} "
             f"from public.categories where slug = {q(s['parent'])} and parent_id is null "
             f"on conflict (parent_id, slug) where parent_id is not null do nothing;")
for s in samples:
    sub_expr = "null" if not s["sub"] else (f"(select c.id from public.categories c join public.categories p on p.id = c.parent_id "
                                             f"where p.slug = {q(s['top'])} and p.parent_id is null and c.slug = {q(s['sub'])})")
    L.append("insert into public.samples (legacy_id, category_id, subcategory_id, title, media_url, media_provider, share_url, "
             "auto_thumbnail_url, custom_thumbnail_url, thumbnail_fallbacks, alt_text, vertical_thumb, fill_label, fill_category, "
             "link_title, tag_title, status, sort_order, uploaded_at, created_by) values ("
             f"{q(s['legacy_id'])}, (select id from public.categories where slug = {q(s['top'])} and parent_id is null), {sub_expr}, "
             f"{q(s['title'])}, {q(s['media_url'])}, {q(s['provider'])}, {q(s['share_url'])}, {q(s['auto_thumb'])}, {q(s['custom_thumb'])}, "
             f"{q(s['fallbacks'])}, {q(s['alt'])}, {q(s['vertical'])}, {q(s['fill_label'])}, {q(s['fill_cat'])}, {q(s['link_title'])}, "
             f"{q(s['tag_title'])}, 'published', {s['sort_order']}, {q(s['uploaded_at']) + '::timestamptz' if s['uploaded_at'] else 'now()'}, 'import') "
             "on conflict (legacy_id) do nothing;")
L.append("insert into public.activity_log (actor, action, entity, summary) select 'system', 'imported', 'sample', "
         f"'{len(samples)} existing samples & {len(tops) + len(subs)} categories from the live site' "
         "where not exists (select 1 from public.activity_log where action = 'imported');")
L.append("commit;")
open(OUT, "w", encoding="utf-8").write("\n".join(L) + "\n")
print(f"{len(tops)} categories, {len(subs)} subcategories, {len(samples)} samples -> {OUT}")
