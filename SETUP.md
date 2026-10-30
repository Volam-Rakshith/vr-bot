<p align="center"><img src="assets/logo.png" width="72" alt="VR DEVELOPMENTS"></p>

# VR Bot — Setup guide

**Time:** about 20 minutes, once. **Cost:** ₹0. **You need:** your GitHub account, your laptop for step 2 (just once), and your phone.

Go slowly, one step at a time. Every step ends with a ✅ check so you know it worked. If something looks different, jump to **[Troubleshooting](#-troubleshooting)** at the bottom — every problem we could think of is there.

> Words you'll see: **repo** = your project folder on GitHub · **secret** = a hidden setting only the bot can read · **workflow** = a job GitHub runs for you (in the **Actions** tab).

---

## 1. Create the repo

1. Open **github.com** and sign in.
2. Tap **＋** (top right) → **New repository**.
3. **Repository name:** `vr-bot`
4. Choose **Public**. (Free hosting for the panel needs Public. Your contacts, messages and WhatsApp login are encrypted, so nobody can read them.)
5. Leave everything else empty — **don't** add a README.
6. Tap **Create repository**.

✅ You see an empty repo page that says "Quick setup".

## 2. Upload the files (on your laptop)

1. Unzip `vr-bot.zip`. Open the folder — you should see `README.md`, `SETUP.md`, `package.json`, and folders `.github`, `data`, `panel`, `src`, `test`, `assets`, `scripts`.
2. On the empty repo page, click **uploading an existing file**.
3. Select **everything inside** the folder (Ctrl + A) and drag it into the browser box. Make sure the **`.github`** folder is included.
4. Wait until all files are listed, then click **Commit changes**.

✅ Your repo now shows the files, and the **Actions** tab lists four workflows: *VR Bot — Run*, *VR Bot — Pair WhatsApp*, *VR Bot — Publish panel*, *VR Bot — Tests*. (A red ✗ on *Publish panel* right now is normal — step 5 fixes it. GitHub may email you about it; ignore that one.)

> No workflows in the Actions tab? The `.github` folder didn't upload — see Troubleshooting **T1**.
> Know git? `git init && git add . && git commit -m "VR Bot" && git branch -M main && git remote add origin https://github.com/<you>/vr-bot.git && git push -u origin main` does the same.

## 3. Allow the bot to save its data

1. In the repo: **Settings** → **Actions** → **General**.
2. Scroll to **Workflow permissions** → choose **Read and write permissions** → **Save**.

✅ "Read and write permissions" is selected.

## 4. Add your secrets

**Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add these one by one (name exactly as written, in CAPITALS):

| Name | Value | Needed? |
|---|---|---|
| `VR_PASSPHRASE` | A strong password you'll remember, e.g. `Biryani-Rocket-2026!` — **write it down**. It encrypts everything and is also your panel password. | **Required** |
| `BOT_NUMBER` | The WhatsApp number the bot will use, country code + number, digits only: `91XXXXXXXXXX` | **Required** |
| `OWNER_NUMBER` | The number that receives alerts, summaries and failure messages, same format. Skip it if it's the same as `BOT_NUMBER` (then they arrive in your "Message yourself" chat). | Optional |
| `GROQ_API_KEY` | For AI replies and voice-to-text — see step 12. | Optional |

✅ You see `VR_PASSPHRASE` and `BOT_NUMBER` in the list (values are hidden — that's normal).

> 💡 Safest: use a **spare number** for `BOT_NUMBER` and your main number for `OWNER_NUMBER`. If you use your main number for the bot, it will auto-reply **as you**.

## 5. Turn on the panel website

1. **Settings** → **Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Open the **Actions** tab → click **VR Bot — Publish panel** (left side) → **Run workflow** → **Run workflow**.
4. Wait ~1 minute until it shows a green ✔.

✅ Open `https://<your-username>.github.io/vr-bot/` (all lowercase, e.g. `https://volam-rakshith.github.io/vr-bot/`). You see the VR Bot login page.

## 6. Make a token for the panel

The panel needs a key to edit your repo. This key only works on this one repo.

1. Go to **github.com/settings/personal-access-tokens/new** (or: profile photo → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token).
2. **Token name:** `VR Bot panel` · **Expiration:** 1 year (put a reminder in your calendar).
3. **Repository access:** **Only select repositories** → pick **vr-bot**.
4. **Permissions** → **Repository permissions**:
   - **Contents** → **Read and write**
   - **Actions** → **Read and write**
   (Metadata: Read-only is added automatically.)
5. **Generate token** → **copy** it (starts with `github_pat_`). You can't see it again — paste it into your notes for a minute.

✅ You have a token starting with `github_pat_`.

## 7. Log in to the panel (on your phone)

1. Open your panel link from step 5 on your phone.
2. Fill in: **GitHub username**, **Repo name** `vr-bot`, **GitHub token** (step 6), **Panel password** = exactly your `VR_PASSPHRASE`.
3. Turn on **Remember on this phone** if it's your own phone → **Open my panel**.
4. Install it: Chrome **⋮ → Add to Home screen** (Safari: **Share → Add to Home Screen**).

✅ You see the Dashboard with a yellow "WhatsApp not linked yet" banner. That's expected — next step fixes it.

## 8. Lock your data with your password

Still in the panel: open **More → Settings**, check your name, then tap **Save settings**.
This encrypts the settings and creates `data/lock.json` (a password check — safe to be public). From now on the panel and the bot both refuse a wrong password.

✅ You see "Saved ✓".

## 9. Link WhatsApp (pairing code)

Keep WhatsApp open on the phone that has the `BOT_NUMBER` SIM.

1. In GitHub: **Actions** → **VR Bot — Pair WhatsApp** → **Run workflow** → method **pairing-code** → **Run workflow**.
2. Tap the new run (yellow dot) → **pair** → open the step **"Link WhatsApp — open this step to see your code"**.
3. After 20–40 seconds you'll see:
   ```
   YOUR WHATSAPP PAIRING CODE:
           ABCD-EFGH
   ```
4. On your phone: **WhatsApp → ⋮ (or Settings) → Linked devices → Link a device → "Link with phone number instead"** → type the 8 letters.
5. Wait. The log says **"Linked!"**, then **"All done"**, and WhatsApp gets a message: **"🤖 VR Bot is linked and ready ✅"**.

✅ The run is green and you got the "linked and ready" message. Reopen the panel: the top-right pill is green **Linked**.

> The code is valid for about 2 minutes. Too slow? Just run the workflow again — it's safe.

## 10. First test

1. Panel → **Contacts** → **Delete all examples** → tap **＋** → add yourself (or a friend who knows about this) → **Save**.
2. **Schedules** → **＋** → Name `Test`, Send to → your contact, message `Hello from VR Bot 🤖`, time = **5 minutes from now**, Repeat **Once** → **Save**.
3. Tap the schedule again → **🧪 Test to me** (sends you a preview within ~2 minutes).
4. GitHub **Actions** → **VR Bot — Run** → **Run workflow** → **Run workflow** (so a run is waiting for your 5-minute test).

✅ The test message arrives on the exact minute. Panel → **Logs → Sent** shows ✅ "on time".

## 11. Make it yours

- **Contacts:** add people with birthdays and tags (`family`, `friends`, `class`…). Tip: **Add many at once (paste)**.
- **Schedules:** good mornings, class reminders (pick your group — groups appear after the first run), exam dates.
- **Festivals:** turn on Diwali, Sankranti… pick lists and a time.
- **Replies:** add auto-reply rules, set up Away mode.
- **Settings:** switch features on/off, the 🤖 "VR Bot is sending" header, daily summary time.

From now on the bot runs by itself, all day (Always on). You never need to touch GitHub again unless WhatsApp logs it out.

## 12. (Optional) AI replies & voice-to-text — free Groq key

1. Go to **console.groq.com** → sign in (Google or GitHub, no card) → **API Keys** → **Create API Key** → copy.
2. GitHub → **Settings → Secrets and variables → Actions → New repository secret** → name `GROQ_API_KEY`, paste.
3. Panel → **Replies** → turn on **AI replies**, write your style and 2–3 example chats → **Save replies**. Voice notes: **Settings → Voice note → text**.

Free plan (checked Oct 2026): `openai/gpt-oss-120b` 30 requests/min, 1,000/day; Whisper 20 requests/min, 2,000/day.

---

## 🧯 Troubleshooting

**T1 — No workflows in the Actions tab.** The `.github` folder didn't upload (some computers hide folders starting with a dot). In your repo: **Add file → Create new file**, type the name `.github/workflows/bot.yml`, paste the contents of that file from the zip, **Commit**. Repeat for `pair.yml`, `pages.yml`, `test.yml`.

**T2 — Panel link shows 404.** Step 5: Source must be **GitHub Actions**, then run **VR Bot — Publish panel**. Wait 2 minutes. Use all-lowercase username in the link.

**T3 — Panel: "GitHub rejected the token".** Token expired or copied wrong. Make a new one (step 6) and log in again.

**T4 — Panel: "forbidden".** The token is missing a permission or the repo. Edit the token: Repository access → vr-bot; Contents & Actions → Read and write.

**T5 — Panel: "Wrong panel password".** It must be *exactly* your `VR_PASSPHRASE` (capitals and symbols count). Forgot it? You can start fresh: set a new `VR_PASSPHRASE` secret, delete `data/lock.json` and the `vr-state` branch (Branches page → 🗑), log in with the new password, re-enter your data, and pair again (step 9).

**T6 — Pairing run fails: "BOT_NUMBER secret is missing" / no code.** Check the secret name and value: digits only with country code, like `919876543210` (no `+`, no spaces).

**T7 — WhatsApp says "Couldn't link device" / code invalid.** Codes expire in ~2 minutes and WhatsApp limits attempts. Run the pairing workflow again and type the newest code. After many tries, wait an hour.

**T8 — Red banner "WhatsApp logged the bot out".** You removed the linked device, or the phone didn't open WhatsApp for 14 days. Run step 9 again. Open WhatsApp on that phone at least once every two weeks.

**T9 — Run fails: "VR_PASSPHRASE secret does not match".** The secret and your panel password are different. Edit the secret (Settings → Secrets → Actions → `VR_PASSPHRASE` → Update) to the panel password.

**T10 — A message didn't send.** Check in this order: item marked **EXAMPLE**? (never sent) · schedule paused or **Pause everything** on? · the feature switched off in Settings? · Panel **Logs → Sent** shows the reason (e.g. "number is not on WhatsApp") · number has the country code.

**T11 — A message came late.** Panel **Logs → Runs**. GitHub sometimes starts runs late under heavy load; the bot catches up (up to 3 hours) and marks it "late". Keep **Settings → Timing → Always on** ON. If Actions shows no "VR Bot — Run" in progress, tap **▶ Run now** in the panel — that restarts the chain.

**T12 — Replies/commands take long.** With Always on, replies come within seconds (except during the ~1–2 min hand-over about every 80 min). With it off or while paused, replies wait for the next check.

**T13 — Runs stopped completely.** GitHub pauses scheduled workflows in public repos after 60 days without activity (the bot's heartbeat prevents this). Fix: **Actions → VR Bot — Watchdog → Enable workflow** (and VR Bot — Run if it shows disabled). Also check GitHub didn't email you about Actions being disabled.

**T14 — Everyone sees "Waiting for this message".** Encryption keys got out of sync (usually after a crashed run). It normally fixes itself in a few messages. If not: pair again (step 9).

**T15 — I want to stop everything now.** Fastest: panel **Home → ⏸ Pause all**. Or send `!pause` to yourself on WhatsApp. Or **Actions → VR Bot — Run → ⋯ → Disable workflow**. To fully unlink: WhatsApp → Linked devices → tap the bot → Log out.

**T16 — Ban worries.** Don't message strangers in bulk. Keep the broadcast daily cap low (default 60), keep the random gaps, and prefer a spare number.

Still stuck? Open **Actions**, click the red ✗ run, and read the last red line — it is written to tell you what to do.

---
<p align="center">© 2026 VR DEVELOPMENTS · Turning Ideas Into Innovation</p>
