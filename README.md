# Witte Football Stats

Weekly NFL leaders for the phone. Pick a season and week, then see the top 30
at each position with full stat lines:

| Tab | Sorted by |
| --- | --- |
| QB | Passing yards |
| RB | Rushing yards |
| WR | Receiving yards |
| TE | Receiving yards |

Tap a player to compare their regular-season totals for the selected season
against the previous season. Counting stats also show a per-game rate, and the
green/red coloring compares per-game rates so a season in progress isn't
measured against a full one.

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
- `site.web.api.espn.com/apis/common/v3/.../athletes/ID/stats` — season totals for the player sheet
