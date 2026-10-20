# Tarkov Tracker

A self-hosted quest, hideout and prestige tracker for Escape from Tarkov. It runs in Docker on the same PC as the game.

## Features

- **Quests**: shows active, locked, completed and failed quests (quests you could start but have not are not listed; starts come from the game logs). You can filter and group them by trader, map or requirement type (kills, FIR items, non-FIR items, equipment/gear, quest items, place/mark, visit, extract, skill/level). You can also sort by level, trader, map, name or progress. Every objective can be checked off, and counted objectives (kills, hand-ins) have a counter. Item objectives say whether the item must be **found in raid (FIR)**. Use the Kappa and Lightkeeper filters to show only quests needed for those.
- **Hideout**: shows each station with its next level, or all levels. Requirements cover items (with FIR flag and a counter), trader loyalty, skills and other stations. Other-station requirements tick automatically once you mark that level built.
- **Recipes**: shows hideout crafts you can make with the stations you've built and the quests you've completed, grouped by module. Each recipe lists its ingredients (tools marked; you get them back) and its craft time with your Crafting skill applied. Locked recipes are hidden unless you tick "Show locked", which also shows what unlocks them. Pin up to 4 recipes per module to keep them at the top. The Bitcoin Farm section takes your number of graphics cards (no more than the built level holds: 10, 25 or 50) and shows the time per bitcoin, bitcoins per day and bitcoins per fuel tank (Hideout Management and hideout fuel bonuses included).
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

### UI

The front-end is plain HTML/JS (native ES modules, no build step) styled with
[Basecoat](https://basecoatui.com/) (`basecoat-css`). Its prebuilt CSS and JS are self-hosted in
`public/vendor/basecoat/` (version and checksums in `VERSION` there), so the tracker works fully offline.
To upgrade, bump the exact version of `basecoat-css` in `package.json` (devDependencies) and run
`scripts/vendor-basecoat.sh`.

Dark mode is the default. The moon/sun button in the top bar or Settings → Appearance switches it, and
the choice is kept in the browser. <kbd>Ctrl</kbd>+<kbd>K</kbd> opens a command palette to jump to any
quest, skill, hideout station or action.

Settings → Appearance → **Interface** picks the GUI for this browser (so a second monitor can use a
different one). Three come with the tracker:

- **Basecoat (full)**: every section in tabs.
- **Compact (second monitor)**: an active-quest checklist plus needed items, hideout and settings.
- **Icon GUI**: every section, with quests shown per trader. A row of trader cards shows each
  trader's portrait, loyalty level and restock timer; click one to list its quests.
  - Only traders that give quests get a card. Storyline quests aren't part of tarkov.dev's quest
    list, so they never count.
  - All cards share one row and shrink to fit (11 traders fit at 1920 wide); on narrow screens the
    row scrolls sideways.
  - Loyalty level comes from your quests: the highest loyalty level any active or completed quest
    needs with that trader (LL1 if none). Reputation and money spent are not tracked.
  - Settings → Character → *Manual loyalty levels* lets you set a trader's level by hand instead.
  - Trader portraits are downloaded once into the data folder (`data/images/traders/`), so they work
    offline.
  - Restock times are re-read from tarkov.dev every 10 minutes.
  - Hideout shows a card per module, locked ones included. Each card has its icon, a status (Ready,
    N missing, Locked, Max level), and its level with − / + buttons.
  - Clicking a module lists everything a level needs: other modules, skills, trader loyalty or
    reputation, and items. Reputation requirements are ticked by hand.
  - Items are only listed, with the amount needed. They are not tracked and don't count towards the
    Ready / N missing status, which only looks at modules, skills and traders.
  - Trader loyalty requirements are checked automatically in every GUI, against the loyalty level
    worked out from your quests.
  - Module icons are cached in `data/images/stations/`, like the trader portraits.
  - Skills look like the game's Character → Skills screen: two columns of rows, each with the skill
    icon, a category letter, the name, a level bar and "Level: N" with − / +. Elite skills are marked
    in gold.
  - Clicking a skill shows its description and effects (now, per level, at max) and its elite perks.
    Levels change with − / +, by typing a level, or by reading screenshots.
  - The skills screen follows your light / dark theme. It uses the free Rajdhani font, bundled in
    `public/vendor/fonts/` (the game's own font can't be shipped).
  - Skill icons are cached in `data/images/skills/`.
  - Recipes shows a card per station that crafts (icon, name, level) in two columns. Clicking one
    lists its recipes on the right: ingredients (tools marked), and the craft time with your Crafting
    skill applied next to the base time. Hideout Management doesn't change craft times in the game,
    so it only counts towards fuel use.
  - Pinned recipes (up to 4 per station) stay at the top in the order you pinned them.
  - The Bitcoin Farm card takes the number of graphics cards installed, up to what the built level
    holds (10 / 25 / 50). It shows the time per bitcoin, bitcoins per day, and bitcoins per Metal
    and Expeditionary fuel tank, with Hideout Management and hideout fuel bonuses applied.

If a GUI hides its switcher, open `http://localhost:3000/?gui=basecoat` to get back.

`scripts/ui-check.js` clicks through every tab and both GUIs in Chromium against the sample data in
`test/fixtures/ui` and checks what gets saved (needs Playwright: `NODE_PATH=$(npm root -g) node scripts/ui-check.js`).

### How the front-end is put together

```
public/
  index.html          loader only (core/boot.js picks the GUI for this browser)
  core/               game rules and data, no HTML: store.js (state, server API, saving, sync, events),
                      game.js (quest/hideout/skill rules), progress.js (shared progress changes),
                      gui.js + registry.js (find and load GUIs and modules)
  modules/<id>/       one folder per section: quests, hideout, recipes, prestige, skills, buffs,
                      items, search, settings
    module.json       { "title", "order", "description", "needsData" }
    logic.js          that section's filters, numbers and actions; no HTML. Exports uiDefaults.
    view.js           the default (Basecoat) view
  ui/basecoat/        shared Basecoat pieces: components, objective rows, quest card, the shell
                      (top bar, tabs, palette, toasts, dialogs, event routing) and style.css
  guis/<id>/          one folder per GUI: gui.json, shell.js, optional views and CSS
```

The server lists `public/guis/*` and `public/modules/*` itself (`GET /api/ui`), so adding a folder is
all it takes: nothing else is edited.

#### Making your own GUI

Create `public/guis/<id>/gui.json`:

```json
{
  "title": "Raid overlay",
  "description": "Shown in Settings under the title.",
  "modules": ["quests", "items"],
  "views": { "quests": "views/quests.js" },
  "styles": ["../../vendor/basecoat/basecoat.cdn.min.css", "../../ui/basecoat/style.css", "my.css"],
  "scripts": ["../../vendor/basecoat/basecoat.all.min.js"],
  "entry": "shell.js"
}
```

- `modules`: `"*"` for every section (in `module.json` order) or a list of ids in tab order.
- `views`: replace a section's default view with your own file. Sections not listed use their default view.
- `styles` / `scripts`: loaded in order. Paths are relative to the GUI folder.
- `entry`: a module whose default export receives `{ gui, modules }` and builds the page. Use the shared
  Basecoat shell with your own options: `startShell({ gui, modules, brand, palette, className })` from
  `../../ui/basecoat/shell.js`. Or write your own: render `modules[i].view.render(ctx)` and call
  `core/store.js` `start()`, `on('change', …)`.

Copy `guis/compact/` for a working example with its own quest view and CSS.

#### Writing a view

A view is the default export of a module's `view.js`, or of a file named in a GUI's `views`:

```js
import { S } from '../../core/store.js';
import { filteredTasks, setTaskStatus } from '../../modules/quests/logic.js';
export default {
  render(ctx) { return `<ul>${filteredTasks().map((t) => `<li>${t.name}
    <button data-act="done" data-id="${t.id}">Done</button></li>`).join('')}</ul>`; },
  actions: { done(el) { setTaskStatus(el.dataset.id, 'completed'); } }, // click on data-act
  changes: {},      // change on data-act inputs
  submits: {},      // form data-act submit
  toggle(el) {},    // a <details> opened/closed; return true to save UI state
  goto(args) {},    // another section links here (data-act="goto…" data-module="<id>")
  commands() {},    // command palette entries
  live: false,      // redraw on every 5 s status poll
};
```

`ctx.ui` has `render()`, `toast(category, title, text)`, `confirm(title, text, ok, destructive)`,
`goto(moduleId, args)`, `setTab(id)` and `theme.get()/set()`. Inputs with `data-ui="path"` are bound to the
GUI's saved UI state (e.g. `data-ui="q.trader"`), and inputs with `data-set="key"` save a Settings value.
Progress changes go through the module's `logic.js` (or `core/progress.js`). They save to the server and
redraw every open GUI on its next poll.

#### Adding a section

Create `public/modules/<id>/` with `module.json`, `logic.js` (export `uiDefaults`, even `{}`) and
`view.js`. GUIs with `"modules": "*"` show it as a new tab; others add its id to their list.
