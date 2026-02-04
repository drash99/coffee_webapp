# BeanLog - Coffee Science PWA

A zero-cost, local-first Progressive Web App (PWA) for specialty coffee analytics. It uses computer vision to analyze bean size, roast level, and grind distribution using a printable calibration target.

## 🚀 Current Implementation

### 1. Frontend (React + Vite + TypeScript)
*   **PWA Enabled:** Configured with `vite-plugin-pwa` for offline capability and "Add to Home Screen" on iOS/Android.
*   **UI Framework:** Tailwind CSS with Lucide Icons.
*   **Charts:** `react-chartjs-2` set up for plotting Extraction vs. TDS.
*   **CV Worker:** `src/workers/cv.worker.ts` handles image processing off the main thread to keep the UI responsive.
    *   *Current Logic:* Square-based marker detection, Perspective Warp, Color/Gamma Calibration, Bean Morphometry.

### 2. Computer Vision Tools
*   **Calibration Sheet Generator:** `generate_calibration_sheet.py`
    *   Generates a precise PDF target (Letter size).
    *   Features: ArUco Markers (IDs 0-3), CMYK + 11-step Grayscale Ramp, 10mm Distortion Grid, 10cm Verification Scale.
*   **Python CV Prototype:** `test_cv.py`
    *   A testing "playground" for CV algorithms.
    *   Currently implements **ArUco Marker Detection**, Homography warping, and Look-Up Table (LUT) color correction based on the grayscale ramp.

### 3. Calibration System
*   **Geometry:** 180mm x 250mm calibration zone.
*   **Color/Gamma:** Uses an 11-step Grayscale ramp (0-100% Black Ink) to build per-channel LUTs, correcting for nonlinear printer response and lighting conditions.
*   **Scale:** Supports user input for "Measured Ruler Length" to correct for physical printing scaling errors.

---

## 📋 TODO List

### Phase 1: Core CV & Frontend (In Progress)
- [x] Scaffold React PWA structure.
- [x] Create Calibration Sheet Generator (Python).
- [x] Prototype CV logic in Python (`test_cv.py`).
- [ ] **Port ArUco Detection to JS:** Standard `opencv.js` lacks ArUco. Need to implement a JS-based ArUco detector (or custom WASM build) in `cv.worker.ts` to match the Python prototype.
- [ ] **Camera UI:** Build the camera capture component in `App.tsx` to feed frames to the worker.
- [ ] **Results View:** Display analyzed bean metrics (avg size, roast level) and histograms in the app.

### Phase 2: Advanced Features
- [ ] **Lens Distortion Correction:** Use the 10mm grid to calculate and apply radial distortion coefficients.
- [ ] **Particle Size Analysis:** Extend CV logic to segment and measure fine grind particles (Requires high-res macro shots).

### Phase 3: Backend & Data
- [ ] **Database:** Setup MariaDB on Oracle Cloud.
- [ ] **API:** Create a lightweight API (FastAPI/Node) to sync logs.
- [ ] **Auth:** Simple user authentication for syncing.

---

## 🛠️ Usage

### Generating the Target
```bash
pip install reportlab
python generate_calibration_sheet.py
# Prints 'calibration_target.pdf'
```

### Testing CV Logic
```bash
pip install opencv-python opencv-contrib-python numpy matplotlib
python test_cv.py your_test_image.jpg --ruler 100.0
```

### Running the App
```bash
npm install
npm run dev
```

