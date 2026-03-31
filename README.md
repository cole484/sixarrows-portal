# Six Arrows Client Portal

Custom home building client portal for Six Arrows Construction.

---

## Project Structure

```
sixarrows-portal/
├── netlify/
│   └── functions/
│       ├── notion-tracker.js    ← reads SAB tracker checkboxes from Notion
│       ├── notion-timeline.js   ← reads construction timeline database
│       ├── notion-clients.js    ← reads SAB Customers Tracker database
│       └── notion-updates.js    ← manages client update approval workflow
├── portal/                      ← client-facing web app (HTML/JS/CSS)
│   ├── index.html               ← login page
│   ├── dashboard.html           ← command center
│   ├── tracker.html             ← SAB tracker
│   ├── budget.html              ← budget page
│   ├── timeline.html            ← project timeline
│   ├── selections.html          ← wave selections overview
│   ├── selections-app.html      ← wave selections app
│   ├── documents.html           ← documents & photos
│   ├── updates.html             ← project updates
│   ├── admin.html               ← admin panel
│   ├── data.js                  ← client data (replaced by Supabase in v3)
│   ├── app.js                   ← shared layout engine
│   └── style.css                ← design system
├── netlify.toml                 ← Netlify configuration
└── package.json
```

---

## Setup Instructions

### Step 1 — Create a Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"New integration"**
3. Name it **"Six Arrows Portal"**
4. Select your workspace
5. Capabilities: **Read content** is sufficient (no insert/update needed)
6. Click Save, then copy the **Internal Integration Token** (starts with `secret_`)

### Step 2 — Share Notion Pages with the Integration

For each page/database, open it in Notion, click `...` → **Connections** → find "Six Arrows Portal" and connect.

Share the following:
- SAB Customers Tracker database
- Each client's SAB Blueprint Progress Tracker page
- Each client's timeline database (when they enter construction phase)

You can verify which pages are shared by going to notion.so/my-integrations → Six Arrows Portal → Content access tab.

### Step 3 — Create GitHub Repository

1. Go to [github.com](https://github.com) → New repository
2. Name: `sixarrows-portal`
3. Visibility: **Private**
4. Upload all files from this folder (drag & drop the entire folder contents)

### Step 4 — Deploy to Netlify

1. Log into your Netlify account (same one as David Adler)
2. Click **"Add new site"** → **"Import an existing project"**
3. Connect to GitHub → select `sixarrows-portal`
4. Build settings will auto-detect from `netlify.toml`:
   - Publish directory: `portal`
   - Functions directory: `netlify/functions`
5. Click **Deploy site**

### Step 5 — Set Environment Variables

In Netlify dashboard → Site → **Environment variables**, add:

| Variable | Value |
|---|---|
| `NOTION_TOKEN` | Your integration token from Step 1 |
| `SAB_CUSTOMERS_DB_ID` | `2224737b-ea6f-8026-97e1-c3c501ad55e2` |

### Step 6 — Connect Custom Domain (Optional)

In Netlify → Domain management:
1. Add custom domain: `portal.sixarrowsconstruction.com`
2. In your domain registrar (wherever sixarrowsconstruction.com DNS is managed), add a CNAME record pointing `portal` to your Netlify URL
3. Netlify automatically provisions SSL

---

## API Endpoints (once deployed)

| Endpoint | Method | Description |
|---|---|---|
| `/.netlify/functions/notion-tracker?pageId=XXX` | GET | SAB tracker step completion |
| `/.netlify/functions/notion-timeline?databaseId=XXX` | GET | Construction timeline + update drafts |
| `/.netlify/functions/notion-clients` | GET | All clients from SAB Customers Tracker |
| `/.netlify/functions/notion-updates?clientId=XXX` | GET | Client's approved updates + drafts |
| `/.netlify/functions/notion-updates?clientId=XXX` | POST | Approve draft / post manual update |
| `/.netlify/functions/notion-updates?clientId=XXX&index=N` | DELETE | Remove an approved update |

## Roadmap

**v1 (current):** Static portal + localStorage admin  
**v2 (this deploy):** Netlify Functions + Notion API bridge — live SAB tracker sync  
**v3 (next session):** Supabase database — real auth, persistent data, no more data.js editing  
