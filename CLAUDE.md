# Notes for Claude

## Plugin recommendations

The owner asked to be reminded about useful plugins at the right moment.

- Before suggesting one, call ListPlugins and skip any that are already enabled.
- Suggest a plugin only when the current task clearly matches its trigger below, and at most once per session. Use the plugin suggestion card (SearchPlugins, then SuggestPluginInstall).
- Don't nag: if the owner ignores or declines a suggestion, drop it for that session.

Project: Tarkov Tracker: self-hosted quest/hideout/prestige tracker (Node.js, Docker).

### Recommended (owner chose to install these)
If one of these isn't enabled yet, suggest it the first time it would help.
- **frontend-design**: UI work on the tracker pages.
- **playwright**: drive the running web UI to check changes.
- **docker-skills**: Dockerfile and Compose changes.

### Later: suggest only when the trigger happens
- **E2E Test Generator**: suggest when the owner wants automated tests for the web UI.
- **Homelab Docker Ops**: suggest if the owner starts running several self-hosted containers together and has trouble with volumes, networking or logs.
- **dataviz** (built in): use for any chart, e.g. progress over time.

### Not tied to this repo
- **Remotion**: suggest if the owner wants to make a video (intros, animated clips, showcase videos for a project).
- **Chrome Extension Builder**: suggest if the owner wants to extend the Brave start page extension or build another browser extension.
