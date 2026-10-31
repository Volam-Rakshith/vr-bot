# How VR Bot works

© VR DEVELOPMENTS

```
 Your phone                          GitHub (free)
 ──────────                          ─────────────────────────────────────────────
 Panel (PWA) ── GitHub API ──► main branch: data/*.json   (encrypted settings, contacts, schedules…)
   ▲   token + password              │
   │                                 ▼
   │                      Actions "VR Bot — Run"  (always on: each run starts the next)
   │                        1. checkout main, npm ci
   │                        2. pull vr-state branch → decrypt session + sent-log
   │                        3. connect to WhatsApp (Baileys, linked device)
   │                        4. read messages that arrived while offline → replies/commands
   │                        5. plan sends due in the next 45 min → sleep → send at hh:mm:00
   │                           (re-reads data/ every 4 min, so pause/edit works mid-wait)
   │                        6. stay connected ~75–85 min (always on); hand over at a quiet moment,
   │                           or early if Run now / Test / Pair is waiting
   │                        7. save step (always): encrypt + force-push vr-state
   │                        8. chain step (always): start the next run unless one is already waiting
   │                      Actions "VR Bot — Watchdog" (cron 7,27,47): start a run if none is alive
   ├──── reads (encrypted) ◄── vr-state branch: status, sentlog, logs, memory, session
   └──── voice clips (encrypted) ◄─► vr-voice branch: voice/<id>.meta.json + voice/<id>.audio.json
                                    (panel writes via the GitHub API, the bot via `!voice save`)
   └──── notes (encrypted) ◄─► vr-notes branch: notes/<id>.json, one file per note
                                    (panel writes via the GitHub API, the bot via `!note`; append-only commits, never force-pushed)
```

## Exact timing

- **Planner** (`panel/shared/planner.js`) turns schedules, birthdays, festivals, follow-ups and the daily summary into concrete sends `{ key, at, to, text }` for a time window. It is pure, so the panel shows the same "Next sends" the bot will do.
- **Dedupe key**: `kind:sourceId:YYYY-MM-DDTHH:MM:recipient`. The sent-log stores every key with its result. A key is never sent twice; failures retry up to 3 times, then are marked failed and you get a WhatsApp alert.
- **Late runs**: the window is `[now − 180 min, now + look-ahead)`, so a run that starts late still sends what was missed (marked late).
- **Human-like delay** uses a seeded random from the key, so every run computes the same send time — no doubles, no skips.
- **Precision**: when a run is alive, sends go out within a few seconds of the minute. With Always on, a run is alive all the time (`src/chain.js`): runs hand over to each other via `workflow_dispatch` (allowed with `GITHUB_TOKEN`), the shared concurrency group keeps one connection and at most one waiting run, and a hand-over never happens when a send is due within 6 minutes. If the chain breaks (GitHub outage, crash early in a run), the Watchdog restarts it when GitHub's timer next fires, and the 3-hour catch-up sends what was missed.

## Why the session lives on a branch

| Option | Problem |
|---|---|
| Actions cache | Evicted after 7 days unused, keys are immutable, scoped per branch |
| Artifacts | Expire (max 90 days), awkward to download between runs |
| Commit to main | Repo grows by MBs a day, conflicts with panel edits |
| **Orphan commit on `vr-state`** ✅ | Never expires, atomic push, one commit (old ones are garbage-collected), panel can read it, `session.prev.json` kept for rollback |

Baileys rotates keys while connected, so the session is saved after **every** run (a separate `if: always()` step, so even a crash or timeout saves it) and every 10 minutes during long waits.

## Encryption

`panel/shared/crypto.js` — WebCrypto AES-256-GCM, PBKDF2-SHA256 200,000 rounds, random 12-byte IV per file, one random salt per writer session. The same file runs in the browser and in Node, so both sides are guaranteed compatible. `data/lock.json` holds an encrypted check value so a wrong password is detected before anything is written.

## Files

```
.github/workflows/  bot.yml (run) · pair.yml · pages.yml · test.yml
src/                index (CLI) · runner (one run) · incoming (replies/commands) · wa (Baileys)
                    state (vr-state branch) · gitstate (git plumbing) · data · pair · lock
src/features/       ai (Groq chat + Whisper) · commands · groups · alerts · media · summary
panel/              index.html · app.js · styles.css · sw.js · manifest · icons · demo.js
panel/shared/       time · scheduler · planner · templates · rules · crypto · festivals · defaults
data/               example JSON (fake, "example": true — never sent)
test/               unit tests + end-to-end dry run with a fake WhatsApp and a local git remote
```
