# Witte Football Stats

Weekly NFL leaders for the phone. Pick a season and week, then see the top 30
QBs, RBs, WRs and TEs with full stat lines, ranked by fantasy points.

## Fantasy scoring

Tap the gear, enter your Sleeper username, and the app links the league named
**The League** (or lets you pick one) and scores everyone with that league's
`scoring_settings`. Until a league is linked it uses standard PPR. Refresh also
re-pulls the league's scoring.

Points come from Sleeper's own weekly player stats (40+ yard plays, first
downs, 2-pt conversions and all), so they should match Sleeper. If Sleeper's
stats can't be loaded for a week or a player, the app falls back to scoring the
ESPN box score, which can't see those extras. The status line says which source
a week used.

## Full Season

The first option in the Week picker totals every regular-season week: summed
stat lines, games played, and points scored week by week (so per-game bonuses
count correctly), with points per game. The first load downloads every game of
the season; finished weeks are saved on the phone, so later loads are quick.

The list shows just rank, photo, name and points. Tap a player to see their
full stat line for that week and how each scoring setting added up. In Full
Season, the tap shows season totals, the points breakdown and points by week.

Data comes straight from ESPN's public JSON API in the browser — no server, no
API key. Weeks are cached on the phone; **Refresh** pulls fresh data from ESPN.
Unfinished weeks also refetch on their own once the cache is 15 minutes old.

## Install on iPhone

1. Repo → **Settings → Pages** → Source: **Deploy from a branch**, pick this
   branch, folder `/ (root)`, Save.
2. After a minute, open `https://<user>.github.io/<repo>/` in Safari.
3. Share → **Add to Home Screen**. It opens full-screen like an app.

## Files

- `index.html` — page shell and home-screen meta tags
- `app.js` — ESPN fetching, stat parsing, ranking, player sheet
- `styles.css` — dark, iPhone-first layout
- `manifest.webmanifest`, `icons/` — home-screen app name and icon

## ESPN endpoints used

- `site.api.espn.com/.../nfl/scoreboard?dates=YYYY&seasontype=2|3&week=N` — games in a week
- `site.api.espn.com/.../nfl/summary?event=ID` — box score per game
- `site.api.espn.com/.../nfl/teams/ID/roster` and `sports.core.api.espn.com/.../athletes/ID` — player positions (cached)
- `api.sleeper.app/v1/user/NAME`, `.../user/ID/leagues/nfl/YYYY`, `.../league/ID` — league scoring
- `api.sleeper.app/v1/stats/nfl/regular/YYYY/WEEK` and `.../players/nfl` — weekly stats for points (unofficial endpoint)
- `site.web.api.espn.com/apis/common/v3/.../athletes/ID/stats` — season totals for the player sheet
