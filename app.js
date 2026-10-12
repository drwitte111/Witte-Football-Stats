'use strict';

// ESPN public JSON endpoints (no key needed, CORS-enabled).
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

const TOP_N = 30;
const FIRST_SEASON = 2004;
const CACHE_VERSION = 1;
const STALE_MS = 15 * 60 * 1000; // auto-refetch unfinished weeks after 15 min

const POSTSEASON_WEEKS = [
  [1, 'Wild Card'],
  [2, 'Divisional'],
  [3, 'Conference'],
  [5, 'Super Bowl'],
];

const SORT_BY = {
  QB: { key: 'passYds', label: 'PASS YDS' },
  RB: { key: 'rushYds', label: 'RUSH YDS' },
  WR: { key: 'recYds', label: 'REC YDS' },
  TE: { key: 'recYds', label: 'REC YDS' },
};

const state = {
  season: null,
  type: 2,
  week: 1,
  pos: 'QB',
  players: [],
  loading: false,
};

const $ = (id) => document.getElementById(id);
const els = {
  season: $('season'),
  week: $('week'),
  refresh: $('refresh'),
  tabs: $('tabs'),
  status: $('status'),
  list: $('list'),
};

// ---------- storage helpers ----------

function store(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { pruneCache(); }
}
function load(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function pruneCache() {
  // Drop cached weeks if storage fills up; positions are kept.
  try {
    Object.keys(localStorage).filter((k) => k.startsWith('wk:')).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}

// ---------- network ----------

async function getJSON(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Run async fn over items with limited concurrency.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------- boxscore parsing ----------

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// Older responses only carry labels; map them to the modern keys.
const LABEL_KEYS = {
  passing: { 'C/ATT': 'completions/passingAttempts', YDS: 'passingYards', AVG: 'yardsPerPassAttempt', TD: 'passingTouchdowns', INT: 'interceptions', SACKS: 'sacks-sackYardsLost', QBR: 'adjQBR', RTG: 'QBRating' },
  rushing: { CAR: 'rushingAttempts', YDS: 'rushingYards', AVG: 'yardsPerRushAttempt', TD: 'rushingTouchdowns', LONG: 'longRushing' },
  receiving: { REC: 'receptions', YDS: 'receivingYards', AVG: 'yardsPerReception', TD: 'receivingTouchdowns', LONG: 'longReception', TGTS: 'receivingTargets' },
  fumbles: { FUM: 'fumbles', LOST: 'fumblesLost', REC: 'fumblesRecovered' },
};

function statMap(category, stats) {
  const keys = category.keys && category.keys.length
    ? category.keys
    : (category.labels || []).map((l) => (LABEL_KEYS[category.name] || {})[l] || l);
  const m = {};
  keys.forEach((k, i) => { m[k] = stats[i]; });
  return m;
}

function blankPlayer(a, team) {
  return {
    id: String(a.id),
    name: a.displayName || a.shortName || 'Unknown',
    short: a.shortName || a.displayName || '',
    headshot: (a.headshot && a.headshot.href) || '',
    jersey: a.jersey || '',
    pos: (a.position && a.position.abbreviation) || '',
    team: team.abbreviation || '',
    teamId: String(team.id || ''),
    teamLogo: team.logo || '',
    game: '',
    cmp: 0, att: 0, passYds: 0, passTD: 0, int: 0, sacks: 0, rtg: null, qbr: null,
    car: 0, rushYds: 0, rushTD: 0, rushLong: 0,
    rec: 0, tgt: 0, recYds: 0, recTD: 0, recLong: 0,
    fum: 0, fumLost: 0,
  };
}

function applyCategory(p, cat, s) {
  if (cat === 'passing') {
    const [c, a] = String(s['completions/passingAttempts'] || '0/0').split('/');
    p.cmp += num(c); p.att += num(a);
    p.passYds += num(s.passingYards);
    p.passTD += num(s.passingTouchdowns);
    p.int += num(s.interceptions);
    p.sacks += num(String(s['sacks-sackYardsLost'] || '0').split('-')[0]);
    if (s.QBRating != null && s.QBRating !== '--') p.rtg = num(s.QBRating);
    if (s.adjQBR != null && s.adjQBR !== '--') p.qbr = num(s.adjQBR);
  } else if (cat === 'rushing') {
    p.car += num(s.rushingAttempts);
    p.rushYds += num(s.rushingYards);
    p.rushTD += num(s.rushingTouchdowns);
    p.rushLong = Math.max(p.rushLong, num(s.longRushing));
  } else if (cat === 'receiving') {
    p.rec += num(s.receptions);
    p.tgt += num(s.receivingTargets);
    p.recYds += num(s.receivingYards);
    p.recTD += num(s.receivingTouchdowns);
    p.recLong = Math.max(p.recLong, num(s.longReception));
  } else if (cat === 'fumbles') {
    p.fum += num(s.fumbles);
    p.fumLost += num(s.fumblesLost);
  }
}

// Short game context per team, e.g. "vs MIA · W 31-10" or "@ KC · Q3 5:12".
function gameContexts(event) {
  const comp = (event.competitions || [])[0] || {};
  const teams = comp.competitors || [];
  const status = (comp.status || event.status || {}).type || {};
  const ctx = {};
  teams.forEach((t) => {
    const opp = teams.find((o) => o !== t);
    if (!opp) return;
    const mine = num(t.score), theirs = num(opp.score);
    const where = t.homeAway === 'home' ? 'vs' : '@';
    let result;
    if (status.completed) {
      result = `${mine > theirs ? 'W' : mine < theirs ? 'L' : 'T'} ${mine}-${theirs}`;
    } else {
      result = `${mine}-${theirs} ${status.shortDetail || ''}`.trim();
    }
    ctx[String(t.team.id)] = `${where} ${opp.team.abbreviation} · ${result}`;
  });
  return { ctx, final: !!status.completed, started: status.state !== 'pre' };
}

function parseSummary(summary, players, ctx) {
  const box = summary.boxscore || {};
  (box.players || []).forEach((teamBlock) => {
    const team = teamBlock.team || {};
    (teamBlock.statistics || []).forEach((category) => {
      if (!LABEL_KEYS[category.name]) return;
      (category.athletes || []).forEach((row) => {
        const a = row.athlete;
        if (!a || a.id == null) return;
        const id = String(a.id);
        if (!players[id]) players[id] = blankPlayer(a, team);
        const p = players[id];
        p.game = ctx[String(team.id)] || p.game;
        applyCategory(p, category.name, statMap(category, row.stats || []));
      });
    });
  });
  // Some summaries ship rosters with positions; use them when present.
  (summary.rosters || []).forEach((r) => {
    (r.roster || []).forEach((entry) => {
      const a = entry.athlete || {};
      const pos = (entry.position && entry.position.abbreviation) || (a.position && a.position.abbreviation);
      if (a.id != null && pos) rememberPos(String(a.id), pos);
    });
  });
}

// ---------- positions ----------

let positions = load('positions') || {};

function rememberPos(id, pos) {
  positions[id] = pos;
}
function savePositions() {
  store('positions', positions);
}

function normPos(pos) {
  pos = String(pos || '').toUpperCase();
  if (pos === 'QB') return 'QB';
  if (pos === 'RB' || pos === 'HB' || pos === 'FB') return 'RB';
  if (pos === 'WR') return 'WR';
  if (pos === 'TE') return 'TE';
  return pos ? 'OTHER' : '';
}

// Guess when ESPN gives us nothing.
function guessPos(p) {
  if (p.att >= 5) return 'QB';
  if (p.car > p.rec) return 'RB';
  return 'WR';
}

async function resolvePositions(season, list) {
  // 1) Team rosters for every team that played (one call per team).
  const teamIds = [...new Set(list.map((p) => p.teamId).filter(Boolean))];
  const needTeams = teamIds.filter((tid) => list.some((p) => p.teamId === tid && !positions[p.id] && !p.pos));
  await pool(needTeams, 8, async (tid) => {
    const data = await getJSON(`${SITE}/teams/${tid}/roster?season=${season}`);
    (data.athletes || []).forEach((group) => {
      (group.items || []).forEach((a) => {
        if (a.id != null && a.position && a.position.abbreviation) rememberPos(String(a.id), a.position.abbreviation);
      });
    });
  });

  // 2) Per-athlete lookup for anyone still unknown (traded/released players).
  const missing = list.filter((p) => !p.pos && !positions[p.id]);
  await pool(missing, 8, async (p) => {
    let a;
    try { a = await getJSON(`${CORE}/seasons/${season}/athletes/${p.id}?lang=en`); } catch (e) {
      a = await getJSON(`${CORE}/athletes/${p.id}?lang=en`);
    }
    if (a && a.position && a.position.abbreviation) rememberPos(p.id, a.position.abbreviation);
  });

  savePositions();
  list.forEach((p) => {
    p.pos = normPos(p.pos || positions[p.id]) || guessPos(p);
  });
}

// ---------- week loading ----------

function weekKey(season, type, week) {
  return `wk:${CACHE_VERSION}:${season}:${type}:${week}`;
}

async function fetchWeek(season, type, week, onProgress) {
  const sb = await getJSON(`${SITE}/scoreboard?dates=${season}&seasontype=${type}&week=${week}&limit=100`);
  const events = sb.events || [];
  const players = {};
  let allFinal = events.length > 0;
  let done = 0;

  const started = events.map((ev) => ({ ev, ...gameContexts(ev) })).filter((g) => {
    if (!g.final) allFinal = false;
    return g.started;
  });

  onProgress(0, started.length);
  await pool(started, 6, async (g) => {
    const summary = await getJSON(`${SITE}/summary?event=${g.ev.id}`);
    parseSummary(summary, players, g.ctx);
    onProgress(++done, started.length);
  });

  const list = Object.values(players);
  if (list.length) {
    onProgress(-1, 0);
    await resolvePositions(season, list);
  }
  return { players: list, final: allFinal, games: events.length, played: started.length, fetchedAt: Date.now() };
}

async function showWeek(force = false) {
  const { season, type, week } = state;
  const key = weekKey(season, type, week);
  const cached = load(key);

  if (cached && !force) {
    state.players = cached.players;
    render();
    setStatus(cached);
    const stale = !cached.final && Date.now() - cached.fetchedAt > STALE_MS;
    if (!stale) return;
  }

  if (state.loading) return;
  state.loading = true;
  els.refresh.classList.add('spinning');
  if (!cached) { state.players = []; render(); }

  try {
    const data = await fetchWeek(season, type, week, (n, total) => {
      if (n === -1) els.status.textContent = 'Looking up positions…';
      else els.status.textContent = `Loading games ${n}/${total}…`;
    });
    // User may have switched weeks while we were loading.
    if (state.season === season && state.type === type && state.week === week) {
      state.players = data.players;
      render();
      setStatus(data);
    }
    if (data.played > 0) store(key, data);
  } catch (err) {
    els.status.innerHTML = `<span class="err">Couldn't reach ESPN (${escapeHtml(err.message)}). Tap Refresh to retry.</span>`;
  } finally {
    state.loading = false;
    els.refresh.classList.remove('spinning');
  }
}

function setStatus(data) {
  const when = new Date(data.fetchedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  let msg;
  if (!data.games) msg = 'No games found for this week.';
  else if (!data.played) msg = 'No games have started yet.';
  else msg = `${data.played}/${data.games} games${data.final ? ' · final' : ''} · updated ${when}`;
  els.status.textContent = msg;
}

// ---------- rendering ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fantasyPPR(p) {
  return p.passYds / 25 + p.passTD * 4 - p.int * 2
    + p.rushYds / 10 + p.rushTD * 6
    + p.rec + p.recYds / 10 + p.recTD * 6
    - p.fumLost * 2;
}

function statLines(p) {
  const lines = [];
  const pass = () => p.att > 0 && lines.push(['PASS', `${p.cmp}/${p.att}, ${p.passYds} yds, ${p.passTD} TD, ${p.int} INT${p.sacks ? `, ${p.sacks} sk` : ''}${p.rtg != null ? `, ${p.rtg.toFixed(1)} rtg` : ''}`]);
  const rush = () => p.car > 0 && lines.push(['RUSH', `${p.car} car, ${p.rushYds} yds, ${(p.rushYds / p.car).toFixed(1)} avg, ${p.rushTD} TD, ${p.rushLong} lng`]);
  const rec = () => (p.rec > 0 || p.tgt > 0) && lines.push(['REC', `${p.rec}/${p.tgt || p.rec} tgt, ${p.recYds} yds, ${p.rec ? (p.recYds / p.rec).toFixed(1) : '0.0'} avg, ${p.recTD} TD, ${p.recLong} lng`]);
  if (p.pos === 'QB') { pass(); rush(); rec(); }
  else if (p.pos === 'RB') { rush(); rec(); pass(); }
  else { rec(); rush(); pass(); }
  if (p.fumLost > 0) lines.push(['FUM', `${p.fumLost} lost`]);
  return lines;
}

function render() {
  const sort = SORT_BY[state.pos];
  const rows = state.players
    .filter((p) => p.pos === state.pos)
    .sort((a, b) => b[sort.key] - a[sort.key] || fantasyPPR(b) - fantasyPPR(a))
    .slice(0, TOP_N);

  if (!rows.length) {
    els.list.innerHTML = state.loading || !state.players.length ? '' : '<p class="empty">No stats yet.</p>';
    return;
  }

  els.list.innerHTML = rows.map((p, i) => `
    <button type="button" class="card" data-id="${escapeHtml(p.id)}">
      <div class="rank">${i + 1}</div>
      <div class="pic">
        ${p.headshot ? `<img src="${escapeHtml(p.headshot)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        ${p.teamLogo ? `<img class="logo" src="${escapeHtml(p.teamLogo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      </div>
      <div class="info">
        <div class="name">${escapeHtml(p.name)}</div>
        <div class="meta">${escapeHtml(p.team)} ${escapeHtml(p.game)}</div>
        ${statLines(p).map(([k, v]) => `<div class="line"><b>${k}</b> ${escapeHtml(v)}</div>`).join('')}
      </div>
      <div class="big">
        <div class="yds">${p[sort.key]}</div>
        <div class="lbl">${sort.label}</div>
        <div class="fp">${fantasyPPR(p).toFixed(1)} <small>PPR</small></div>
      </div>
    </button>`).join('');
}

// ---------- player detail: season vs previous season ----------

const DETAIL_CATS = {
  passing: { title: 'Passing', want: ['GP', 'CMP', 'ATT', 'CMP%', 'YDS', 'AVG', 'TD', 'INT', 'SACK', 'RTG'] },
  rushing: { title: 'Rushing', want: ['GP', 'CAR', 'YDS', 'AVG', 'TD', 'LNG', 'FUM', 'LST'] },
  receiving: { title: 'Receiving', want: ['GP', 'REC', 'TGTS', 'YDS', 'AVG', 'TD', 'LNG', 'FUM', 'LST'] },
};

// Returns { passing: { 2025: {LABEL: value}, ... }, ... } of regular-season totals.
async function fetchCareer(id) {
  const cacheKey = `career:${id}`;
  const cached = load(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 6 * 3600 * 1000) return cached.data;

  const data = await getJSON(`${WEB}/athletes/${id}/stats?region=us&lang=en&contentorigin=espn`);
  const out = {};
  (data.categories || []).forEach((cat) => {
    if (!DETAIL_CATS[cat.name]) return;
    const labels = cat.labels || [];
    const bySeason = {};
    (cat.statistics || []).forEach((row) => {
      const year = row.season && (row.season.year || parseInt(row.season.displayName, 10));
      if (!year) return;
      const vals = {};
      labels.forEach((l, i) => { vals[l] = row.stats[i]; });
      // A traded player has one row per team; sum the counting stats.
      bySeason[year] = bySeason[year] ? mergeSeason(bySeason[year], vals) : vals;
    });
    out[cat.name] = bySeason;
  });
  store(cacheKey, { fetchedAt: Date.now(), data: out });
  return out;
}

function mergeSeason(a, b) {
  const m = { ...a };
  Object.keys(b).forEach((k) => {
    if (['AVG', 'CMP%', 'RTG', 'QBR', 'Y/A'].includes(k)) m[k] = '—'; // rates can't be summed
    else if (k === 'LNG') m[k] = String(Math.max(num(a[k]), num(b[k])));
    else m[k] = String(num(a[k]) + num(b[k]));
  });
  return m;
}

// Rate stats are compared as-is; counting stats are compared per game so a
// season in progress isn't measured against a full one.
const RATE_STATS = new Set(['GP', 'CMP%', 'AVG', 'RTG', 'QBR', 'LNG', 'Y/A']);
const LOWER_IS_BETTER = new Set(['INT', 'SACK', 'FUM', 'LST']);

function compareTable(cat, cur, prev, season) {
  const spec = DETAIL_CATS[cat];
  const a = cur || {}, b = prev || {};
  const labels = spec.want.filter((l) => l in a || l in b);
  if (!labels.length) return '';
  const gpA = num(a.GP), gpB = num(b.GP);
  const cell = (v, gp, l) => {
    if (v == null) return '—';
    if (RATE_STATS.has(l) || !gp || v === '—') return escapeHtml(v);
    return `${escapeHtml(v)}<small>${(num(v) / gp).toFixed(1)}/g</small>`;
  };
  const body = labels.map((l) => {
    const x = a[l], y = b[l];
    let cls = '';
    if (x != null && y != null && l !== 'GP' && x !== '—' && y !== '—') {
      const perGame = !RATE_STATS.has(l) && gpA && gpB;
      const vx = perGame ? num(x) / gpA : num(x);
      const vy = perGame ? num(y) / gpB : num(y);
      if (Math.abs(vx - vy) > 1e-9) {
        const better = LOWER_IS_BETTER.has(l) ? vx < vy : vx > vy;
        cls = better ? 'up' : 'down';
      }
    }
    return `<tr><th>${l}</th><td class="${cls}">${cell(x, gpA, l)}</td><td>${cell(y, gpB, l)}</td></tr>`;
  }).join('');
  return `
    <h3>${spec.title}</h3>
    <table class="cmp">
      <thead><tr><th></th><th>${season}</th><th>${season - 1}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

async function openPlayer(id) {
  const p = state.players.find((x) => x.id === id);
  if (!p) return;
  const season = state.season;

  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        ${p.headshot ? `<img src="${escapeHtml(p.headshot)}" alt="" onerror="this.remove()">` : ''}
        <div>
          <div class="name">${escapeHtml(p.name)}</div>
          <div class="meta">${escapeHtml(p.pos)} · ${escapeHtml(p.team)}${p.jersey ? ` #${escapeHtml(p.jersey)}` : ''}</div>
        </div>
        <button type="button" class="close" aria-label="Close">✕</button>
      </div>
      <p class="sub">Regular season totals, ${season} vs ${season - 1}. Colors compare per-game rates: green = better than last year.</p>
      <div class="sheet-body"><p class="empty">Loading…</p></div>
    </div>`;
  document.body.appendChild(sheet);
  document.body.classList.add('noscroll');
  requestAnimationFrame(() => sheet.classList.add('open'));

  const close = () => {
    sheet.classList.remove('open');
    document.body.classList.remove('noscroll');
    setTimeout(() => sheet.remove(), 250);
  };
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.closest('.close')) close();
  });

  const body = sheet.querySelector('.sheet-body');
  try {
    const career = await fetchCareer(id);
    const order = p.pos === 'QB' ? ['passing', 'rushing', 'receiving']
      : p.pos === 'RB' ? ['rushing', 'receiving', 'passing']
        : ['receiving', 'rushing', 'passing'];
    const html = order
      .map((cat) => career[cat] && compareTable(cat, career[cat][season], career[cat][season - 1], season))
      .filter(Boolean)
      .join('');
    body.innerHTML = html || `<p class="empty">No season stats on ESPN for ${season} or ${season - 1}.</p>`;
  } catch (err) {
    body.innerHTML = `<p class="empty err">Couldn't load season stats (${escapeHtml(err.message)}).</p>`;
  }
}

// ---------- pickers ----------

function fillSeasons(current) {
  els.season.innerHTML = '';
  for (let y = current; y >= FIRST_SEASON; y--) {
    els.season.add(new Option(String(y), String(y)));
  }
}

function fillWeeks(season) {
  const regWeeks = season >= 2021 ? 18 : 17;
  els.week.innerHTML = '';
  const reg = document.createElement('optgroup');
  reg.label = 'Regular Season';
  for (let w = 1; w <= regWeeks; w++) reg.appendChild(new Option(`Week ${w}`, `2-${w}`));
  const post = document.createElement('optgroup');
  post.label = 'Playoffs';
  POSTSEASON_WEEKS.forEach(([w, name]) => post.appendChild(new Option(name, `3-${w}`)));
  els.week.append(reg, post);
}

function syncPickers() {
  els.season.value = String(state.season);
  fillWeeks(state.season);
  els.week.value = `${state.type}-${state.week}`;
  if (!els.week.value) { state.type = 2; state.week = 1; els.week.value = '2-1'; }
}

function savePrefs() {
  store('prefs', { season: state.season, type: state.type, week: state.week, pos: state.pos });
}

async function detectCurrent() {
  // ESPN's default scoreboard reports the live season and week.
  try {
    const sb = await getJSON(`${SITE}/scoreboard`, 8000);
    const year = sb.season && sb.season.year;
    const type = sb.season && sb.season.type;
    const week = sb.week && sb.week.number;
    if (year) {
      if (type === 2 || type === 3) return { season: year, type, week: week || 1 };
      if (type === 4) return { season: year, type: 3, week: 5 }; // offseason: show Super Bowl
      return { season: year, type: 2, week: 1 }; // preseason
    }
  } catch (e) { /* fall through */ }
  const now = new Date();
  const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return { season: y, type: 2, week: 1 };
}

function setTab(pos) {
  state.pos = pos;
  els.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.pos === pos));
}

async function init() {
  const current = await detectCurrent();
  fillSeasons(Math.max(current.season, new Date().getFullYear() - (new Date().getMonth() >= 8 ? 0 : 1)));

  const prefs = load('prefs');
  // Open on the live week; remember the last tab only.
  Object.assign(state, current);
  if (prefs && SORT_BY[prefs.pos]) setTab(prefs.pos);
  syncPickers();

  els.season.addEventListener('change', () => {
    state.season = parseInt(els.season.value, 10);
    const keep = `${state.type}-${state.week}`;
    fillWeeks(state.season);
    els.week.value = keep;
    if (!els.week.value) { state.type = 2; state.week = 1; els.week.value = '2-1'; }
    savePrefs();
    showWeek();
  });
  els.week.addEventListener('change', () => {
    const [t, w] = els.week.value.split('-').map(Number);
    state.type = t; state.week = w;
    savePrefs();
    showWeek();
  });
  els.tabs.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pos]');
    if (!b) return;
    setTab(b.dataset.pos);
    savePrefs();
    render();
    window.scrollTo({ top: 0 });
  });
  els.list.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) openPlayer(card.dataset.id);
  });
  els.refresh.addEventListener('click', () => showWeek(true));

  showWeek();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('list')) {
  init();
}
