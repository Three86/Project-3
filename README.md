# Tarkov Tracker

A self-hosted quest, hideout and prestige tracker for Escape from Tarkov. It runs in Docker on the same PC as the game.

## Features

- **Quests**: shows active, available, locked, completed and failed quests. You can filter and group them by trader, map or requirement type (kills, FIR items, non-FIR items, equipment/gear, quest items, place/mark, visit, extract, skill/level). You can also sort by level, trader, map, name or progress. Every objective can be checked off, and counted objectives (kills, hand-ins) have a counter. Item objectives say whether the item must be **found in raid (FIR)**. Use the Kappa and Lightkeeper filters to show only quests needed for those.
- **Hideout**: shows each station with its next level, or all levels. Requirements cover items (with FIR flag and a counter), trader loyalty, skills and other stations. Other-station requirements tick automatically once you mark that level built.
- **Prestige**: lists the prestige requirements. Level and quest conditions are tracked automatically and the rest have checkboxes. You can add your own requirements as checklist items.
- **Skills**: enter your level for each skill and see its description, how it levels up, what each level gives and the elite bonus. An overview adds up the buffs on your PMC. Hideout and quest skill requirements tick automatically from these levels. Skill data is bundled in `server/skills.json` and is approximate, because tarkov.dev only publishes skill names. Copy it to `data/skills.json` and edit it to correct values.
- **Read levels from screenshots (OCR)**: press the button on the Skills tab to read skill levels from screenshots of the in-game skills page. In-raid screenshots, which have coordinates in their file name, are skipped. Only the newest day's screenshots are used, and all of that day's screenshots are read. Two OCR engines are bundled in the Docker image. The default is an AI engine: RapidOCR, which runs PaddleOCR models on the CPU, so no graphics card is needed. Tesseract joins in when the AI read looks incomplete. You can choose the engine under **Settings**. Small text is enlarged and read again, and the readings vote on each value. Measure accuracy on your own screenshots with `scripts/ocr-bench.js`.
- **Buffs**: adds up the bonuses of every hideout level you've built (boosted by your Hideout Management level). It also shows what your skills mean in the game: weight limits, food multiplier, fuel duration (including hideout fuel bonuses) and craft times, plus the totals of all skill buffs.
- **Needed items**: a combined shopping list of everything your unfinished quests, hideout levels and prestige still need, split into FIR and non-FIR.
- **Search**: search by quest name or item name. An item search shows every current or future quest, hideout level or prestige requirement that needs that item, including gear you have to wear or use.
- **Automatic quest detection**: reads the game's own log files to find quests you start, fail or complete.

## Where the data comes from

Quest, hideout and prestige definitions are stored inside the game's binary asset bundles, so they can't be read from local files. The tracker downloads them from [tarkov.dev](https://tarkov.dev)'s public JSON data feed (`json.tarkov.dev`, the same feed the tarkov.dev website uses) on first start, falling back to the tarkov.dev GraphQL API if the feed is unavailable, and caches them in `data/gamedata.json`. After that it works offline. By default it refreshes the cache every 24 hours. You can also refresh it or import a data file from **Settings**.

Your progress is stored only on your PC, in `data/progress.json`.

The game writes trader messages to `Logs/*/...notifications...log`, including quest started, failed and completed events. The tracker reads that folder read-only and applies the events. If you change a quest's status by hand after a logged event, your manual change wins. The game never clears its Logs folder, so only events after the **Count game logs from** date and time in **Settings** count (default: the 1.0 wipe, 2025-11-15). After a wipe, profile reset or prestige, press **New start from now…** in Settings. It clears quest and hideout progress, sets your level to 1 and ignores every older log entry, while keeping prestige checklists and settings. Completing a quest also marks its prerequisites as completed.

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

Requires Node 20.9 or newer. Run `npm install` first (sharp, used to enlarge screenshots for OCR). For screenshot reading, install Tesseract and/or the AI engine (`python3 -m venv venv && venv/bin/pip install -r requirements-ocr.txt`, then set `OCR_AI_PYTHON=venv/bin/python`).
```
EFT_LOGS_DIR="C:/Battlestate Games/EFT/Logs" npm start
```

## Troubleshooting

**"No game data yet" / tarkov.dev errors.** The container downloads game data itself. If tarkov.dev rejects those requests (for example HTTP 422), the page in your browser downloads the data directly from tarkov.dev and hands it to the tracker. The **Refresh** button in Settings does the same. If both fail, the error message shows tarkov.dev's full response. `docker compose logs tarkov-tracker` shows the server's side.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `EFT_LOGS_PATH` | – | Host path of the game's Logs folder (compose only) |
| `EFT_SCREENSHOTS_PATH` | – | Host path of the game's Screenshots folder (compose only), for OCR |
| `OCR_AI_PYTHON` | `/opt/ocr-venv/bin/python` (image) | Python with `rapidocr_onnxruntime` for the AI OCR engine |
| `GAME_MODE` | `regular` | `regular` (PvP) or `pve`. Can also be changed in Settings |
| `WIPE_START` | `2025-11-15T09:00:00Z` | Default wipe start date; quest events in older game logs are ignored |
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
