'use strict';

// ESPN public JSON endpoints (no key needed, CORS-enabled).
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';

const TOP_N = 30;
const FIRST_SEASON = 2004;
const CACHE_VERSION = 2;
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

// Week data lives in IndexedDB: a full season is too big for localStorage.
const idb = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('wfs', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbp;
  }
  function run(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    }));
  }
  return {
    get: (k) => run('readonly', (st) => st.get(k)).catch(() => load(k)),
    set: (k, v) => run('readwrite', (st) => st.put(v, k)).catch(() => store(k, v)),
  };
})();

// Drop week caches from the old localStorage layout.
try {
  Object.keys(localStorage).filter((k) => k.startsWith('wk:')).forEach((k) => localStorage.removeItem(k));
} catch (e) { /* ignore */ }

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

async function fetchWeek(season, type, week, onProgress = () => {}) {
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
  let sleeper = false;
  if (list.length) {
    onProgress(-1, 0);
    await resolvePositions(season, list);
    onProgress(-2, 0);
    sleeper = await attachSleeperStats(season, type, week, list);
  }
  return { players: list, final: allFinal, games: events.length, played: started.length, sleeper, fetchedAt: Date.now() };
}

// Cached week if fresh enough, else a fresh pull from ESPN + Sleeper.
async function getWeek(season, type, week, force, onProgress) {
  const key = weekKey(season, type, week);
  const cached = await idb.get(key);
  if (cached && !force) {
    const stale = !cached.final && Date.now() - cached.fetchedAt > STALE_MS;
    if (!stale) return cached;
  }
  const data = await fetchWeek(season, type, week, onProgress);
  if (data.played > 0) await idb.set(key, data);
  return data;
}

function sameView(v) {
  return state.season === v.season && state.type === v.type && state.week === v.week;
}

async function showWeek(force = false) {
  if (state.week === 'all') return showSeason(force);
  const view = { season: state.season, type: state.type, week: state.week };
  const key = weekKey(view.season, view.type, view.week);
  const cached = await idb.get(key);

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
    const data = await getWeek(view.season, view.type, view.week, true, (n, total) => {
      if (!sameView(view)) return;
      els.status.textContent = n === -1 ? 'Looking up positions…'
        : n === -2 ? 'Getting Sleeper stats…'
          : `Loading games ${n}/${total}…`;
    });
    // User may have switched weeks while we were loading.
    if (sameView(view)) {
      state.players = data.players;
      render();
      setStatus(data);
    }
  } catch (err) {
    if (sameView(view)) els.status.innerHTML = `<span class="err">Couldn't reach ESPN (${escapeHtml(err.message)}). Tap Refresh to retry.</span>`;
  } finally {
    state.loading = false;
    els.refresh.classList.remove('spinning');
  }
}

// ---------- full season ----------

function regularWeeks(season) {
  return season >= 2021 ? 18 : 17;
}

const SUM_FIELDS = ['cmp', 'att', 'passYds', 'passTD', 'int', 'sacks', 'car', 'rushYds', 'rushTD',
  'rec', 'tgt', 'recYds', 'recTD', 'fum', 'fumLost'];

// Season totals: counting stats summed, points summed week by week so
// per-game bonuses (100-yard games etc.) are scored the way Sleeper does.
function aggregateSeason(weeks) {
  const out = {};
  weeks.forEach((wk) => {
    (wk.players || []).forEach((p) => {
      let t = out[p.id];
      if (!t) {
        t = out[p.id] = { ...p, game: '', gp: 0, pts: 0, rtg: null, qbr: null, sl: null, weekly: [] };
        SUM_FIELDS.forEach((f) => { t[f] = 0; });
      }
      SUM_FIELDS.forEach((f) => { t[f] += p[f] || 0; });
      t.rushLong = Math.max(t.rushLong, p.rushLong || 0);
      t.recLong = Math.max(t.recLong, p.recLong || 0);
      t.team = p.team; t.teamLogo = p.teamLogo || t.teamLogo; t.headshot = p.headshot || t.headshot;
      t.gp += 1;
      t.weekly.push(p);
    });
  });
  return Object.values(out).map((t) => {
    t.game = `· ${t.gp} GP`;
    return t;
  });
}

async function showSeason(force = false) {
  const view = { season: state.season, type: state.type, week: 'all' };
  if (state.loading) return;
  state.loading = true;
  els.refresh.classList.add('spinning');
  state.players = []; render();

  const total = regularWeeks(view.season);
  const weeks = [];
  let failed = 0, done = 0, sleeperWeeks = 0, latest = 0;
  try {
    await pool(Array.from({ length: total }, (_, i) => i + 1), 2, async (w) => {
      try {
        // A forced refresh only re-pulls weeks that weren't final yet.
        let data = await idb.get(weekKey(view.season, 2, w));
        if (!data || (!data.final && (force || Date.now() - data.fetchedAt > STALE_MS))) {
          data = await getWeek(view.season, 2, w, true);
        }
        if (data.played > 0) {
          data.players.forEach((pl) => { pl.week = w; });
          weeks.push(data);
          if (data.sleeper) sleeperWeeks++;
          latest = Math.max(latest, data.fetchedAt);
        }
      } catch (e) { failed++; }
      done++;
      if (sameView(view)) els.status.textContent = `Loading season… week ${done}/${total}`;
    });
    if (sameView(view)) {
      state.players = aggregateSeason(weeks);
      render();
      const when = latest ? new Date(latest).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      let msg = `${view.season} regular season · ${weeks.length} week${weeks.length === 1 ? '' : 's'}`;
      msg += sleeperWeeks === weeks.length && weeks.length ? ' · Sleeper points' : sleeperWeeks ? ` · Sleeper points ${sleeperWeeks}/${weeks.length} wks` : ' · box-score points';
      if (when) msg += ` · updated ${when}`;
      els.status.textContent = msg;
      if (failed) els.status.innerHTML += ` <span class="err">· ${failed} week(s) failed, tap Refresh</span>`;
    }
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
  else msg = `${data.played}/${data.games} games${data.final ? ' · final' : ''} · ${data.sleeper ? 'Sleeper points' : 'box-score points'} · updated ${when}`;
  els.status.textContent = msg;
}

// ---------- rendering ----------

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- fantasy scoring (Sleeper league settings) ----------

const SLEEPER = 'https://api.sleeper.app/v1';
const LEAGUE_NAME = 'the league';

// Used until a Sleeper league is linked.
const DEFAULT_SCORING = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2,
  rush_yd: 0.1, rush_td: 6,
  rec: 1, rec_yd: 0.1, rec_td: 6,
  fum_lost: -2,
};

// Sleeper scoring keys we can compute from an ESPN box score.
const SCORING_STATS = {
  pass_yd: (p) => p.passYds,
  pass_td: (p) => p.passTD,
  pass_int: (p) => p.int,
  pass_cmp: (p) => p.cmp,
  pass_att: (p) => p.att,
  pass_inc: (p) => p.att - p.cmp,
  pass_sack: (p) => p.sacks,
  rush_yd: (p) => p.rushYds,
  rush_td: (p) => p.rushTD,
  rush_att: (p) => p.car,
  rec: (p) => p.rec,
  rec_yd: (p) => p.recYds,
  rec_td: (p) => p.recTD,
  rec_tgt: (p) => p.tgt,
  fum: (p) => p.fum,
  fum_lost: (p) => p.fumLost,
  bonus_rec_te: (p) => (p.pos === 'TE' ? p.rec : 0),
  bonus_rec_rb: (p) => (p.pos === 'RB' ? p.rec : 0),
  bonus_rec_wr: (p) => (p.pos === 'WR' ? p.rec : 0),
  bonus_pass_yd_300: (p) => (p.passYds >= 300 ? 1 : 0),
  bonus_pass_yd_400: (p) => (p.passYds >= 400 ? 1 : 0),
  bonus_rush_yd_100: (p) => (p.rushYds >= 100 ? 1 : 0),
  bonus_rush_yd_200: (p) => (p.rushYds >= 200 ? 1 : 0),
  bonus_rec_yd_100: (p) => (p.recYds >= 100 ? 1 : 0),
  bonus_rec_yd_200: (p) => (p.recYds >= 200 ? 1 : 0),
  bonus_rush_rec_yd_100: (p) => (p.rushYds + p.recYds >= 100 ? 1 : 0),
  bonus_rush_rec_yd_200: (p) => (p.rushYds + p.recYds >= 200 ? 1 : 0),
  bonus_pass_cmp_25: (p) => (p.cmp >= 25 ? 1 : 0),
  bonus_rush_att_20: (p) => (p.car >= 20 ? 1 : 0),
  bonus_rec_rec_10: (p) => (p.rec >= 10 ? 1 : 0),
};

// Offensive-player keys a box score can't answer (2-pt tries, first downs,
// play lengths, return TDs...). Defense/kicker keys are ignored entirely.
const OFFENSE_PREFIXES = ['pass_', 'rush_', 'rec', 'bonus_pass', 'bonus_rush', 'bonus_rec', 'fum'];
function unsupportedKeys(scoring) {
  return Object.keys(scoring).filter((k) => scoring[k] && !SCORING_STATS[k]
    && OFFENSE_PREFIXES.some((pre) => k.startsWith(pre)) && k !== 'fum_rec' && k !== 'fum_ret_yd');
}

// ---------- Sleeper weekly stats ----------
// Sleeper's per-player weekly stats use the same keys as its scoring
// settings (40+ yd plays, first downs, 2-pt...), so points match Sleeper.

const PLAYER_MAP_TTL = 7 * 24 * 3600 * 1000;
const SKILL_POS = new Set(['QB', 'RB', 'FB', 'WR', 'TE']);

function nameKey(name) {
  return String(name || '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z]/g, '');
}

let playerMapPromise = null;

// ESPN id -> Sleeper id (plus a name fallback), from Sleeper's player list.
function sleeperPlayerMap() {
  if (!playerMapPromise) {
    playerMapPromise = (async () => {
      const cached = await idb.get('sleeperMap');
      if (cached && Date.now() - cached.fetchedAt < PLAYER_MAP_TTL) return cached;
      try {
        const all = await getJSON(`${SLEEPER}/players/nfl`, 60000);
        const byEspn = {}, byName = {};
        Object.values(all || {}).forEach((pl) => {
          if (!pl || !pl.player_id) return;
          const pos = pl.position || (pl.fantasy_positions || [])[0];
          if (!SKILL_POS.has(pos)) return;
          if (pl.espn_id) byEspn[String(pl.espn_id)] = String(pl.player_id);
          const nk = nameKey(pl.full_name || `${pl.first_name} ${pl.last_name}`);
          if (nk) byName[`${nk}|${normPos(pos)}`] = byName[`${nk}|${normPos(pos)}`] === undefined ? String(pl.player_id) : null;
        });
        const map = { byEspn, byName, fetchedAt: Date.now() };
        await idb.set('sleeperMap', map);
        return map;
      } catch (e) {
        if (cached) return cached;
        playerMapPromise = null;
        throw e;
      }
    })();
  }
  return playerMapPromise;
}

async function fetchSleeperWeek(season, type, week) {
  const url = type === 3
    ? `${SLEEPER}/stats/nfl/post/${season}/${week === 5 ? 4 : week}` // ESPN skips Pro Bowl week
    : `${SLEEPER}/stats/nfl/regular/${season}/${week}`;
  const data = await getJSON(url, 30000);
  const out = {};
  if (Array.isArray(data)) {
    data.forEach((row) => { if (row && row.player_id) out[String(row.player_id)] = row.stats || row; });
  } else if (data && typeof data === 'object') {
    Object.entries(data).forEach(([id, st]) => { out[id] = st; });
  }
  return out;
}

// Attach Sleeper's stat object as p.sl. Returns true if Sleeper data was used.
async function attachSleeperStats(season, type, week, list) {
  try {
    const [map, stats] = await Promise.all([sleeperPlayerMap(), fetchSleeperWeek(season, type, week)]);
    if (!Object.keys(stats).length) return false;
    let hits = 0;
    list.forEach((p) => {
      if (!SORT_BY[p.pos]) return;
      const sid = map.byEspn[p.id] || map.byName[`${nameKey(p.name)}|${p.pos}`];
      const st = sid && stats[sid];
      if (!st) return;
      const keep = {};
      Object.keys(st).forEach((k) => {
        const v = st[k];
        if (typeof v === 'number' && v !== 0 && !k.startsWith('pts_') && !k.startsWith('rank_') && !k.startsWith('pos_rank')) keep[k] = v;
      });
      p.sl = keep;
      hits++;
    });
    return hits > 0;
  } catch (e) {
    return false;
  }
}

let league = load('league'); // { username, leagueId, name, season, scoring, fetchedAt }

function scoring() {
  return (league && league.scoring) || DEFAULT_SCORING;
}

// Points per scoring key: { key: { count, pts } }. Season rows carry their
// weekly lines; each week is scored on its own, then summed.
function pointsBreakdown(p) {
  const out = {};
  if (p.weekly) {
    p.weekly.forEach((w) => {
      Object.entries(pointsBreakdown(w)).forEach(([k, v]) => {
        const o = out[k] || (out[k] = { count: 0, pts: 0 });
        o.count += v.count; o.pts += v.pts;
      });
    });
    return out;
  }
  const sc = scoring();
  for (const k in sc) {
    const w = sc[k];
    if (!w) continue;
    const fn = SCORING_STATS[k];
    let v = 0;
    if (p.sl) {
      // Sleeper omits zeros; fill in game bonuses it may not list from the box score.
      if (k in p.sl) v = p.sl[k];
      else if (fn && k.startsWith('bonus_')) v = fn(p);
    } else if (fn) {
      v = fn(p);
    }
    if (v) out[k] = { count: v, pts: v * w };
  }
  return out;
}

function fantasyPoints(p) {
  const pts = Object.values(pointsBreakdown(p)).reduce((sum, v) => sum + v.pts, 0);
  return Math.round(pts * 100) / 100;
}

function scoringLabel() {
  return league ? 'PTS' : 'PPR';
}

async function sleeperLeagues(username) {
  const user = await getJSON(`${SLEEPER}/user/${encodeURIComponent(username.trim())}`);
  if (!user || !user.user_id) throw new Error(`No Sleeper user "${username}"`);
  const st = await getJSON(`${SLEEPER}/state/nfl`).catch(() => ({}));
  let season = parseInt(st.league_season || st.season, 10) || new Date().getFullYear();
  let leagues = await getJSON(`${SLEEPER}/user/${user.user_id}/leagues/nfl/${season}`);
  if (!leagues || !leagues.length) {
    season -= 1;
    leagues = await getJSON(`${SLEEPER}/user/${user.user_id}/leagues/nfl/${season}`);
  }
  return { season, leagues: leagues || [] };
}

function linkLeague(username, lg, season) {
  league = {
    username: username.trim(),
    leagueId: lg.league_id,
    name: lg.name,
    season,
    scoring: lg.scoring_settings || {},
    fetchedAt: Date.now(),
  };
  store('league', league);
}

// Re-pull the linked league's scoring in case the commish changed it.
async function refreshLeague() {
  if (!league || !league.leagueId) return;
  try {
    const lg = await getJSON(`${SLEEPER}/league/${league.leagueId}`);
    if (lg && lg.scoring_settings) linkLeague(league.username, lg, league.season);
  } catch (e) { /* keep cached scoring */ }
}

function openSettings() {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-wrap';
  const unsupported = league ? unsupportedKeys(league.scoring) : [];
  const used = Object.entries(scoring()).filter(([k, v]) => v && SCORING_STATS[k]);
  sheet.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-head">
        <div>
          <div class="name">Fantasy scoring</div>
          <div class="meta">${league ? `Sleeper · ${escapeHtml(league.name)} (${league.season})` : 'Standard PPR until a Sleeper league is linked'}</div>
        </div>
        <button type="button" class="close" aria-label="Close">✕</button>
      </div>
      <form class="link-form">
        <label class="picker"><span>Sleeper username</span>
          <input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
            value="${escapeHtml(league ? league.username : '')}" placeholder="your Sleeper username">
        </label>
        <button type="submit" class="refresh">Find leagues</button>
      </form>
      <div class="league-list"></div>
      <h3>Scoring in use</h3>
      <table class="cmp scoring">${used.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${v > 0 ? '+' : ''}${v}</td></tr>`).join('')}</table>
      <p class="sub">Points use Sleeper's own weekly stats, so they should match Sleeper.${unsupported.length ? ` If Sleeper's stats can't be loaded, the app falls back to ESPN box scores, which can't count: ${unsupported.map(escapeHtml).join(', ')}.` : ''}</p>
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

  const listEl = sheet.querySelector('.league-list');
  sheet.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    if (!username.trim()) return;
    listEl.innerHTML = '<p class="sub">Looking up leagues…</p>';
    try {
      const { season, leagues } = await sleeperLeagues(username);
      if (!leagues.length) { listEl.innerHTML = `<p class="sub err">No NFL leagues for ${season}.</p>`; return; }
      const pick = (lg) => {
        linkLeague(username, lg, season);
        close();
        render();
        openSettings();
      };
      const match = leagues.find((lg) => String(lg.name).trim().toLowerCase() === LEAGUE_NAME);
      if (match) { pick(match); return; }
      listEl.innerHTML = `<p class="sub">No league named "The League" — pick one:</p>` + leagues.map((lg, i) =>
        `<button type="button" class="league" data-i="${i}">${escapeHtml(lg.name)}</button>`).join('');
      listEl.querySelectorAll('.league').forEach((b) => b.addEventListener('click', () => pick(leagues[b.dataset.i])));
    } catch (err) {
      listEl.innerHTML = `<p class="sub err">Couldn't reach Sleeper (${escapeHtml(err.message)}).</p>`;
    }
  });
}

function render() {
  const yards = SORT_BY[state.pos];
  const rows = state.players
    .filter((p) => p.pos === state.pos)
    .map((p) => ({ p, pts: fantasyPoints(p) }))
    .sort((a, b) => b.pts - a.pts || b.p[yards.key] - a.p[yards.key])
    .slice(0, TOP_N);

  if (!rows.length) {
    els.list.innerHTML = state.loading || !state.players.length ? '' : '<p class="empty">No stats yet.</p>';
    return;
  }

  els.list.innerHTML = rows.map(({ p, pts }, i) => `
    <button type="button" class="card" data-id="${escapeHtml(p.id)}">
      <div class="rank">${i + 1}</div>
      <div class="pic">
        ${p.headshot ? `<img src="${escapeHtml(p.headshot)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      </div>
      <div class="name">${escapeHtml(p.name)}</div>
      <div class="pts">${pts.toFixed(1)}</div>
    </button>`).join('');
}

// ---------- player detail: full stat line ----------

const STAT_LABELS = {
  pass_yd: 'Pass yds', pass_td: 'Pass TD', pass_int: 'INT', pass_cmp: 'Completions', pass_att: 'Pass att',
  pass_inc: 'Incompletions', pass_sack: 'Sacks', pass_2pt: 'Pass 2-pt', pass_fd: 'Pass 1st downs',
  rush_yd: 'Rush yds', rush_td: 'Rush TD', rush_att: 'Carries', rush_2pt: 'Rush 2-pt', rush_fd: 'Rush 1st downs',
  rec: 'Receptions', rec_yd: 'Rec yds', rec_td: 'Rec TD', rec_tgt: 'Targets', rec_2pt: 'Rec 2-pt', rec_fd: 'Rec 1st downs',
  rec_40p: '40+ yd catches', rush_40p: '40+ yd runs', pass_cmp_40p: '40+ yd completions',
  bonus_rec_te: 'TE catch bonus', bonus_rec_rb: 'RB catch bonus', bonus_rec_wr: 'WR catch bonus',
  bonus_rec_yd_100: '100-yd rec game', bonus_rush_yd_100: '100-yd rush game', bonus_pass_yd_300: '300-yd pass game',
  bonus_pass_yd_400: '400-yd pass game', fum_lost: 'Fumbles lost', fum: 'Fumbles',
};

function statTable(title, rows) {
  const shown = rows.filter(([, v]) => v != null);
  if (!shown.length) return '';
  return `<h3>${title}</h3><table class="cmp stat">${shown.map(([k, v]) =>
    `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table>`;
}

function statSections(p) {
  const avg = (a, b) => (b ? (a / b).toFixed(1) : '0.0');
  const pass = () => p.att > 0 && statTable('Passing', [
    ['Comp / Att', `${p.cmp} / ${p.att}`], ['Yards', p.passYds], ['TD', p.passTD], ['INT', p.int],
    ['Yds / Att', avg(p.passYds, p.att)], ['Sacks', p.sacks], ['Rating', p.rtg != null ? p.rtg.toFixed(1) : null],
  ]);
  const rush = () => p.car > 0 && statTable('Rushing', [
    ['Carries', p.car], ['Yards', p.rushYds], ['Avg', avg(p.rushYds, p.car)], ['TD', p.rushTD], ['Long', p.rushLong],
  ]);
  const rec = () => (p.rec > 0 || p.tgt > 0) && statTable('Receiving', [
    ['Rec / Tgt', `${p.rec} / ${p.tgt || p.rec}`], ['Yards', p.recYds], ['Avg', avg(p.recYds, p.rec)], ['TD', p.recTD], ['Long', p.recLong],
  ]);
  const order = p.pos === 'QB' ? [pass, rush, rec] : p.pos === 'RB' ? [rush, rec, pass] : [rec, rush, pass];
  const parts = order.map((f) => f()).filter(Boolean);
  if (p.fum > 0) parts.push(statTable('Fumbles', [['Fumbles', p.fum], ['Lost', p.fumLost]]));
  return parts.join('');
}

function breakdownTable(p) {
  const rows = Object.entries(pointsBreakdown(p))
    .filter(([, v]) => Math.abs(v.pts) > 0.001)
    .sort((a, b) => Math.abs(b[1].pts) - Math.abs(a[1].pts));
  if (!rows.length) return '';
  return `<h3>Points</h3><table class="cmp stat">${rows.map(([k, v]) =>
    `<tr><th>${escapeHtml(STAT_LABELS[k] || k)} <small>× ${+v.count.toFixed(2)}</small></th><td>${v.pts > 0 ? '+' : ''}${v.pts.toFixed(2)}</td></tr>`).join('')}</table>`;
}

function weeklyTable(p) {
  const weeks = [...p.weekly].sort((a, b) => (a.week || 0) - (b.week || 0));
  return `<h3>By week</h3><table class="cmp stat">${weeks.map((w) =>
    `<tr><th>Wk ${w.week || '?'} <small>${escapeHtml(w.game)}</small></th><td>${fantasyPoints(w).toFixed(1)}</td></tr>`).join('')}</table>`;
}

function openPlayer(id) {
  const p = state.players.find((x) => x.id === id);
  if (!p) return;
  const pts = fantasyPoints(p);
  const season = !!p.weekly;
  const sub = season
    ? `${state.season} regular season · ${p.gp} GP · ${(pts / p.gp).toFixed(1)} pts/g`
    : `${state.type === 3 ? els.week.selectedOptions[0].textContent : `Week ${state.week}`} ${state.season} · ${p.game}`;

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
      <div class="sheet-score">
        <div><span class="pts-big">${pts.toFixed(1)}</span> <small>${scoringLabel()}</small></div>
        <div class="sub">${escapeHtml(sub)}</div>
      </div>
      ${statSections(p)}
      ${breakdownTable(p)}
      ${season ? weeklyTable(p) : ''}
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
}

// ---------- pickers ----------

function fillSeasons(current) {
  els.season.innerHTML = '';
  for (let y = current; y >= FIRST_SEASON; y--) {
    els.season.add(new Option(String(y), String(y)));
  }
}

function fillWeeks(season) {
  const regWeeks = regularWeeks(season);
  els.week.innerHTML = '';
  els.week.appendChild(new Option('Full Season', '2-all'));
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
    const [t, w] = els.week.value.split('-');
    state.type = Number(t);
    state.week = w === 'all' ? 'all' : Number(w);
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
  els.refresh.addEventListener('click', () => { refreshLeague().then(render); showWeek(true); });
  $('settings').addEventListener('click', openSettings);
  if (!league) openSettings();

  showWeek();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && document.getElementById('list')) {
  init();
}
