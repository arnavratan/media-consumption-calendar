'use strict';
const { Plugin, ItemView, Modal, Menu, Notice, PluginSettingTab, Setting, requestUrl, normalizePath } = require('obsidian');

const VIEW_TYPE = 'media-calendar-view';
const TYPES = ['Comic', 'Manga', 'Book', 'Movie', 'TV', 'Anime', 'Game', 'Podcast', 'Other']; // add new categories here
const DEFAULTS = { dataPath: 'Media/media-cache.json', tmdbKey: '', rawgKey: '', weekStartsMonday: false, maxCovers: 6, coverWidth: 44, modalWidth: 900, modalBlur: 10, stackCovers: true, dragAction: 'copy', googleKey: '', igdbClientId: '', igdbClientSecret: '' };
const SUPPORT_URL = 'https://buymeacoffee.com/arnavratan'; // optional support link shown in settings
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const enc = encodeURIComponent;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));

/* ───────────── data store (the single source of truth) ───────────── */

function normalize(r) {
  if (!r || typeof r !== 'object') return null;
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!title || typeof r.date !== 'string' || !DATE_RE.test(r.date)) return null;
  const y = parseInt(r.year, 10);
  const order = typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : undefined; // position in that day's stack
  return {
    ...r,
    order,
    id: typeof r.id === 'string' && r.id ? r.id : uid(),
    title,
    type: TYPES.includes(r.type) ? r.type : 'Other',
    date: r.date,
    coverUrl: typeof r.coverUrl === 'string' ? r.coverUrl.trim() : '',
    year: Number.isFinite(y) ? y : null,
    info: typeof r.info === 'string' ? r.info : '',
  };
}

// Entries on one day, in stack order. Entries never reordered (no `order`) keep their insertion order, after any ordered ones.
const stackSort = (a, b) => {
  if (a.order === undefined && b.order === undefined) return 0;
  if (a.order === undefined) return 1;
  if (b.order === undefined) return -1;
  return a.order - b.order;
};

class Store {
  constructor(p) { this.p = p; this.subs = new Set(); this.selfWrite = false; this.backedUp = false; this.reset(); }
  reset() { this.entries = []; this.unparsed = []; this.extra = {}; this.locked = false; }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { this.subs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }
  get path() { return normalizePath((this.p.settings.dataPath || '').trim() || DEFAULTS.dataPath); }

  async load() {
    const a = this.p.app.vault.adapter;
    this.reset();
    try {
      if (!(await a.exists(this.path))) {
        await this.save(); // first run: create an empty database
      } else {
        const raw = await a.read(this.path);
        let data;
        try { data = JSON.parse(raw); } catch (e) {
          const bak = this.path.replace(/\.json$/i, '') + `.corrupt-${Date.now()}.json`;
          await a.write(bak, raw);
          this.locked = true;
          new Notice(`Media Calendar: ${this.path} is not valid JSON. A copy was saved to ${bak}. Saving is disabled until the file is fixed; then run "Media Calendar: Reload data".`, 15000);
          this.emit(); return;
        }
        if (Array.isArray(data)) data = { entries: data };
        const { entries, unparsed, ...extra } = data || {};
        this.extra = extra;
        this.unparsed = Array.isArray(unparsed) ? unparsed : [];
        let bad = 0;
        for (const r of (Array.isArray(entries) ? entries : [])) {
          const n = normalize(r);
          if (n) this.entries.push(n); else { this.unparsed.push(r); bad++; }
        }
        if (bad) new Notice(`Media Calendar: ${bad} malformed entr${bad === 1 ? 'y was' : 'ies were'} set aside under "unparsed" in the JSON (nothing was deleted).`, 8000);
      }
    } catch (e) {
      console.error(e); this.locked = true;
      new Notice('Media Calendar: could not read the data file — ' + e.message, 10000);
    }
    this.emit();
  }

  async save() {
    if (this.locked) { new Notice('Media Calendar: saving is disabled because the data file could not be read.'); return false; }
    const a = this.p.app.vault.adapter;
    try {
      const dir = this.path.split('/').slice(0, -1).join('/');
      if (dir && !(await a.exists(dir))) await a.mkdir(dir);
      if (!this.backedUp && await a.exists(this.path)) { // one safety copy per session
        await a.write(this.path.replace(/\.json$/i, '') + '.bak.json', await a.read(this.path));
        this.backedUp = true;
      }
      const out = { ...this.extra, version: 1, entries: this.entries };
      if (this.unparsed.length) out.unparsed = this.unparsed;
      this.selfWrite = true;
      await a.write(this.path, JSON.stringify(out, null, 2));
      window.setTimeout(() => { this.selfWrite = false; }, 800);
      return true;
    } catch (e) {
      this.selfWrite = false; console.error(e);
      new Notice('Media Calendar: could not save — ' + e.message, 10000);
      return false;
    }
  }

  async add(e) {
    const n = normalize({ ...e, id: uid() });
    if (!n) { new Notice('Entry needs a title and a valid date.'); return null; }
    delete n.order; // new and duplicated entries start unordered, so they sit after any manually ordered ones
    this.entries.push(n); this.emit();
    if (!(await this.save())) { this.entries.pop(); this.emit(); return null; }
    return n;
  }
  async update(id, patch) {
    const i = this.entries.findIndex(x => x.id === id); if (i < 0) return false;
    const old = this.entries[i], n = normalize({ ...old, ...patch });
    if (!n) { new Notice('Entry needs a title and a valid date.'); return false; }
    if (n.date !== old.date) delete n.order; // moved to another day: its old position doesn't apply there
    this.entries[i] = n; this.emit();
    if (!(await this.save())) { this.entries[i] = old; this.emit(); return false; }
    return true;
  }
  async remove(id) {
    const i = this.entries.findIndex(x => x.id === id); if (i < 0) return false;
    const [old] = this.entries.splice(i, 1); this.emit();
    if (!(await this.save())) { this.entries.splice(i, 0, old); this.emit(); return false; }
    return true;
  }
  dayList(date) { return this.entries.filter(e => e.date === date).sort(stackSort); }
  async reorder(date, ids) { // ids: every entry of that day, in the new order
    const prev = new Map(this.entries.filter(e => e.date === date).map(e => [e, e.order]));
    ids.forEach((id, i) => { const e = this.entries.find(x => x.id === id); if (e && e.date === date) e.order = i; });
    this.emit();
    if (!(await this.save())) { prev.forEach((o, e) => { if (o === undefined) delete e.order; else e.order = o; }); this.emit(); return false; }
    return true;
  }
  async moveToEnd(id, toFront) { // for the right-click menu (works on touch screens too)
    const e = this.entries.find(x => x.id === id); if (!e) return false;
    const rest = this.dayList(e.date).filter(x => x.id !== id).map(x => x.id);
    return this.reorder(e.date, toFront ? [id, ...rest] : [...rest, id]);
  }
  byDate(filter) {
    const m = new Map();
    for (const e of this.entries) {
      if (filter && filter !== 'All' && e.type !== filter) continue;
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date).push(e);
    }
    m.forEach(list => list.sort(stackSort));
    return m;
  }
}

/* ───────────── metadata providers ───────────── */

const jsonCache = new Map();
async function getJson(url, opts = {}) {
  const key = url + (opts.body || ''), hit = jsonCache.get(key);
  if (hit && Date.now() - hit.t < 600000) return hit.v;
  let host = 'API'; try { host = new URL(url).hostname.replace(/^(www|api)\./, ''); } catch (e) { /* keep default */ }
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await requestUrl({ url, throw: false, ...opts });
    if (r.status !== 429) break;
    await new Promise(res => window.setTimeout(res, 1500)); // brief backoff, then one retry
  }
  if (r.status === 429) throw new Error(`${host} is rate limiting requests, wait a minute and retry`);
  if (r.status >= 400) throw new Error(`${host}: HTTP ${r.status}`);
  jsonCache.set(key, { t: Date.now(), v: r.json });
  return r.json;
}
const https = u => (u ? u.replace(/^http:/, 'https:') : '');

async function tmdb(s, q, kind) {
  if (!s.tmdbKey) throw new Error('TMDB key not set (Settings → Media Calendar)');
  const bearer = s.tmdbKey.length > 40;
  const url = `https://api.themoviedb.org/3/search/${kind}?query=${enc(q)}&include_adult=false` + (bearer ? '' : `&api_key=${s.tmdbKey}`);
  const j = await getJson(url, bearer ? { headers: { Authorization: 'Bearer ' + s.tmdbKey } } : {});
  return (j.results || []).slice(0, 12).map(x => ({
    title: x.title || x.name, type: kind === 'movie' ? 'Movie' : 'TV',
    year: parseInt((x.release_date || x.first_air_date || '').slice(0, 4)) || null,
    coverUrl: x.poster_path ? 'https://image.tmdb.org/t/p/w342' + x.poster_path : '', sub: '',
  }));
}
async function tmdbPosters(s, q, kind) { // every poster TMDB has for the best match
  const bearer = s.tmdbKey.length > 40, h = bearer ? { headers: { Authorization: 'Bearer ' + s.tmdbKey } } : {}, key = bearer ? '' : `&api_key=${s.tmdbKey}`;
  const j = await getJson(`https://api.themoviedb.org/3/search/${kind}?query=${enc(q)}&include_adult=false${key}`, h);
  const top = (j.results || [])[0]; if (!top) return [];
  const im = await getJson(`https://api.themoviedb.org/3/${kind}/${top.id}/images?include_image_language=en,null${key}`, h);
  return (im.posters || []).slice(0, 30).map(x => ({ coverUrl: 'https://image.tmdb.org/t/p/w342' + x.file_path, label: `${top.title || top.name} · poster` }));
}
async function rawg(s, q) {
  if (!s.rawgKey) throw new Error('No game source set up: add IGDB credentials (portrait covers) or a RAWG key in Settings → Media Calendar');
  const j = await getJson(`https://api.rawg.io/api/games?key=${s.rawgKey}&search=${enc(q)}&page_size=12`);
  return (j.results || []).map(x => ({
    title: x.name, type: 'Game', year: parseInt((x.released || '').slice(0, 4)) || null,
    coverUrl: x.background_image || '', sub: (x.platforms || []).slice(0, 2).map(p => p.platform.name).join(', '),
  }));
}
let igdbTok = { t: '', exp: 0 };
async function igdbToken(s) {
  if (igdbTok.t && Date.now() < igdbTok.exp) return igdbTok.t;
  const r = await requestUrl({ url: `https://id.twitch.tv/oauth2/token?client_id=${enc(s.igdbClientId)}&client_secret=${enc(s.igdbClientSecret)}&grant_type=client_credentials`, method: 'POST', throw: false });
  if (r.status >= 400) throw new Error('IGDB login failed, check Client ID/Secret');
  igdbTok = { t: r.json.access_token, exp: Date.now() + (r.json.expires_in - 300) * 1000 };
  return igdbTok.t;
}
async function igdb(s, q) {
  const token = await igdbToken(s);
  const body = `search "${q.replace(/["\\]/g, '')}"; fields name,first_release_date,cover.image_id,platforms.abbreviation; limit 12;`;
  const r = await requestUrl({ url: 'https://api.igdb.com/v4/games', method: 'POST', headers: { 'Client-ID': s.igdbClientId, Authorization: 'Bearer ' + token }, contentType: 'text/plain', body, throw: false });
  if (r.status === 429) throw new Error('IGDB rate limited, try again shortly');
  if (r.status >= 400) { if (r.status === 401) igdbTok = { t: '', exp: 0 }; throw new Error('IGDB HTTP ' + r.status); }
  return (r.json || []).map(x => ({
    title: x.name, type: 'Game',
    year: x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null,
    coverUrl: x.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${x.cover.image_id}.jpg` : '',
    sub: (x.platforms || []).slice(0, 3).map(p => p.abbreviation).filter(Boolean).join(', '),
  }));
}
async function gameSearch(s, q) {
  if (s.igdbClientId && s.igdbClientSecret) {
    try { return await igdb(s, q); } catch (e) { if (!s.rawgKey) throw e; }
  }
  return rawg(s, q);
}
async function anilist(q, mediaType) {
  const query = 'query($s:String,$t:MediaType){Page(perPage:12){media(search:$s,type:$t,sort:SEARCH_MATCH){title{romaji english} startDate{year} coverImage{large}}}}';
  const j = await getJson('https://graphql.anilist.co', { method: 'POST', contentType: 'application/json', body: JSON.stringify({ query, variables: { s: q, t: mediaType } }) });
  return (j.data?.Page?.media || []).map(x => ({
    title: x.title.english || x.title.romaji, type: mediaType === 'MANGA' ? 'Manga' : 'Anime',
    year: x.startDate?.year || null, coverUrl: x.coverImage?.large || '', sub: '',
  }));
}
async function googleBooks(s, q, type) {
  const query = type === 'Comic' ? `${enc(q)}+subject:comics` : enc(q);
  const j = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=12&printType=books${s.googleKey ? '&key=' + s.googleKey : ''}`);
  return (j.items || []).map(x => {
    const v = x.volumeInfo || {};
    return {
      title: v.title + (v.subtitle ? ': ' + v.subtitle : ''), type,
      year: parseInt((v.publishedDate || '').slice(0, 4)) || null,
      coverUrl: https(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail), sub: (v.authors || []).slice(0, 2).join(', '),
    };
  });
}
async function openLibrary(q) {
  const j = await getJson(`https://openlibrary.org/search.json?q=${enc(q)}&limit=12&fields=title,author_name,first_publish_year,cover_i`);
  return (j.docs || []).map(x => ({
    title: x.title, type: 'Book', year: x.first_publish_year || null,
    coverUrl: x.cover_i ? `https://covers.openlibrary.org/b/id/${x.cover_i}-M.jpg` : '', sub: (x.author_name || []).slice(0, 2).join(', '),
  })).sort((a, b) => !!b.coverUrl - !!a.coverUrl);
}
async function bookSearch(s, q) {
  let r = []; try { r = await openLibrary(q); } catch (e) { /* fall through to Google */ }
  if (r.filter(x => x.coverUrl).length < 3) r = r.concat(await googleBooks(s, q, 'Book'));
  return r;
}

async function podcasts(q) { // Apple's public iTunes Search API: no key needed. Shows first, then matching episodes.
  const base = `https://itunes.apple.com/search?media=podcast&term=${enc(q)}`;
  const [shows, eps] = await Promise.allSettled([getJson(base + '&entity=podcast&limit=12'), getJson(base + '&entity=podcastEpisode&limit=8')]);
  if (shows.status === 'rejected' && eps.status === 'rejected') throw shows.reason;
  const art = x => https(x.artworkUrl600 || x.artworkUrl160 || x.artworkUrl100 || '');
  const out = [];
  if (shows.status === 'fulfilled') (shows.value.results || []).forEach(x => out.push({
    title: x.collectionName || x.trackName, type: 'Podcast', year: null, coverUrl: art(x), sub: x.artistName || '',
  }));
  if (eps.status === 'fulfilled') (eps.value.results || []).forEach(x => out.push({
    title: x.trackName, type: 'Podcast', year: parseInt((x.releaseDate || '').slice(0, 4)) || null, coverUrl: art(x), sub: x.collectionName || '',
  }));
  return out;
}

async function searchAll(s, q, filter) {
  const want = t => filter === 'All' || filter === t || (filter === 'Books/Comics' && (t === 'Book' || t === 'Comic'));
  const jobs = [];
  if (want('Movie')) jobs.push(() => tmdb(s, q, 'movie'));
  if (want('TV')) jobs.push(() => tmdb(s, q, 'tv'));
  if (want('Book')) jobs.push(() => bookSearch(s, q));
  if (want('Comic')) jobs.push(() => googleBooks(s, q, 'Comic'));
  if (want('Manga')) jobs.push(() => anilist(q, 'MANGA'));
  if (want('Anime')) jobs.push(() => anilist(q, 'ANIME'));
  if (want('Game')) jobs.push(() => gameSearch(s, q));
  if (want('Podcast')) jobs.push(() => podcasts(q));
  const settled = await Promise.allSettled(jobs.map(j => j()));
  const results = [], errors = [], seen = new Set();
  for (const r of settled) {
    if (r.status === 'rejected') { const m = r.reason?.message || String(r.reason); if (!errors.includes(m)) errors.push(m); continue; }
    for (const x of r.value) {
      const k = `${x.type === 'Comic' ? 'Book' : x.type}|${(x.title || '').toLowerCase()}|${x.year}`; // Book/Comic share one list, so dedupe across them
      if (!x.title || seen.has(k)) continue;
      seen.add(k); results.push(x);
    }
  }
  return { results, errors };
}

/* ───────────── UI helpers ───────────── */

function coverEl(parent, e, cls) {
  const wrap = parent.createDiv({ cls: 'mc-cover ' + (cls || '') });
  wrap.dataset.type = e.type;
  const ph = () => {
    wrap.empty(); wrap.addClass('mc-nocover');
    wrap.createDiv({ cls: 'mc-ph-title', text: e.title });
    wrap.createDiv({ cls: 'mc-ph-type', text: e.type });
  };
  if (!e.coverUrl) ph();
  else { const img = wrap.createEl('img', { attr: { src: e.coverUrl, alt: e.title, loading: 'lazy', referrerpolicy: 'no-referrer', draggable: 'false' } }); img.onerror = ph;
    img.onload = () => { // landscape art (e.g. RAWG): fit it instead of cropping, on a blurred backdrop
      if (img.naturalWidth > img.naturalHeight * 1.1) { wrap.addClass('mc-land'); wrap.style.setProperty('--mc-bg', `url("${e.coverUrl}")`); }
    };
  }
  return wrap;
}
const SAME_PLURAL = new Set(['Manga', 'TV', 'Anime', 'Other']); // read the same in the plural
const pluralType = (t, n) => (n === 1 || SAME_PLURAL.has(t) ? t : t + 's');
const metaLine = e => [e.type, e.year, e.info || e.sub].filter(Boolean).join(' · ');

/* ───────────── modals ───────────── */

let GLASS_BLUR = DEFAULTS.modalBlur; // px; kept in sync with the "Window blur" setting
function applyGlass(modal) { // lets the stylesheet's frosted-glass blur follow the setting
  modal.containerEl.style.setProperty('--mc-glass-blur', GLASS_BLUR + 'px');
}
function sizeModal(modal, plugin) {
  applyGlass(modal);
  modal.modalEl.addClass('mc-modal-el');
  modal.modalEl.style.width = Math.min(plugin.settings.modalWidth, Math.floor(window.innerWidth * 0.95)) + 'px';
}

class AddModal extends Modal {
  constructor(app, plugin, date) { super(app); this.plugin = plugin; this.date = date; this.type = 'All'; this.sel = null; this.tok = 0; }
  onOpen() {
    sizeModal(this, this.plugin);
    const c = this.contentEl; c.addClass('mc-modal'); this.titleEl.setText('Add media');
    const top = c.createDiv({ cls: 'mc-add-top' });
    this.input = top.createEl('input', { type: 'text', cls: 'mc-grow', attr: { placeholder: 'Search a title…' } });
    this.input.addEventListener('keydown', e => { if (e.key === 'Enter') this.search(); });
    top.createEl('button', { text: 'Search', cls: 'mod-cta' }).onclick = () => this.search();
    const d = top.createEl('input', { type: 'date' }); d.value = this.date; d.onchange = () => { this.date = d.value; };
    const row = c.createDiv({ cls: 'mc-chips' });
    ['All', ...TYPES.filter(t => t !== 'Other' && t !== 'Book').map(t => t === 'Comic' ? 'Books/Comics' : t)].forEach(t => { // Book + Comic are one search chip
      const b = row.createEl('button', { text: t, cls: 'mc-chip' + (t === this.type ? ' on' : '') });
      b.onclick = () => { this.type = t; row.querySelectorAll('.mc-chip').forEach(x => x.toggleClass('on', x === b)); if (this.input.value.trim()) this.search(); };
    });
    this.status = c.createDiv({ cls: 'mc-status', text: 'Type a title and press Enter.' });
    this.grid = c.createDiv({ cls: 'mc-results' });
    this.foot = c.createDiv({ cls: 'mc-foot' });
    this.selLabel = this.foot.createDiv({ cls: 'mc-grow mc-sel', text: 'Nothing selected' });
    this.info = this.foot.createEl('input', { type: 'text', attr: { placeholder: 'Details (vol. 3, S02E05, episode, platform…)' } });
    this.addBtn = this.foot.createEl('button', { text: 'Add to calendar', cls: 'mod-cta' });
    this.addBtn.disabled = true; this.addBtn.onclick = () => this.confirm();

    const det = c.createEl('details', { cls: 'mc-manual' });
    det.createEl('summary', { text: "Can't find it? Add manually" });
    const f = det.createDiv({ cls: 'mc-form' });
    const t = f.createEl('input', { type: 'text', attr: { placeholder: 'Title' } });
    const ty = f.createEl('select'); TYPES.forEach(x => ty.createEl('option', { text: x, value: x }));
    const yr = f.createEl('input', { type: 'number', attr: { placeholder: 'Year' } });
    const inf = f.createEl('input', { type: 'text', attr: { placeholder: 'Details' } });
    const cu = f.createEl('input', { type: 'text', cls: 'mc-wide', attr: { placeholder: 'Cover image URL (optional)' } });
    f.createEl('button', { text: 'Add manually' }).onclick = async () => {
      if (!t.value.trim()) return new Notice('Enter a title.');
      if (!DATE_RE.test(this.date)) return new Notice('Pick a valid date.');
      const ok = await this.plugin.store.add({ title: t.value, type: ty.value, date: this.date, year: yr.value, info: inf.value, coverUrl: cu.value });
      if (ok) { new Notice(`Added “${ok.title}” to ${ok.date}`); t.value = yr.value = inf.value = cu.value = ''; }
    };
    window.setTimeout(() => this.input.focus(), 50);
  }
  async search() {
    const q = this.input.value.trim(); if (!q) return;
    const tok = ++this.tok; this.sel = null; this.updateFoot(); this.grid.empty();
    this.status.setText('Searching…');
    const { results, errors } = await searchAll(this.plugin.settings, q, this.type);
    if (tok !== this.tok) return;
    this.grid.empty();
    results.forEach(r => {
      const card = this.grid.createDiv({ cls: 'mc-card' });
      coverEl(card, r);
      card.createDiv({ cls: 'mc-card-title', text: r.title });
      card.createDiv({ cls: 'mc-card-meta', text: metaLine(r) });
      card.onclick = () => { this.grid.querySelectorAll('.mc-card').forEach(x => x.removeClass('sel')); card.addClass('sel'); this.sel = r; this.updateFoot(); };
    });
    const err = errors.length ? ' · ' + errors.join(' · ') : '';
    this.status.setText(results.length ? `${results.length} results${err}` : (errors.join(' · ') || 'No results. Try another spelling or add it manually below.'));
  }
  updateFoot() {
    this.selLabel.setText(this.sel ? `${this.sel.title}${this.sel.year ? ' (' + this.sel.year + ')' : ''}` : 'Nothing selected');
    this.addBtn.disabled = !this.sel;
  }
  async confirm() {
    if (!this.sel) return;
    if (!DATE_RE.test(this.date)) return new Notice('Pick a valid date.');
    const r = this.sel;
    const ok = await this.plugin.store.add({ title: r.title, type: r.type, date: this.date, coverUrl: r.coverUrl, year: r.year, info: this.info.value.trim() || r.sub || '' });
    if (ok) {
      new Notice(`Added “${r.title}” to ${this.date}`);
      this.sel = null; this.info.value = ''; this.grid.querySelectorAll('.mc-card').forEach(x => x.removeClass('sel')); this.updateFoot();
    }
  }
}

class PromptModal extends Modal {
  constructor(app, title, value, onSubmit, opts = {}) { super(app); this.t = title; this.v = value; this.cb = onSubmit; this.o = opts; }
  onOpen() {
    applyGlass(this);
    this.titleEl.setText(this.t);
    const i = this.contentEl.createEl('input', { type: 'text', cls: 'mc-prompt-input' }); i.value = this.v;
    const go = () => { const v = i.value.trim(); if (v) { this.close(); this.cb(v); } };
    i.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    const bar = this.contentEl.createDiv({ cls: 'mc-actions' });
    bar.createDiv({ cls: 'mc-grow' });
    bar.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    bar.createEl('button', { text: 'OK', cls: 'mod-cta' }).onclick = go;
    window.setTimeout(() => { i.focus(); i.select(); }, 30);
  }
}

class ConfirmDelete extends Modal {
  constructor(app, plugin, e) { super(app); this.plugin = plugin; this.e = e; }
  onOpen() {
    applyGlass(this);
    this.titleEl.setText('Delete entry?');
    this.contentEl.createDiv({ text: `“${this.e.title}” on ${this.e.date} will be removed from the calendar.` });
    const bar = this.contentEl.createDiv({ cls: 'mc-actions' });
    bar.createDiv({ cls: 'mc-grow' });
    bar.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    bar.createEl('button', { text: 'Delete', cls: 'mod-warning' }).onclick = async () => { if (await this.plugin.store.remove(this.e.id)) this.close(); };
  }
}

function entryMenu(plugin, ev, e) {
  ev.preventDefault(); ev.stopPropagation();
  const app = plugin.app, m = new Menu();
  m.addItem(i => i.setTitle('Properties').setIcon('info').onClick(() => new DetailsModal(app, plugin, e).open()));
  m.addItem(i => i.setTitle('Rename').setIcon('pencil').onClick(() => new PromptModal(app, 'Rename', e.title, v => plugin.store.update(e.id, { title: v })).open()));
  m.addItem(i => i.setTitle('Change cover…').setIcon('images').onClick(() => new CoverPicker(app, plugin, e).open()));
  m.addItem(i => i.setTitle('Set cover URL').setIcon('link').onClick(() => new PromptModal(app, 'Cover image URL', e.coverUrl || '', v => plugin.store.update(e.id, { coverUrl: v })).open()));
  if (plugin.store.dayList(e.date).length > 1) {
    m.addItem(i => i.setTitle('Bring to front').setIcon('arrow-up-to-line').onClick(() => plugin.store.moveToEnd(e.id, true)));
    m.addItem(i => i.setTitle('Send to back').setIcon('arrow-down-to-line').onClick(() => plugin.store.moveToEnd(e.id, false)));
  }
  m.addItem(i => i.setTitle('Duplicate to today').setIcon('copy').onClick(async () => { if (await plugin.store.add({ ...e, date: fmt(new Date()) })) new Notice('Duplicated to today'); }));
  m.addSeparator();
  m.addItem(i => i.setTitle('Delete').setIcon('trash').onClick(() => new ConfirmDelete(app, plugin, e).open()));
  m.showAtMouseEvent(ev);
}

class CoverPicker extends Modal {
  constructor(app, plugin, e, onPick) { super(app); this.plugin = plugin; this.e = e; this.tok = 0; this.onPick = onPick; } // onPick: hand the URL back instead of saving it (used by the details window)
  onOpen() {
    sizeModal(this, this.plugin);
    const c = this.contentEl; c.addClass('mc-modal'); this.titleEl.setText('Change cover');
    const top = c.createDiv({ cls: 'mc-add-top' });
    this.input = top.createEl('input', { type: 'text', cls: 'mc-grow', attr: { placeholder: 'Search covers…' } });
    this.input.value = this.e.title;
    this.input.addEventListener('keydown', ev => { if (ev.key === 'Enter') this.search(); });
    top.createEl('button', { text: 'Search', cls: 'mod-cta' }).onclick = () => this.search();
    const url = c.createDiv({ cls: 'mc-add-top' });
    const u = url.createEl('input', { type: 'text', cls: 'mc-grow', attr: { placeholder: 'Or paste an image URL…' } });
    url.createEl('button', { text: 'Use URL' }).onclick = () => { if (u.value.trim()) this.pick(u.value.trim()); };
    this.status = c.createDiv({ cls: 'mc-status' });
    this.grid = c.createDiv({ cls: 'mc-results' });
    this.search();
  }
  async search() {
    const q = this.input.value.trim(); if (!q) return;
    const tok = ++this.tok, s = this.plugin.settings, t = this.e.type;
    this.grid.empty(); this.status.setText('Searching…');
    const items = [], seen = new Set(), msgs = [];
    const add = (url, label) => { if (url && !seen.has(url)) { seen.add(url); items.push({ coverUrl: url, label }); } };
    if ((t === 'Movie' || t === 'TV') && s.tmdbKey) {
      try { (await tmdbPosters(s, q, t === 'Movie' ? 'movie' : 'tv')).forEach(x => add(x.coverUrl, x.label)); } catch (err) { msgs.push(err.message); }
    }
    const { results, errors } = await searchAll(s, q, t === 'Other' ? 'All' : (t === 'Book' || t === 'Comic') ? 'Books/Comics' : t);
    results.forEach(r => add(r.coverUrl, [r.title, r.year].filter(Boolean).join(' · ')));
    if (tok !== this.tok) return;
    this.grid.empty();
    items.forEach(it => {
      const card = this.grid.createDiv({ cls: 'mc-card' });
      coverEl(card, { ...this.e, coverUrl: it.coverUrl });
      card.createDiv({ cls: 'mc-card-meta', text: it.label });
      card.onclick = () => this.pick(it.coverUrl);
    });
    const err = [...msgs, ...errors].join(' · ');
    this.status.setText(items.length ? `${items.length} covers. Click one to use it.${err ? ' · ' + err : ''}` : (err || 'No covers found. Try a different search or paste a URL.'));
  }
  async pick(url) {
    if (this.onPick) { this.onPick(url); this.close(); return; }
    if (await this.plugin.store.update(this.e.id, { coverUrl: url })) { new Notice('Cover updated'); this.close(); }
  }
}

class DetailsModal extends Modal {
  constructor(app, plugin, entry) { super(app); this.plugin = plugin; this.id = entry.id; this.e = entry; }
  onOpen() {
    sizeModal(this, this.plugin);
    const c = this.contentEl; c.addClass('mc-modal'); this.titleEl.setText('Entry details');
    const e = this.e, body = c.createDiv({ cls: 'mc-details' });
    const left = body.createDiv({ cls: 'mc-details-cover' });
    const coverBox = left.createDiv();
    const draw = url => { coverBox.empty(); coverEl(coverBox, { ...e, coverUrl: url }); };
    draw(e.coverUrl);
    const changeBtn = left.createEl('button', { text: 'Change cover', cls: 'mc-change-cover' });
    const f = body.createDiv({ cls: 'mc-form mc-grow' });
    const field = (label, el) => { const w = f.createDiv({ cls: 'mc-field' }); w.createEl('label', { text: label }); w.appendChild(el); return el; };
    const title = field('Title', createEl('input', { type: 'text' })); title.value = e.title;
    const type = field('Type', createEl('select')); TYPES.forEach(t => type.createEl('option', { text: t, value: t })); type.value = e.type;
    const date = field('Date', createEl('input', { type: 'date' })); date.value = e.date;
    const year = field('Year of Release', createEl('input', { type: 'number' })); year.value = e.year ?? '';
    const info = field('Details', createEl('input', { type: 'text' })); info.value = e.info || '';
    const cover = field('Custom Cover URL', createEl('input', { type: 'text' })); cover.value = e.coverUrl || '';
    cover.onchange = () => draw(cover.value.trim());
    changeBtn.onclick = () => new CoverPicker(this.app, this.plugin, { ...e, title: title.value.trim() || e.title, type: type.value }, url => { cover.value = url; draw(url); }).open(); // applied when you press Save
    const bar = c.createDiv({ cls: 'mc-actions' });
    const del = bar.createEl('button', { text: 'Delete', cls: 'mod-warning' });
    let armed = false;
    del.onclick = async () => {
      if (!armed) { armed = true; del.setText('Click again to confirm'); window.setTimeout(() => { armed = false; del.setText('Delete'); }, 3000); return; }
      if (await this.plugin.store.remove(this.id)) this.close();
    };
    bar.createDiv({ cls: 'mc-grow' });
    bar.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    bar.createEl('button', { text: 'Save', cls: 'mod-cta' }).onclick = async () => {
      if (await this.plugin.store.update(this.id, { title: title.value, type: type.value, date: date.value, year: year.value, info: info.value, coverUrl: cover.value })) this.close();
    };
  }
}

class DayModal extends Modal {
  constructor(app, plugin, date, filter) { super(app); this.plugin = plugin; this.date = date; this.filter = filter; }
  onOpen() { sizeModal(this, this.plugin); this.contentEl.addClass('mc-modal'); this.unsub = this.plugin.store.on(() => this.draw()); this.draw(); }
  onClose() { this.unsub && this.unsub(); }
  draw() {
    const c = this.contentEl; c.empty();
    const [y, m, d] = this.date.split('-').map(Number);
    this.titleEl.setText(new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    const list = this.plugin.store.dayList(this.date);
    c.createEl('button', { text: '+ Add media', cls: 'mod-cta' }).onclick = () => new AddModal(this.app, this.plugin, this.date).open();
    if (!list.length) { c.createDiv({ cls: 'mc-empty', text: 'Nothing logged on this day yet.' }); return; }
    const box = c.createDiv({ cls: 'mc-daylist' });
    list.forEach(e => {
      const row = box.createDiv({ cls: 'mc-row' });
      coverEl(row, e, 'mc-thumb');
      const t = row.createDiv({ cls: 'mc-grow' });
      t.createDiv({ cls: 'mc-card-title', text: e.title }); t.createDiv({ cls: 'mc-card-meta', text: metaLine(e) });
      row.onclick = () => new DetailsModal(this.app, this.plugin, e).open();
      row.addEventListener('contextmenu', ev => entryMenu(this.plugin, ev, e));
    });
  }
}

/* ───────────── calendar view ───────────── */

class CalView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin;
    const n = new Date(); this.year = n.getFullYear(); this.month = n.getMonth(); this.filter = 'All';
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Media Calendar'; }
  getIcon() { return 'calendar-days'; }
  async onOpen() {
    const c = this.contentEl; c.empty(); c.addClass('mc-root');
    this.bar = c.createDiv({ cls: 'mc-bar' });
    this.found = c.createDiv({ cls: 'mc-found' });
    this.gridEl = c.createDiv({ cls: 'mc-cal' });
    this.buildBar();
    this.unsub = this.plugin.store.on(() => this.refresh());
    this.refresh();
  }
  async onClose() { this.unsub && this.unsub(); }
  go(dm) { const d = new Date(this.year, this.month + dm, 1); this.year = d.getFullYear(); this.month = d.getMonth(); this.refresh(); }
  buildBar() {
    const b = this.bar;
    const nav = b.createDiv({ cls: 'mc-nav' });
    nav.createEl('button', { text: '‹', attr: { 'aria-label': 'Previous month' } }).onclick = () => this.go(-1);
    nav.createEl('button', { text: 'Today' }).onclick = () => { const n = new Date(); this.year = n.getFullYear(); this.month = n.getMonth(); this.refresh(); };
    nav.createEl('button', { text: '›', attr: { 'aria-label': 'Next month' } }).onclick = () => this.go(1);
    this.monthSel = nav.createEl('select'); MONTHS.forEach((m, i) => this.monthSel.createEl('option', { text: m, value: String(i) }));
    this.monthSel.onchange = () => { this.month = +this.monthSel.value; this.refresh(); };
    this.yearIn = nav.createEl('input', { type: 'number', cls: 'mc-year' });
    this.yearIn.onchange = () => { const y = parseInt(this.yearIn.value); if (y > 1800 && y < 3000) { this.year = y; this.refresh(); } };
    this.summary = b.createDiv({ cls: 'mc-summary mc-grow' });
    this.search = b.createEl('input', { type: 'search', cls: 'mc-find', attr: { placeholder: 'Search logged…' } });
    this.search.oninput = () => this.renderFound();
    const sz = b.createEl('input', { type: 'range', cls: 'mc-size', attr: { min: '24', max: '120', step: '2', title: 'Cover size' } });
    sz.value = String(this.plugin.settings.coverWidth);
    sz.oninput = () => { this.plugin.settings.coverWidth = +sz.value; this.refresh(); };
    sz.onchange = () => this.plugin.saveData(this.plugin.settings);
    const fs = b.createEl('select', { cls: 'mc-filter' }); ['All', ...TYPES].forEach(t => fs.createEl('option', { text: t === 'All' ? 'All types' : t, value: t }));
    fs.onchange = () => { this.filter = fs.value; this.refresh(); };
    b.createEl('button', { text: '+ Quick add', cls: 'mod-cta' }).onclick = () => new AddModal(this.app, this.plugin, fmt(new Date())).open();
  }
  refresh() {
    this.monthSel.value = String(this.month); this.yearIn.value = this.year;
    this.renderGrid(); this.renderSummary(); this.renderFound();
  }
  renderSummary() {
    const pre = `${this.year}-${pad(this.month + 1)}-`;
    const list = this.plugin.store.entries.filter(e => e.date.startsWith(pre) && (this.filter === 'All' || e.type === this.filter));
    const by = {}; list.forEach(e => { by[e.type] = (by[e.type] || 0) + 1; });
    const parts = Object.entries(by).map(([k, v]) => `${v} ${pluralType(k, v)}`).join(' · ');
    this.summary.setText(`${MONTHS[this.month]}: ${list.length} item${list.length === 1 ? '' : 's'}${parts ? ' — ' + parts : ''}`);
  }
  renderFound() {
    const q = this.search.value.trim().toLowerCase(); this.found.empty();
    if (!q) { this.found.hide(); return; }
    this.found.show();
    const hits = this.plugin.store.entries.filter(e => e.title.toLowerCase().includes(q) || (e.info || '').toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 24);
    if (!hits.length) { this.found.createDiv({ cls: 'mc-empty', text: 'No logged entries match.' }); return; }
    hits.forEach(e => {
      const r = this.found.createDiv({ cls: 'mc-hit' });
      coverEl(r, e, 'mc-mini');
      r.createSpan({ text: e.title, cls: 'mc-hit-title' }); r.createSpan({ text: `${e.type} · ${e.date}`, cls: 'mc-card-meta' });
      r.onclick = () => { const [y, m] = e.date.split('-').map(Number); this.year = y; this.month = m - 1; this.refresh(); new DetailsModal(this.app, this.plugin, e).open(); };
    });
  }
  clearDrop() { this.contentEl.querySelectorAll('.mc-drop-before, .mc-drop-after').forEach(x => x.classList.remove('mc-drop-before', 'mc-drop-after')); }
  async reorderStack(ds, items, srcId, targetId, after) {
    const src = items.find(x => x.id === srcId); if (!src) return;
    const rest = items.filter(x => x.id !== srcId), at = rest.findIndex(x => x.id === targetId); if (at < 0) return;
    rest.splice(at + (after ? 1 : 0), 0, src); // new order of the entries on screen
    const store = this.plugin.store, full = store.dayList(ds), vis = new Set(items.map(x => x.id));
    let k = 0; // with a type filter on, hidden entries keep their slots; only the visible ones are reordered among theirs
    await store.reorder(ds, full.map(x => (vis.has(x.id) ? rest[k++].id : x.id)));
  }
  renderGrid() {
    const g = this.gridEl; g.empty();
    const cw = this.plugin.settings.coverWidth || 44;
    this.contentEl.style.setProperty('--mc-cover-w', cw + 'px');
    const mon = this.plugin.settings.weekStartsMonday, max = Math.max(1, this.plugin.settings.maxCovers | 0);
    const stacked = this.plugin.settings.stackCovers !== false;
    this.drag = null;
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; if (mon) names.push(names.shift());
    const head = g.createDiv({ cls: 'mc-grid mc-head' }); names.forEach(n => head.createDiv({ text: n }));
    const first = new Date(this.year, this.month, 1);
    const off = (first.getDay() - (mon ? 1 : 0) + 7) % 7;
    const dim = new Date(this.year, this.month + 1, 0).getDate();
    const weeks = Math.ceil((off + dim) / 7);
    const grid = g.createDiv({ cls: 'mc-grid mc-body' }); grid.style.gridTemplateRows = `repeat(${weeks}, minmax(${Math.round(stacked ? cw * 1.5 + 52 : cw * 3 + 34)}px, 1fr))`;
    const map = this.plugin.store.byDate(this.filter), today = fmt(new Date());
    for (let i = 0; i < weeks * 7; i++) {
      const d = new Date(this.year, this.month, 1 - off + i), ds = fmt(d), items = map.get(ds) || [];
      const cell = grid.createDiv({ cls: 'mc-day' + (d.getMonth() !== this.month ? ' other' : '') + (ds === today ? ' today' : '') });
      const h = cell.createDiv({ cls: 'mc-day-h' });
      h.createSpan({ cls: 'mc-num', text: String(d.getDate()) });
      h.createEl('button', { cls: 'mc-plus clickable-icon', text: '+', attr: { 'aria-label': 'Add media' } }).onclick = ev => { ev.stopPropagation(); new AddModal(this.app, this.plugin, ds).open(); };
      const covers = cell.createDiv({ cls: 'mc-covers' + (stacked ? ' mc-stacked' : '') });
      let shown, hidden;
      if (stacked) { // a deck: the first card is in front, the rest peek out behind it
        shown = items.slice(0, max); hidden = items.length - shown.length;
        covers.style.setProperty('--mc-gaps', String(Math.max(shown.length - 1, 1)));
      } else { const over = items.length > max; shown = over ? items.slice(0, max - 1) : items; hidden = items.length - shown.length; }
      shown.forEach((e, idx) => {
        const host = stacked ? covers.createDiv({ cls: 'mc-slot' }) : covers; // the slot stays put while its card lifts, so hovering doesn't flicker
        const el = coverEl(host, e), hit = stacked ? host : el;
        if (stacked) host.style.zIndex = String(shown.length - idx);
        hit.setAttr('title', `${e.title} (${e.type})`);
        hit.onclick = ev => { ev.stopPropagation(); new DetailsModal(this.app, this.plugin, e).open(); };
        hit.addEventListener('contextmenu', ev => entryMenu(this.plugin, ev, e));
        hit.draggable = true;
        hit.addEventListener('dragstart', ev => { this.drag = { id: e.id, date: e.date }; hit.addClass('dragging'); ev.dataTransfer.setData('text/mc-id', e.id); ev.dataTransfer.effectAllowed = 'copyMove'; });
        hit.addEventListener('dragend', () => { this.drag = null; hit.removeClass('dragging'); this.clearDrop(); });
        // Dropping on a card of the same day reorders; anything else bubbles up to the day cell (copy to that day).
        const sameDay = () => this.drag && this.drag.date === e.date && this.drag.id !== e.id;
        const isAfter = ev => { const r = hit.getBoundingClientRect(); return ev.clientX > r.left + r.width / 2; };
        hit.addEventListener('dragover', ev => {
          if (!sameDay()) return;
          ev.preventDefault(); ev.stopPropagation(); ev.dataTransfer.dropEffect = 'move';
          this.clearDrop(); hit.addClass(isAfter(ev) ? 'mc-drop-after' : 'mc-drop-before');
        });
        hit.addEventListener('drop', async ev => {
          if (!sameDay()) return;
          ev.preventDefault(); ev.stopPropagation();
          const id = this.drag.id, after = isAfter(ev); this.clearDrop(); this.drag = null;
          await this.reorderStack(ds, items, id, e.id, after);
        });
      });
      if (hidden > 0) covers.createDiv({ cls: 'mc-more', text: `+${hidden}` });
      cell.onclick = () => new DayModal(this.app, this.plugin, ds, this.filter).open();
      cell.addEventListener('dragover', ev => { if (this.drag && this.drag.date === ds) return; if (ev.dataTransfer.types.includes('text/mc-id')) { ev.preventDefault(); ev.dataTransfer.dropEffect = this.plugin.settings.dragAction === 'move' ? 'move' : 'copy'; cell.addClass('drop'); } });
      cell.addEventListener('dragleave', () => cell.removeClass('drop'));
      cell.addEventListener('drop', async ev => {
        ev.preventDefault(); cell.removeClass('drop');
        const src = this.plugin.store.entries.find(x => x.id === ev.dataTransfer.getData('text/mc-id'));
        if (!src) return;
        if (src.date === ds) return; // same day: drop onto another card to reorder
        if (this.plugin.settings.dragAction === 'move') { // setting: dragging onto another day moves the entry
          if (await this.plugin.store.update(src.id, { date: ds })) new Notice(`Moved “${src.title}” to ${ds}`);
        } else if (await this.plugin.store.add({ ...src, date: ds })) new Notice(`Duplicated “${src.title}” to ${ds}`);
      });
    }
  }
}

/* ───────────── settings + plugin ───────────── */

class SettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const c = this.containerEl; c.empty();
    const p = this.plugin, save = () => p.saveData(p.settings);
    new Setting(c).setName('Data file').setDesc('Vault path of the JSON database. It is a normal vault file, so it syncs with your vault and stays when you uninstall the plugin. Changing it loads (or creates) that file; the old one is left untouched.')
      .addText(t => { // applied on blur/Enter, not per keystroke, so partial paths never create stray files
        t.setPlaceholder(DEFAULTS.dataPath).setValue(p.settings.dataPath);
        t.inputEl.addEventListener('change', async () => { p.settings.dataPath = t.getValue().trim() || DEFAULTS.dataPath; await save(); p.store.load(); });
      });
    new Setting(c).setName('TMDB API key or read token').setDesc('Required for movie and TV search. Free at themoviedb.org/settings/api. Stored in this plugin’s data.json, not in the media file.')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(p.settings.tmdbKey).onChange(async v => { p.settings.tmdbKey = v.trim(); await save(); }); });
    new Setting(c).setName('IGDB Client ID (games, portrait covers)').setDesc('Preferred game source. Free: create an app at dev.twitch.tv/console (needs 2FA on your Twitch account), then paste its Client ID and Client Secret.')
      .addText(t => t.setValue(p.settings.igdbClientId).onChange(async v => { p.settings.igdbClientId = v.trim(); await save(); }));
    new Setting(c).setName('IGDB Client Secret')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(p.settings.igdbClientSecret).onChange(async v => { p.settings.igdbClientSecret = v.trim(); await save(); }); });
    new Setting(c).setName('RAWG API key (fallback)').setDesc('Only used if IGDB isn’t set. RAWG has landscape images only. Free at rawg.io/apidocs.')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(p.settings.rawgKey).onChange(async v => { p.settings.rawgKey = v.trim(); await save(); }); });
    new Setting(c).setName('Google Books API key (optional)').setDesc('Fixes “rate limited” errors for books and comics. Free: console.cloud.google.com → enable “Books API” → create an API key.')
      .addText(t => { t.inputEl.type = 'password'; t.setValue(p.settings.googleKey).onChange(async v => { p.settings.googleKey = v.trim(); await save(); }); });
    new Setting(c).setName('Week starts on Monday').addToggle(t => t.setValue(p.settings.weekStartsMonday).onChange(async v => { p.settings.weekStartsMonday = v; await save(); p.store.emit(); }));
    new Setting(c).setName('Cover size').setDesc('Width of each cover in the calendar, in pixels (also adjustable from the calendar toolbar).')
      .addSlider(s => s.setLimits(24, 120, 2).setValue(p.settings.coverWidth).setDynamicTooltip().onChange(async v => { p.settings.coverWidth = v; await save(); p.store.emit(); }));
    new Setting(c).setName('Stack covers like a deck').setDesc('Overlap each day’s covers like a deck of cards: hover to lift one, drag a card onto another to reorder. Turn off for a plain grid.')
      .addToggle(t => t.setValue(p.settings.stackCovers !== false).onChange(async v => { p.settings.stackCovers = v; await save(); p.store.emit(); }));
    new Setting(c).setName('Dragging a cover to another day').setDesc('Choose what happens when you drag an entry onto a different day. (Dragging onto a card on the same day always reorders.)')
      .addDropdown(d => d.addOption('copy', 'Duplicate it').addOption('move', 'Move it').setValue(p.settings.dragAction === 'move' ? 'move' : 'copy')
        .onChange(async v => { p.settings.dragAction = v === 'move' ? 'move' : 'copy'; await save(); }));
    new Setting(c).setName('Add/edit window width').setDesc('Width in pixels. You can also drag the window’s bottom-right corner.')
      .addSlider(s => s.setLimits(600, 1400, 20).setValue(p.settings.modalWidth).setDynamicTooltip().onChange(async v => { p.settings.modalWidth = v; await save(); }));
    new Setting(c).setName('Window blur').setDesc('Blur behind the add/edit windows, in pixels. 0 turns it off. Takes effect the next time a window opens.')
      .addSlider(s => s.setLimits(0, 30, 1).setValue(p.settings.modalBlur).setDynamicTooltip().onChange(async v => { p.settings.modalBlur = v; GLASS_BLUR = v; await save(); }));
    new Setting(c).setName('Covers shown per day').setDesc('Extra entries collapse into a “+N” tile.')
      .addSlider(s => s.setLimits(2, 12, 1).setValue(p.settings.maxCovers).setDynamicTooltip().onChange(async v => { p.settings.maxCovers = v; await save(); p.store.emit(); }));
    new Setting(c).setName('Support').setDesc('Optional. If this plugin is useful to you, you can buy me a coffee. Nothing is locked behind it.')
      .addButton(b => b.setButtonText('Buy me a coffee').onClick(() => { window.open(SUPPORT_URL, '_blank'); }));
  }
}

module.exports = class MediaCalendarPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    GLASS_BLUR = Number.isFinite(+this.settings.modalBlur) ? +this.settings.modalBlur : DEFAULTS.modalBlur;
    this.store = new Store(this);
    this.registerView(VIEW_TYPE, leaf => new CalView(leaf, this));
    this.addRibbonIcon('calendar-days', 'Open Media Calendar', () => this.openView());
    this.addCommand({ id: 'open', name: 'Open calendar', callback: () => this.openView() });
    this.addCommand({ id: 'quick-add', name: 'Quick add media for today', callback: () => new AddModal(this.app, this, fmt(new Date())).open() });
    this.addCommand({ id: 'reload', name: 'Reload data from file', callback: () => this.store.load() });
    this.addSettingTab(new SettingsTab(this.app, this));
    this.registerEvent(this.app.vault.on('modify', f => { if (f.path === this.store.path && !this.store.selfWrite) this.store.load(); }));
    this.app.workspace.onLayoutReady(() => this.store.load());
  }
  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
    this.app.workspace.revealLeaf(leaf);
  }
};

/* nosourcemap */