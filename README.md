# BeanLog - Coffee Science PWA

A zero-cost, local-first Progressive Web App (PWA) for specialty coffee analytics. It uses computer vision to analyze bean size, roast level, and grind distribution using a printable calibration target.

## 🚀 Current Implementation

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
        - **Grind (Particle) Analysis:** Contrast+sharpen + thresholding + connected components for fine particles, size distribution in micrometers
        - **Bean Analysis:** Ellipse fitting for whole beans, size + roast level (lightness)
    *   **Stage handling:** 100mm × 100mm square stage with a conservative 10mm inward crop (80mm × 80mm analyzed)

### 2. Computer Vision Tools
*   **Calibration Sheet Generator:** `generate_calibration_sheet.py`
    *   Generates a precise PDF target (Letter size).
    *   Features: ArUco Markers (IDs 0-3), CMYK + 11-step Grayscale Ramp, 10mm Distortion Grid (excludes stage), 10cm Verification Scale, and a 100mm × 100mm stage box.
*   **Python CV Prototypes:**
    *   `test_cv.py` - Grind particle analysis with DoG filtering
    *   `test_bean_cv.py` - Bean size and roast color analysis

### 3. Calibration System
*   **Geometry:** 180mm x 250mm calibration zone.
*   **Color/Gamma:** Uses an 11-step Grayscale ramp (0-100% Black Ink) to build per-channel LUTs, correcting for nonlinear printer response and lighting conditions.
*   **White Balance:** CMYK patches used to calculate neutral gray correction factors (bean mode only).
*   **Scale:** Supports user input for "Measured Ruler Length" to correct for physical printing scaling errors.
*   **Stage (current sheet):** 100mm × 100mm square stage. The web app analyzes the center conservatively (10mm margin).

### 4. Web App Features
*   **Image Upload:** Separate buttons for Bean vs. Grind analysis
*   **Real-time Processing:** CV analysis runs in Web Worker
*   **Results Display:**
    - **Grind Mode:** Size distribution histogram (0-2000μm) with mean/median/std dev statistics
    - **Bean Mode:** Size scatter plot (Major vs Minor axis) + Roast level histogram (Lightness) with statistics

---

## 📋 TODO List

### Phase 1: Core CV & Frontend ✅ (Completed)
- [x] Scaffold React PWA structure.
- [x] Create Calibration Sheet Generator (Python).
- [x] Prototype CV logic in Python (`test_cv.py`, `test_bean_cv.py`).
- [x] **Port CV Logic to JS:** Both grind and bean analysis ported to `cv.worker.ts`.
- [x] **Image Upload UI:** Built `ImageUpload` component with separate buttons for bean/grind.
- [x] **Results View:** Built `ResultsDisplay` component with plots and statistics.
- [x] **ArUco Support:** Worker includes ArUco detection with fallback to square markers.

### Phase 2: Advanced Features
- [ ] **Lens Distortion Correction:** Use the 10mm grid to calculate and apply radial distortion coefficients.
- [x] **Bean Analysis:** ✅ Size + roast color analysis working end-to-end (post-processed preview uses the same pixels used for analysis).
- [x] **Particle Size Analysis:** ✅ Implemented end-to-end (contrast+sharpen → threshold → connected components).
- [ ] **Camera Capture:** Add live camera capture UI (instead of file upload) for mobile PWA.

### Phase 3: Backend & Data
- [ ] **Database:** Setup MariaDB on Oracle Cloud.
- [ ] **API:** Create a lightweight API (FastAPI/Node) to sync logs.
- [ ] **Auth:** Simple user authentication for syncing.

---

## 🛠️ Usage

### Generating the Target
```bash
pip install reportlab opencv-python Pillow
python generate_calibration_sheet.py
# Prints 'calibration_target.pdf'
```

For **A4 paper**, generate the A4 version (same 180×250mm calibration area, centered on A4):

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

