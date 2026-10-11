# Tarkov Tracker

A self-hosted quest, hideout and prestige tracker for Escape from Tarkov. It runs in Docker on the same PC as the game.

## Features

- **Quests**: shows active, available, locked, completed and failed quests. You can filter and group them by trader, map or requirement type (kills, FIR items, non-FIR items, equipment/gear, quest items, place/mark, visit, extract, skill/level). You can also sort by level, trader, map, name or progress. Every objective can be checked off, and counted objectives (kills, hand-ins) have a counter. Item objectives say whether the item must be **found in raid (FIR)**. Use the Kappa and Lightkeeper filters to show only quests needed for those.
- **Hideout**: shows each station with its next level, or all levels. Requirements cover items (with FIR flag and a counter), trader loyalty, skills and other stations. Other-station requirements tick automatically once you mark that level built.
- **Prestige**: lists the prestige requirements. Level and quest conditions are tracked automatically and the rest have checkboxes. You can add your own requirements as checklist items.
- **Needed items**: a combined shopping list of everything your unfinished quests, hideout levels and prestige still need, split into FIR and non-FIR.
- **Search**: search by quest name or item name. An item search shows every current or future quest, hideout level or prestige requirement that needs that item, including gear you have to wear or use.
- **Automatic quest detection**: reads the game's own log files to find quests you start, fail or complete.

## Where the data comes from

Quest, hideout and prestige definitions are stored inside the game's binary asset bundles, so they can't be read from local files. The tracker downloads them from [tarkov.dev](https://tarkov.dev)'s public JSON data feed (`json.tarkov.dev`, the same feed the tarkov.dev website uses) on first start, falling back to the tarkov.dev GraphQL API if the feed is unavailable, and caches them in `data/gamedata.json`. After that it works offline. By default it refreshes the cache every 24 hours. You can also refresh it or import a data file from **Settings**.

Your progress is stored only on your PC, in `data/progress.json`.

The game writes trader messages to `Logs/*/...notifications...log`, including quest started, failed and completed events. The tracker reads that folder read-only and applies the events. If you change a quest's status by hand after a logged event, your manual change wins. The game never clears its Logs folder, so only events after the current wipe's start date count (default: 2025-11-15, the 1.0 wipe; change it under **Settings** after a new wipe). Completing a quest also marks its prerequisites as completed.

## Running it

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Copy `.env.example` to `.env` and set `EFT_LOGS_PATH` to your game's `Logs` folder. The default launcher install is `C:/Battlestate Games/EFT/Logs`. Check where yours is installed; Steam installs live under `steamapps/common/`.
3. Start it:
   ```
   docker compose up -d --build
   ```
4. Open http://localhost:3000. Set your PMC level, faction and game mode (PvP/PvE) under **Settings**.

On first run, use **Start + complete prereqs** on your current quests. This marks every earlier quest in the chain as done in one click. The log reader also backfills whatever history is still in the Logs folder.

Stop with `docker compose down`. Your progress stays in `./data`.

### Without Docker

Requires Node 18 or newer. There are no dependencies to install.
```
EFT_LOGS_DIR="C:/Battlestate Games/EFT/Logs" npm start
```

## Troubleshooting

**"No game data yet" / tarkov.dev errors.** The container downloads game data itself. If tarkov.dev rejects those requests (for example HTTP 422), the page in your browser downloads the data directly from tarkov.dev and hands it to the tracker. The **Refresh** button in Settings does the same. If both fail, the error message shows tarkov.dev's full response. `docker compose logs tarkov-tracker` shows the server's side.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EFT_LOGS_PATH` | – | Host path of the game's Logs folder (compose only) |
| `GAME_MODE` | `regular` | `regular` (PvP) or `pve`. Can also be changed in Settings |
| `WIPE_START` | `2025-11-15` | Default wipe start date; quest events in older game logs are ignored |
| `REFRESH_HOURS` | `24` | Re-download game data when the cache is older than this. `0` disables refreshing |
| `TRACKER_PORT` | `3000` | Port on localhost |
| `TARKOV_JSON_URL` | `https://json.tarkov.dev/` | JSON data feed override |
| `TARKOV_API_URL` | `https://api.tarkov.dev/graphql` | GraphQL fallback override |

## Development

```
npm test                      # log parser tests
DATA_DIR=./data EFT_LOGS_DIR=test/fixtures/logs npm start
```
Copy `test/fixtures/gamedata.json` to `data/` to work offline with a small sample dataset.
