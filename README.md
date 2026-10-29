<p align="center">
  <img src="assets/banner.png" alt="VR Bot by VR DEVELOPMENTS — free WhatsApp automation that runs on GitHub" width="100%">
</p>

<h1 align="center">VR Bot</h1>
<p align="center"><b>by VR DEVELOPMENTS</b> · <i>Turning Ideas Into Innovation</i></p>
<p align="center">Free WhatsApp automation that runs entirely on GitHub — no server, no credit card, no phone left on charge.<br>
GitHub Actions does the work · GitHub Pages hosts your phone control panel.</p>

---

## ✨ What it does

| | Feature | Timing |
|---|---|---|
| 🗓️ | **Scheduled messages** — once, daily, chosen weekdays, monthly, yearly, chosen dates · skip days · skip dates · date ranges | **Exact minute** |
| 🎂 | **Birthday wishes** from your contacts' birthdays, at the time you choose (00:00 = midnight) | **Exact minute** |
| 🪔 | **Festival wishes** — built-in Indian calendar 2026–2027 (Diwali, Sankranti, Ugadi, Holi, Eid, Dussehra, Ganesh Chaturthi, Christmas, New Year, Republic/Independence Day…), per-festival lists & messages | **Exact minute** |
| 👥 | **Group message scheduler** — class reminders, exam dates | **Exact minute** |
| 📣 | **Lists / broadcast** — one message to a tag (family, friends…) with random gaps + daily cap | Starts on the minute, then 8–20 s gaps |
| 📝 | **Templates** — `{name}` `{first_name}` `{date}` `{day}` `{time}` `{festival}` `{age}` `{my_name}` + random `{{Hi\|Hello}}` | — |
| 🧍 | **Human-like delay** — optional ±N minutes per schedule (off by default) | ± your choice |
| 🤖 | **"VR Bot is sending" header** — optional first line, on by default for groups/lists/alerts, off for personal wishes; per schedule & per contact override | — |
| ↩️ | **"No reply" follow-up** after X days for chosen people | Exact minute |
| 📊 | **Daily summary** to you — who messaged, today's sends, failures, tomorrow | Exact minute |
| 🔔 | **Alerts to you** — GitHub stars/forks/issues/PRs + website contact form | Next check (≤ 30 min) |
| ⚡ | **Auto-reply rules** — exact / contains / starts-with / regex, global or per tag, cooldown | ⏱ Next check (≤ 30 min) |
| 🧠 | **AI replies in your style** (Groq free API) — style prompt + example chats + memory | ⏱ Next check |
| 🌙 | **Away mode** — message + optional night window, `!away` / `!back` from WhatsApp | ⏱ Next check |
| 🛡️ | **Group tools** — welcome new members, anti-link (warn / delete / remove if admin), `!tagall`, `!rules` | ⏱ Next check |
| ⌨️ | **Commands** — `!sticker` `!pdf` `!weather` `!help` `!yt` (experimental) | ⏱ Next check |
| 🎤 | **Voice note → text** (Groq Whisper, free) | ⏱ Next check |
| 💾 | **Save incoming media / statuses** (small files, encrypted) | ⏱ Next check |

Every feature has an on/off switch in the panel. Failures are sent to your own WhatsApp.

> **"Exact" vs "next check" — please read.** GitHub Actions is not a server that is always on. The bot wakes up every 30 minutes. For **scheduled** things it wakes up *early*, stays connected and sends **on the exact minute**. **Replies** to messages people send you (auto-reply, AI, away, commands, group tools) happen at the next wake-up — up to ~30 minutes later — unless a run happens to be connected at that moment, then they are instant.

## 📱 The control panel

Your panel lives at `https://<your-username>.github.io/vr-bot/` — install it on your phone like an app.

<p align="center"><img src="assets/screenshots/dashboard.jpg" width="30%" alt="Dashboard"> <img src="assets/screenshots/schedules.jpg" width="30%" alt="Schedules"> <img src="assets/screenshots/schedule-editor.jpg" width="30%" alt="Schedule editor"></p>
<p align="center"><sub>Demo data. Open your panel and tap “Try the demo” to click around before setup.</sub></p>

Dashboard (next sends, last run, failures) · Schedules (create / edit / pause / test / send now) · Contacts (birthdays, tags, paste-import) · Replies (rules, away, AI) · Festivals · Templates · Group tools · Settings · Logs (sent, runs, bot log, saved media).

## 🚀 Setup

**Follow [SETUP.md](SETUP.md)** — 12 numbered steps, about 20 minutes, no coding.

## ⏱️ How exact is "exact"?

- Each run looks **45 minutes ahead**, connects, then **waits and sends at hh:mm:00** (usually within a few seconds).
- Before it finishes, if another message is due soon, it **starts a relay run** that waits for it — so you don't depend on GitHub's timer being on time.
- Every send is recorded in an encrypted **sent-log** (the dedupe ledger), so a message is **never sent twice** and a run that starts late still sends what was missed (up to 3 hours late by default, marked "late" in Logs).
- GitHub's own docs say scheduled runs "can be delayed during periods of high loads" and that "some queued jobs may be dropped". The relay + 45-min look-ahead + catch-up make that rare, but during a GitHub outage a message can be late. You'll see it in Logs and in your daily summary.
- Lists send one by one with 8–20 s gaps (safer for your number), so the 50th person gets it a few minutes after the first.

## 🔐 Privacy & security (your repo is public)

GitHub Pages is free only for **public** repos, and Actions minutes are free and unlimited only for public repos — so the repo is public, and **everything private is encrypted**:

- Contacts, schedules, messages, settings, the WhatsApp session, logs and saved media are encrypted with **AES-256-GCM**, key from your password (`VR_PASSPHRASE`, PBKDF2-SHA256 200k rounds). Without the password they are random bytes.
- The panel encrypts in your browser before saving. Your GitHub token stays in your phone's browser storage only.
- **Actions logs are public**, so the bot never prints phone numbers (only `+91******979`), names or message text. Detailed logs are encrypted and shown only in your panel.
- The example data shipped in `data/` is fake and marked `"example": true` (never sent). Once you save from the panel, those files become encrypted.

## 🗄️ Where things are stored

| What | Where | Why |
|---|---|---|
| Your settings, contacts, schedules… | `data/*.json` on `main` (encrypted) | The panel edits them through the GitHub API |
| WhatsApp session, sent-log, logs, memory | `vr-state` branch (encrypted, one commit, force-pushed each run) | Never expires (Actions cache/artifacts do), atomic, panel can read it, repo doesn't grow. The previous session is kept as `session.prev.json` |
| Saved media | `vr-media` branch (encrypted, ≤ 3 MB per file, 300 MB total, oldest dropped) | Runners are wiped after every run |

## ⌨️ Commands (in WhatsApp)

Everyone (switchable): `!help` · `!weather Hyderabad` · `!sticker` (on/reply to an image or short video) · `!pdf` (send images, then `!pdf`) · `!yt <link>` (experimental, off) · in groups: `!tagall <msg>` (admins) · `!rules`
Only you (from your own phone or "Message yourself"): `!away <msg>` · `!back` · `!pause` · `!resume` · `!status` · `!text` (reply to a voice note)

## 🔔 Website contact form → WhatsApp

1. Panel → Settings → Alerts → **Website contact form** on → **Generate** a topic → Save.
2. In your website's form submit code:

```js
fetch('https://ntfy.sh/YOUR-TOPIC', { method: 'POST', body: `Name: ${name}\nEmail: ${email}\n\n${message}` });
```

[ntfy.sh](https://ntfy.sh) is free and needs no account; it keeps messages 12 hours and the bot checks every 30 minutes. Anyone who knows the topic can post to it or read it, so keep the topic random and don't send secrets through it.
For your own scripts you can also trigger an alert with a GitHub token: `POST /repos/<you>/vr-bot/dispatches` with `{"event_type":"vr-alert","client_payload":{"text":"Server is down!"}}` (never put a token in public website code).

## ⚠️ Honest limitations

- **Unofficial client.** Baileys connects as a "linked device" (like WhatsApp Web). It is not the official WhatsApp API. WhatsApp can ban numbers that spam — especially bulk messages to people who haven't saved your number. Keep lists small, use the daily cap, and use a spare number if you can.
- **Replies are delayed** (up to ~30 min) — see above.
- **Linked devices log out if your phone doesn't use WhatsApp for 14 days** (WhatsApp's rule). Open WhatsApp on the phone at least once every two weeks. If WhatsApp ever logs the bot out, the panel shows a red banner and you run "Pair WhatsApp" again (2 minutes).
- **GitHub's terms:** GitHub says Actions should not be used for things unrelated to the software project in the repo, or for heavy "serverless app" use. VR Bot is your own project and stays low-load (short runs, mostly sleeping), but it is a grey area — GitHub could slow down or disable Actions on the repo. Don't run copies for other people.
- **Scheduled workflows in public repos stop after 60 days without activity.** The bot commits a small heartbeat every 20 days to prevent this.
- **`!yt`**: YouTube often blocks GitHub's servers ("confirm you're not a bot") — experimental.
- **Saved media/statuses**: only what arrives while the bot is connected or in the backlog it receives on connect; small files only.
- **Festival dates** for lunar festivals (and Eid, which depends on moon sighting) must be checked every January (Panel → Festivals → tap → edit date).
- **Bad MAC / "waiting for this message"**: if a run crashes before saving, encryption keys can get out of sync for a few messages. The bot saves after every run (even on errors) and every 10 minutes while waiting to keep this rare.

## 🧰 For developers

```bash
npm install
npm test              # scheduler, templates, rules, crypto, planner, end-to-end dry run
npm run check         # node --check on every file
VR_PASSPHRASE=x node src/index.js plan 14     # preview the next 14 days of sends
VR_FAKE_WA=1 VR_PASSPHRASE=x VR_NO_PUSH=1 node src/index.js run   # dry run, no WhatsApp
```

`src/` — the bot (Node 22, ESM). `panel/` — the static PWA. `panel/shared/` — pure modules used by both (scheduler, planner, templates, rules, crypto, festivals). Built with [Baileys](https://github.com/WhiskeySockets/Baileys) 7, sharp, pdf-lib, Open-Meteo, Groq.

---

<p align="center"><img src="assets/logo.png" width="56" alt=""><br><b>© 2026 VR DEVELOPMENTS</b> · <a href="https://github.com/Volam-Rakshith">github.com/Volam-Rakshith</a> · <a href="https://vrdevelopments.sites.tab.bot">vrdevelopments.sites.tab.bot</a><br>MIT licensed code · VR DEVELOPMENTS name & logo © VR DEVELOPMENTS</p>
