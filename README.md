# BeanLog - Coffee Science PWA

A zero-cost, local-first Progressive Web App (PWA) for specialty coffee analytics. It uses computer vision to analyze bean size, roast level, and grind distribution using a printable calibration target.

## Current Implementation

### 1. Frontend (React + Vite + TypeScript)
*   **PWA Enabled:** Configured with `vite-plugin-pwa` for offline capability and "Add to Home Screen" on iOS/Android.
*   **UI Framework:** Tailwind CSS with Lucide Icons.
*   **Charts:** `react-chartjs-2` for plotting Extraction vs. TDS and analysis results.
*   **CV Worker:** `src/workers/cv.worker.ts` handles image processing off the main thread.
    *   **ArUco Marker Detection** (with fallback to square detection)
    *   **Perspective Warp** using homography
    *   **Color/Gamma Calibration** via 11-step grayscale ramp LUTs
    *   **White Balance** using CMYK patches (for bean mode)
    *   **Dual Analysis Modes:**
        - **Grind (Particle) Analysis:** Contrast+sharpen + thresholding + contour detection + ellipse fitting for fine particles, size distribution in micrometers
        - **Bean Analysis:** Ellipse fitting for whole beans, size + roast level (lightness)
    *   **Stage handling:** 100mm x 100mm square stage with a conservative 10mm inward crop (80mm x 80mm analyzed)

### 2. Computer Vision Tools
*   **Calibration Sheet Generator:** `generate_calibration_sheet.py`
    *   Generates a precise PDF target (Letter size).
    *   Features: ArUco Markers (IDs 0-3), CMYK + 11-step Grayscale Ramp, 10mm Distortion Grid (excludes stage), 10cm Verification Scale, and a 100mm x 100mm stage box.
*   **Python CV Prototypes:**
    *   `test_cv.py` - Grind particle analysis with DoG filtering
    *   `test_bean_cv.py` - Bean size and roast color analysis

### 3. Calibration System
*   **Geometry:** 180mm x 250mm calibration zone.
*   **Color/Gamma:** Uses an 11-step Grayscale ramp (0-100% Black Ink) to build per-channel LUTs, correcting for nonlinear printer response and lighting conditions.
*   **White Balance:** CMYK patches used to calculate neutral gray correction factors (bean mode only).
*   **Scale:** Supports user input for "Measured Ruler Length" to correct for physical printing scaling errors.
*   **Stage (current sheet):** 100mm x 100mm square stage. The web app analyzes the center conservatively (10mm margin).

### 4. Web App Features
*   **Image Upload:** Separate buttons for Bean vs. Grind analysis
*   **Real-time Processing:** CV analysis runs in Web Worker
*   **Results Display:**
    - **Grind Mode:** Configurable histogram (12 modes: Number/Mass/Available Mass/Surface vs Diameter/Surface/Volume) with 100um grid, weighted mean/stdev, and peak (mode) statistics. Based on the research of [Jonathan Gagne](https://coffeeadastra.com/2019/04/07/an-app-to-measure-your-coffee-grind-size-distribution-2/).
    - **Bean Mode:** Size scatter plot (Major vs Minor axis) + Roast level histogram (Lightness) with statistics
*   **Particle Physics (Grind):**
    - Ellipse fitting via `cv.fitEllipse` for accurate major/minor axis measurement
    - Ellipsoid volume estimation (4/3 pi a b^2)
    - **Available mass** calculation (water penetration depth model, 0.1mm limit)
    - **Extraction yield** estimation (surface-area-based model)
    - Outlier filtering (sparse high-end bins removed automatically)
    - Peak (mode) diameter via available-mass-weighted 50um bins
*   **iOS Safari Support:** Input images are automatically downscaled (max 2048px longest edge) before canvas/worker processing to prevent out-of-memory tab crashes on mobile Safari, which has a strict ~16 megapixel canvas limit. iPhone photos (12–48 MP) would otherwise exceed this. The ArUco markers still provide accurate physical scale after downscaling.

---

## Logging (Supabase)

The app has a separate **Logging** tab (next to **Analysis**) to record brews and bean info.

### What's implemented
- **Top-level tabs**: Analysis vs Logging.
- **Supabase Auth login**
  - Signup/Login: `id` + `password` (`id` is mapped to a Supabase Auth email alias internally)
  - Session/token handled by Supabase Auth
  - Includes app-level validation for id format
- **New brew logging**
  - Bean fields: roastery, producer, origin country, origin location, process, varietal, cup notes, roasted on
  - Brew fields: log date, rating (0-5 stars), recipe, coffee dose, coffee yield, coffee TDS (optional), water, water temp (optional), grind median, extraction note, taste note
  - **SCA flavor wheel picker** (modular/reusable):
    - Cascading dropdowns (broad > narrow > specific)
    - Supports N/A and broad-only notes
    - Notes show a colored dot
- **Autocomplete suggestions** on form fields to prevent duplicate entries:
  - **Grinder:** Maker > Model (hierarchical narrowing, fetched from user's grinder DB)
  - **Bean:** Roastery, Origin country > Origin location > Producer (hierarchical narrowing), Varietal
  - Reusable `AutocompleteInput` component with keyboard navigation (Arrow keys, Enter, Escape), case-insensitive substring filtering, click-outside-to-close
- **Grinder particle size mapping:**
  - Save and search particle sizes per grinder setting
  - Auto-populates with peak (mode) diameter from grind analysis
- **History page**
  - Lists current user's brews as **date -- bean**
  - Clicking an entry loads its detailed view (bean info, grinder, dose/yield/TDS, recipe, flavor notes, etc.)
  - **Filter panel** (toggle on/off) with autocomplete and flavor wheel filters:
    - Text filters: Roastery, Origin country, Origin location, Producer, Varietal, Grinder maker, Grinder model (case-insensitive substring matching, suggestions derived from loaded data)
    - Flavor filters: Cup notes (SCA) and Taste notes (SCA) use the full FlavorWheelPicker with **hierarchical prefix matching** — selecting "Sweet" matches all Sweet/* notes (Honey, Vanilla, Brown Sugar/Caramel, etc.)
    - Active filter count badge, "Clear all" button, "Showing X of Y brews" counter
  - Client-side filtering (instant, no extra API calls)
- **Normalized flavor note tables** (`bean_flavor_notes`, `brew_flavor_notes`):
  - Junction tables with `l1`/`l2`/`l3` columns mapping to SCA Flavor Wheel hierarchy levels
  - Enables efficient server-side hierarchical queries (e.g. `WHERE l1 = 'Sweet'`)
  - Written alongside the existing jsonb columns on save; jsonb still used for display

### Supabase setup
1. Create a Supabase project.
2. In **Authentication > Providers > Email**, enable email/password sign-in.
   - Recommended for this app's `id`-based UX: disable "Confirm email" so signup can log in immediately.
3. Create tables + policies by running `supabase/schema.sql` in the Supabase SQL editor.
   - For existing projects that used the old `app_users` model, run `supabase/patch_2026-02-12_auth_rls.sql`.
   - For brew sharing links/public read URLs, run `supabase/patch_2026-02-13_brew_share_links.sql`.
4. Create a `.env.local` in the project root (gitignored) and set:

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

5. Restart the dev server after changing `.env.local`.

> Security note: Logging data access is protected with Row Level Security (RLS). Make sure to run the latest schema/patch SQL.

---

## TODO List

### Phase 1: Core CV & Frontend (Completed)
- [x] Scaffold React PWA structure.
- [x] Create Calibration Sheet Generator (Python).
- [x] Prototype CV logic in Python (`test_cv.py`, `test_bean_cv.py`).
- [x] **Port CV Logic to JS:** Both grind and bean analysis ported to `cv.worker.ts`.
- [x] **Image Upload UI:** Built `ImageUpload` component with separate buttons for bean/grind.
- [x] **Results View:** Built `ResultsDisplay` component with plots and statistics.
- [x] **ArUco Support:** Worker includes ArUco detection with fallback to square markers.

### Phase 2: Advanced Features
- [x] **Bean Analysis:** Size + roast color analysis working end-to-end.
- [x] **Particle Size Analysis:** Implemented end-to-end (contrast+sharpen > threshold > contour detection > ellipse fitting).
- [x] **Particle Statistics:** Available mass, extraction yield, configurable histogram (12 modes), outlier filtering, peak (mode) diameter.

### Phase 3: Backend & Data
- [x] **Database:** Supabase tables for beans/brews/grinders/particle sizes.
- [x] **Auth:** Supabase Auth signup/login integrated in app.
- [x] **Logging:** Bean + brew logging with autocomplete suggestions.
- [x] **Grinder particle size mapping:** Save/search per grinder setting, auto-populated from analysis.
- [x] **History filters:** Filter panel with autocomplete text fields + SCA flavor wheel pickers with hierarchical prefix matching.
- [x] **Normalized flavor note tables:** `bean_flavor_notes` / `brew_flavor_notes` junction tables for efficient hierarchical filtering.
- [x] **Autocomplete inputs:** Reusable component used across New Brew, Analysis, and History pages.
- [ ] **Save/load beans:** Allow saving beans and selecting from existing beans.
- [x] **Harden security (phase 1):** Move to Supabase Auth + RLS and remove client-side password verification.

---

## Attribution

Grind particle statistics (available mass, extraction yield) are based on the research of **Jonathan Gagne** (MIT License):
- [An App to Measure your Coffee Grind Size Distribution](https://coffeeadastra.com/2019/04/07/an-app-to-measure-your-coffee-grind-size-distribution-2/)
- [GitHub: coffeegrindsize](https://github.com/jgagneastro/coffeegrindsize)

---

## Usage

### Generating the Target
```bash
pip install reportlab opencv-python Pillow
python generate_calibration_sheet.py
# Prints 'calibration_target.pdf'
```

For **A4 paper**, generate the A4 version (same 180x250mm calibration area, centered on A4):

```bash
python generate_calibration_sheet_a4.py
# Prints 'calibration_target_a4.pdf'
```

### Testing CV Logic (Python)
```bash
pip install opencv-python opencv-contrib-python numpy matplotlib
# Test grind analysis
python test_cv.py your_grind_image.jpg --ruler 100.0

# Test bean analysis
python test_bean_cv.py your_bean_image.jpg --ruler 100.0
```

### Building OpenCV.js with ArUco
See `BUILD_OPENCV.md` for detailed instructions. Quick option:
1. Download pre-built `opencv.js` with ArUco support
2. Place `opencv.js` and `opencv.wasm` in `public/` directory
3. The worker will automatically load from `/opencv.js`

**Note:** The worker includes a fallback to square marker detection if ArUco is not available.

### Running the Web App
```bash
npm install
npm run dev
```

Then:
1. Open the app in your browser
2. Enter the measured ruler length (default: 100.0mm)
3. Click "Upload Bean Image" or "Upload Grind Image"
4. Select an image of your calibration sheet
5. View results with plots and statistics

### Deploy to GitHub Pages

The app uses `import.meta.env.BASE_URL` for asset links (e.g. calibration PDFs).

- **User/org Pages** (`username.github.io`): Site is at the root (`https://drash99.github.io/`). Use the **default** base path -- do **not** set `VITE_BASE_PATH`. Build with `npm run build` and deploy the `dist/` contents to the root of your `username.github.io` repo.
- **Project Pages** (`username.github.io/repo-name`): Set the base when building:
  ```bash
  VITE_BASE_PATH=/repo-name/ npm run build
  ```

**Automated deploy to drash99.github.io**

A workflow (`.github/workflows/deploy-to-pages.yml`) builds on push to `main` and pushes the built app to `drash99/drash99.github.io`. To enable it:

1. Generate an SSH key pair (no passphrase):
   ```bash
   ssh-keygen -t ed25519 -C "deploy" -f deploy_key -N ""
   ```
2. In **drash99.github.io** repo: Settings > Deploy keys > Add deploy key. Paste contents of `deploy_key.pub`. Allow write access.
3. In your **source repo** (where this workflow runs): Settings > Secrets and variables > Actions > New repository secret. Name: `ACTIONS_DEPLOY_KEY`, value: contents of `deploy_key` (private key).
4. Add these repository secrets as well (used at build time):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually). The workflow builds with base `/` and pushes `dist/` to `drash99.github.io` `main` branch.
