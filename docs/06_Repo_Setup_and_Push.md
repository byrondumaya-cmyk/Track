# GarbageTrack — Repository Setup & GitHub Push Guide

**Version:** 1.2.0  
**Purpose:** Step-by-step instructions for pushing the project to a public/private GitHub repository while excluding all sensitive files.

---

## 1. What Gets Pushed vs. What Gets Excluded

### ✅ Included in the Repository

| Path | Description |
|------|-------------|
| `firmware/src/main.cpp` | Core firmware source |
| `firmware/src/config.h` | Hardware pin definitions & constants |
| `firmware/src/system_state.h` | Shared state types |
| `firmware/src/secrets.h.example` | Template for secrets (if you create it) |
| `firmware/platformio.ini` | PlatformIO build config |
| `firmware/sim7600.h` | Modem AT command reference |
| `backend/supabase/functions/` | All Edge Functions |
| `backend/supabase/migrations/` | All SQL migrations |
| `backend/supabase/config.toml` | Supabase project config |
| `backend/remote_public_schema.sql` | Public schema export |
| `dashboard/src/` | All frontend source files |
| `dashboard/index.html` | Entry HTML |
| `dashboard/package.json` | Dependencies |
| `dashboard/vite.config.ts` | Build config |
| `dashboard/tsconfig*.json` | TypeScript configs |
| `dashboard/.gitignore` | Dashboard gitignore |
| `docs/` | All supporting documents |
| `.gitignore` | Root gitignore |
| `USER_MANUAL.md` | Original manual |
| `gps-tracker.md` | Implementation plan |

### ❌ Excluded from the Repository (Sensitive / Not for Clients)

| Path | Reason |
|------|--------|
| `firmware/src/secrets.h` | Contains API keys and passwords — already in `.gitignore` |
| `dashboard/.env` | Contains Supabase URL and anon key |
| `CREDENTIALS.md` | Contains all access credentials |
| `Garbage_Truck_Tracking_Progress_Report.docx` | Internal progress report |
| `Garbage_Truck_Tracking_Progress_Report.pdf` | Internal progress report |
| `~$rbage_Truck_Tracking_Progress_Report.docx` | Word temp file |
| `~WRL0003.tmp` | Word temp file |
| `.agents/` | AI agent configuration (internal tooling) |
| `.gemini/` | AI assistant config (internal tooling) |
| `.ag-kit-backups/` | Backup files (internal tooling) |
| `.venv/` | Python virtual environment |
| `dashboard/node_modules/` | npm packages (regenerated via `npm install`) |
| `dashboard/dist/` | Production build output (regenerated via `npm run build`) |

---

## 2. Update `.gitignore`

Before pushing, ensure the root `.gitignore` covers all sensitive files. The file should contain:

```gitignore
# Firmware secrets
firmware/src/secrets.h

# Dashboard environment & build
dashboard/.env
dashboard/node_modules/
dashboard/dist/

# Sensitive project documents
CREDENTIALS.md
Garbage_Truck_Tracking_Progress_Report.docx
Garbage_Truck_Tracking_Progress_Report.pdf
~$rbage_Truck_Tracking_Progress_Report.docx
~WRL0003.tmp

# AI agent & tool configuration (internal only)
.agents/
.gemini/
.ag-kit-backups/
.venv/

# Python
__pycache__/
*.py[cod]
*.pyo

# OS
.DS_Store
Thumbs.db
```

---

## 3. Create the GitHub Repository

### Option A — GitHub Website (Recommended for First-Timers)

1. Go to [https://github.com/new](https://github.com/new)
2. Fill in:
   - **Repository name:** `Track`
   - **Description:** `Solar-powered IoT GPS fleet tracking system for garbage trucks — ESP32 + Supabase + React`
   - **Visibility:** Private (recommended) or Public
   - ❌ Do NOT initialize with README (you already have files)
3. Click **Create repository**
4. Copy the repository URL shown (e.g., `https://github.com/byrondumaya-cmyk/Track.git`)

### Option B — GitHub CLI

```bash
gh repo create Track --private --description "Solar-powered IoT GPS fleet tracking system"
```

---

## 4. Push the Project

Open PowerShell in the project root folder (`Garbage_Truck_Tracking/`):

### 4.1 Initialize Git (if not already done)

```powershell
git init
git branch -M main
```

### 4.2 Stage All Files (Respecting .gitignore)

```powershell
git add .
```

Verify what will be committed (check nothing sensitive is included):

```powershell
git status
```

Look through the list. If you see any of the excluded files listed above, stop and check your `.gitignore`.

### 4.3 Create the Initial Commit

```powershell
git commit -m "feat: initial commit — GarbageTrack GPS v1.2.0

- ESP32 firmware with FreeRTOS tasks, WiFi/LTE dual upload, NVS buffering
- Supabase backend: 13 migrations, 6 Edge Functions, PostGIS geofencing
- Vite + React dashboard: live map, history replay, events, checkpoints
- Supporting documentation in docs/"
```

### 4.4 Add the Remote Origin

Replace the URL with your actual repository URL:

```powershell
git remote add origin https://github.com/byrondumaya-cmyk/Track.git
```

### 4.5 Push to GitHub

```powershell
git push -u origin main
```

---

## 5. Verify the Push

1. Open your repository on GitHub
2. Confirm these files **are present:**
   - `firmware/src/main.cpp` ✅
   - `backend/supabase/functions/ingest/index.ts` ✅
   - `dashboard/src/pages/LiveMap.tsx` ✅
   - `docs/` folder with all 6 documents ✅
3. Confirm these files **are NOT present:**
   - `firmware/src/secrets.h` ❌ (must not appear)
   - `dashboard/.env` ❌ (must not appear)
   - `CREDENTIALS.md` ❌ (must not appear)
   - `.agents/` folder ❌ (must not appear)

---

## 6. Recommended Repository Settings (GitHub)

Once the repo is created, configure these settings at `Settings → General`:

| Setting | Recommended Value |
|---------|------------------|
| **Topics / Tags** | `iot`, `gps-tracking`, `esp32`, `supabase`, `react`, `freertos`, `philippines` |
| **Default Branch** | `main` |
| **Issues** | Enabled |
| **Discussions** | Optional |

### Protect the Main Branch
Go to `Settings → Branches → Add branch ruleset`:
- Branch name pattern: `main`
- ✅ Require pull request before merging
- ✅ Require at least 1 approval

## 7. Public Client Credentials (Included)

The following credentials are safe to include for clients to access the system. These are defined in the README and User Manual, but **never include secrets** (like `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `API_KEY`).

### Local Maintenance Portal (Hardware)
- **Wi-Fi SSID:** `TrackLocator-Service`
- **Wi-Fi Password:** `GTrack2026`
- **Portal URL:** `http://192.168.4.1/`
- **Portal Username:** `admin`
- **Portal Password:** `GTrack@2026!`

### Web Dashboard
- **Dashboard URL:** `https://garbage-truck-gps-z59i-2wpo36hdb-dumjaes-projects.vercel.app/`
- **Admin Email:** `mlgualiaga@gmail.com`
- **Admin Password:** `admin@menrolgu-aliaga`

---

## 8. Ongoing Workflow (After Initial Push)

### Creating a Feature Branch

```powershell
git checkout -b feature/your-feature-name
# make changes
git add .
git commit -m "feat: description of your change"
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

### Keeping Dashboard Deployed on Vercel

Vercel is connected to the GitHub repo. Every push to `main` automatically triggers a new deployment. No manual steps needed after the initial setup.

### Keeping Supabase Updated

After adding a new migration file:

```powershell
supabase db push
```

After modifying an Edge Function:

```powershell
supabase functions deploy <function-name>
```

---

## 8. Secrets Template (Create Before Pushing)

Create a file `firmware/src/secrets.h.example` that shows the required fields WITHOUT real values. This helps new developers know what to fill in:

```cpp
// secrets.h.example — Copy to secrets.h and fill in real values
// This file IS committed. secrets.h is NOT committed.

#pragma once

// Device identity
#define DEVICE_ID             "TL-001"
#define API_KEY               "your-device-api-key-here"

// Supabase endpoints
#define INGEST_URL            "https://<project-ref>.supabase.co/functions/v1/ingest"
#define CONFIG_URL            "https://<project-ref>.supabase.co/functions/v1/config"
#define EVENT_URL             "https://<project-ref>.supabase.co/functions/v1/event"
#define HEALTH_URL            "https://<project-ref>.supabase.co/functions/v1/health"

// Local portal credentials
#define PORTAL_ADMIN_PASSWORD "change-me"

// Cellular APN
#define DEFAULT_APN           "internet"
```

Then add it and commit:

```powershell
git add firmware/src/secrets.h.example
git commit -m "docs: add secrets template for new developers"
git push
```

---

*GarbageTrack v1.2.0 — September 2026*
