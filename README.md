# Prompt Saver

Auto-saves every prompt you send on **ChatGPT** and **Claude**.

- **Saved on your PC** — always, in the browser's local storage (works with no account).
- **Backup file on your PC** — `Downloads/PromptSaver/prompts-backup.json`, written once a day (toggle in settings) or with *Back up now*.
- **Saved on your server** — Vercel + MongoDB. Log in and prompts sync both ways. Log in on another PC and everything comes back.

```
prompt-saver/
├── extension/        ← Chrome extension (load this folder in Chrome)
└── server/           ← Vercel API (deploy this folder)
    ├── api/          health.js · register.js · login.js · sync.js
    ├── lib/          db.js (MongoDB) · auth.js (JWT) · http.js (CORS)
    ├── vercel.json
    └── .env.example
```

---

## 1. Install the extension (Chrome / Edge / Brave)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension` folder
4. Pin it from the puzzle-piece menu
5. **Refresh** any ChatGPT / Claude tabs that were already open

Send a prompt — the icon flashes ✓ and it appears in the popup.

### Popup features
- Search, filter by ChatGPT / Claude / ★ Starred
- Copy, star, open original chat, delete
- Export JSON / Markdown, Import JSON
- ↗ button opens a full-page view

---

## 2. Create the MongoDB database (MongoDB Atlas, free tier works)

1. Go to <https://cloud.mongodb.com> → create a project → **Create cluster** (M0 Free).
2. **Database Access** → *Add new database user* → username + password (role: *Read and write to any database*).
3. **Network Access** → *Add IP address* → **Allow access from anywhere** (`0.0.0.0/0`).
   Vercel functions run from changing IPs, so this is required.
4. **Database → Connect → Drivers** → copy the connection string, e.g.
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   (replace `<password>` with the real password; URL-encode special characters like `@ # /`).

Collections and indexes (`users`, `prompts`, `attempts`) are created automatically on first request.

> Alternative: in Vercel → *Storage* / *Marketplace* → **MongoDB Atlas** integration creates the cluster and sets `MONGODB_URI` for you.

---

## 3. Deploy the API to Vercel

### Option A — GitHub (recommended)
1. Push the `server` folder to a GitHub repo (the folder contents at the repo root).
2. Vercel → **Add New → Project** → import the repo. Framework preset: **Other**. No build command needed.
3. **Settings → Environment Variables** — add:

| Variable | Value |
|---|---|
| `MONGODB_URI` | your Atlas connection string |
| `JWT_SECRET` | long random string (`openssl rand -hex 32`) |
| `MONGODB_DB` | `prompt_saver` (optional) |
| `ALLOW_REGISTER` | `true` — set to `false` after you create your account |

4. **Deploy**. If you added variables after the first deploy, redeploy once.

### Option B — Vercel CLI
```bash
npm i -g vercel
cd server
vercel                       # link / create project
vercel env add MONGODB_URI
vercel env add JWT_SECRET
vercel --prod
```

### Check it works
Open `https://YOUR-PROJECT.vercel.app/api/health` → should show `{"ok":true,"db":"connected"}`.

Keep the same `JWT_SECRET` forever — changing it logs every device out (prompts are not lost).
You can also attach a custom domain like `prompts.yourdomain.com` in Vercel → Domains.

---

## 4. Connect the extension

Popup → **Account & Backup** → Server URL `https://YOUR-PROJECT.vercel.app` → email + password →
**Create account** (first time) or **Log in**.

Everything saved before logging in is uploaded. On a new PC, install the extension, log in, and all prompts download.
Auto-sync runs after every new prompt and every 5 minutes.

---

## How it works

- `content.js` listens (capture phase) for **Enter** and the **send button** on chatgpt.com / claude.ai and reads the composer text just before the site clears it.
- `background.js` stores it locally, then syncs. Every prompt has a UUID and `updatedAt`; the newer version always wins. Deletes are sent as tiny tombstones so they reach other PCs.
- Vercel limits: request/response bodies max ~4.5 MB, so the extension uploads in ~2.5 MB chunks and the API returns pages of up to 1000 prompts / 3 MB.
- API: MongoDB with a cached connection across invocations, bcrypt passwords, JWT login (180 days), login rate limiting stored in MongoDB, CORS open for the extension.

### API
| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/health` | – | `{ ok, db }` |
| `POST /api/register` | `{ email, password }` | `{ token, email }` |
| `POST /api/login` | `{ email, password }` | `{ token, email }` |
| `POST /api/sync` *(Bearer token)* | `{ since, prompts[], after?, pull? }` | `{ now, more, after, changes[] }` |

## If a site changes its layout
ChatGPT/Claude occasionally rename their buttons. If capture stops working, update the selectors at the top of `extension/content.js` (`COMPOSER_SELECTORS`, `SEND_SELECTORS`) and reload the extension.
# prompt-saver-extension
