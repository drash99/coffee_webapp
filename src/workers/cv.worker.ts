// CV Worker Implementation - Ported from test_cv.py and test_bean_cv.py
// Loads OpenCV via fetch + Function (module worker compatible; no importScripts).

type AnalysisMode = 'grind' | 'bean';

type WorkerMessage = 
  | { type: 'INIT'; payload?: { opencvUrl?: string } }
  | { type: 'PROCESS_IMAGE', payload: { 
      imageData: ImageData, 
      width: number, 
      height: number,
      rulerLengthMm: number,
      mode: AnalysisMode
    } 
  };

/** Module-scoped OpenCV API handle. Must be set in INIT so PROCESS_IMAGE always uses the same reference (not self.cv). */
let cv: any = null;

const CALIB_CONFIG = {
  REAL_WIDTH_MM: 180,
  REAL_HEIGHT_MM: 250,
  MARKER_SIZE_MM: 15,
  GRAY_PATCH_Y_MM: 45,
  GRAY_PATCH_XS_MM: Array.from({length: 11}, (_, i) => 55 + i * 9.5),
  EXPECTED_LEVELS: Array.from({length: 11}, (_, i) => Math.round(255 - (i * (255 - 20) / 10))),
  CMYK_PATCH_Y_MM: 30,
  CMYK_PATCH_XS_MM: [106, 120, 134, 148],
  STAGE_CENTER_X_MM: 90,
  STAGE_CENTER_Y_MM: 115,
  STAGE_SIZE_MM: 100,  // 100mm x 100mm square stage
  STAGE_MARGIN_MM: 10,  // Crop 10mm (1cm) from each edge for conservative analysis
  SCALE: 18  // Higher resolution for better detection
};

/** Wait until OpenCV runtime has exposed Mat (on Module or Module.cv). Emscripten calls onRuntimeInitialized when ready; we also poll in case the callback slot isn't used. */
async function waitForOpenCvReady(cvObj: any, timeoutMs = 8000): Promise<void> {
  const matReady = () =>
    (cvObj?.Mat != null && typeof cvObj.Mat === 'function') ||
    (cvObj?.cv?.Mat != null && typeof cvObj.cv.Mat === 'function');
  if (matReady()) return;

  let resolved = false;
  await new Promise<void>((resolve, reject) => {
    const start = Date.now();
    try {
      cvObj.onRuntimeInitialized = () => {
        resolved = true;
        resolve();
      };
    } catch {}

    const timer = setInterval(() => {
      if (matReady()) {
        clearInterval(timer);
        if (!resolved) resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error('OpenCV init timeout: cv.Mat not available'));
      }
    }, 25);
  });

  if (!matReady()) {
    throw new Error('OpenCV loaded but Mat constructor missing (wrong artifact or init not complete)');
  }
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'INIT') {
    try {
        const opencvUrl = msg.payload?.opencvUrl ?? new URL('/opencv.js', self.location.origin).href;
        const res = await fetch(opencvUrl);
        if (!res.ok) throw new Error(`opencv.js fetch failed: ${res.status} ${res.statusText}`);
        const code = await res.text();
        // UMD ends with }\n}(this, function () { ... }; run in worker global so root = self.
        const OPENCV_ROOT = '__opencv_root__';
        const patched = code.replace(/\}\s*\}\s*\(\s*this\s*,/, '}}(' + OPENCV_ROOT + ',');
        new Function(OPENCV_ROOT, patched)(self);

        // OpenCV build_js.py bundles WASM into JS by default (no .wasm file). Builds can expose:
        // 1) factory function cv(...) (MODULARIZE), 2) Promise cv, 3) global object cv (non-modular).
        const maybeCv: any = (self as any).cv;
        let cvObj: any;

        if (typeof maybeCv === 'function') {
          cvObj = await maybeCv({});
        } else if (maybeCv && typeof maybeCv.then === 'function') {
          cvObj = await maybeCv;
        } else if (maybeCv && typeof maybeCv === 'object') {
          cvObj = maybeCv;
        } else {
          postMessage({ type: 'ERROR', payload: 'OpenCV did not expose cv (factory/promise/object). Is public/opencv.js the full build?' });
          return;
        }

        await waitForOpenCvReady(cvObj);

        const hasMat = (o: any) => o != null && typeof o.Mat === 'function';
        const cvNamespace = hasMat(cvObj) ? cvObj : cvObj?.cv;
        if (!cvNamespace || !hasMat(cvNamespace)) {
          postMessage({ type: 'ERROR', payload: 'OpenCV Module has no Mat constructor. Build may be incomplete or wrong file.' });
          return;
        }
        // Merge Module (matFromImageData etc.) and cv namespace (Mat, cvtColor etc.) into one object so module-scope `cv` has everything.
        const merged = Object.create(null) as any;
        Object.assign(merged, cvObj);
        Object.assign(merged, cvNamespace);

        cv = merged;
        (self as any).cv = merged;
        // Uncomment to inspect what cv points to (handle in App: if (e.data.type === 'DEBUG') console.log(e.data.payload))
        // postMessage({ type: 'DEBUG', payload: { cvType: typeof cv, hasMat: !!cv?.Mat, matType: typeof cv?.Mat, hasMatFromImageData: !!cv?.matFromImageData, keys: cv ? Object.keys(cv).slice(0, 40) : null } });
        postMessage({ type: 'CV_READY' });
    } catch (err) {
        console.error('Failed to load OpenCV', err);
        const message = err instanceof Error ? err.message : String(err);
        postMessage({ type: 'ERROR', payload: message || 'Failed to load OpenCV. Ensure opencv.js is in public/.' });
    }
  } 
  else if (msg.type === 'PROCESS_IMAGE') {
    console.log('[CV] PROCESS_IMAGE received');
    if (!cv || typeof cv.Mat !== 'function') {
      postMessage({ type: 'ERROR', payload: 'OpenCV not ready: cv.Mat missing' });
      return;
    }
    try {
      const result = processImage(msg.payload);
      postMessage({ type: 'ANALYSIS_COMPLETE', payload: result });
    } catch (error: any) {
      console.error('CV Processing Error:', error);
      postMessage({ type: 'ERROR', payload: error.message });
    }
  }
};

/** Use our module-scope cv only. OpenCV helpers (matFromImageData, matFromArray, Mat.zeros/ones) may capture a different cv. */
function matFromImageDataSafe(imageData: ImageData) {
  const mat = new cv.Mat(imageData.height, imageData.width, cv.CV_8UC4);
  mat.data.set(imageData.data);
  return mat;
}

function matFromArrayF32Safe(rows: number, cols: number, type: number, data: number[]) {
  const mat = new cv.Mat(rows, cols, type);
  mat.data32F.set(new Float32Array(data));
  return mat;
}

function matZerosSafe(rows: number, cols: number, type: number) {
  const mat = new cv.Mat(rows, cols, type);
  mat.setTo(new cv.Scalar(0));
  return mat;
}

function matOnesU8Safe(rows: number, cols: number) {
  const mat = new cv.Mat(rows, cols, cv.CV_8U);
  mat.setTo(new cv.Scalar(1));
  return mat;
}

function processImage(input: { imageData: ImageData, width: number, height: number, rulerLengthMm: number, mode: AnalysisMode }) {
  const { imageData, rulerLengthMm, mode } = input;
  const scaleCorrection = rulerLengthMm / 100.0;
  console.log('[CV] processImage start', { mode, width: imageData.width, height: imageData.height });

  postMessage({ type: 'DEBUG', payload: { matType: typeof cv?.Mat, cv8uc4: cv?.CV_8UC4, matFromImageDataType: typeof cv?.matFromImageData } });

  let src = matFromImageDataSafe(imageData);
  
  // Resize large images to prevent OOM on mobile (especially iOS)
  // 12MP input (4000x3000) is too large for multiple copies in WASM memory.
  // 2048px is sufficient for marker detection.
  // Note: Warped output size is fixed by CALIB_CONFIG, so accuracy is preserved.
  const maxDim = 2048;
  if (Math.max(src.rows, src.cols) > maxDim) {
    const scale = maxDim / Math.max(src.rows, src.cols);
    const newSize = new cv.Size(Math.round(src.cols * scale), Math.round(src.rows * scale));
    const resized = new cv.Mat();
    cv.resize(src, resized, newSize, 0, 0, cv.INTER_AREA);
    src.delete();
    src = resized;
    console.log('[CV] Resized input to', src.cols, 'x', src.rows);
  }

  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  console.log('[CV] src/gray created');

  // 1. Detect ArUco Markers
  // Try ArUco first, fallback to square detection if not available
  let srcPts: any;
  let foundMarkers = false;

  try {
    // ArUco in OpenCV.js is under objdetect (cv.getPredefinedDictionary, cv.aruco_ArucoDetector) or cv.aruco namespace
    const getDictFn = (cv.aruco && typeof cv.aruco.getPredefinedDictionary === 'function')
      ? cv.aruco.getPredefinedDictionary.bind(cv.aruco)
      : typeof cv.getPredefinedDictionary === 'function'
        ? cv.getPredefinedDictionary.bind(cv)
        : null;
    const DICT_4X4_50 = (cv.aruco && cv.aruco.DICT_4X4_50 != null) ? cv.aruco.DICT_4X4_50 : (cv as any).DICT_4X4_50;
    const DetectorParamsCtor = (cv.aruco && cv.aruco.DetectorParameters) || (cv as any).aruco_DetectorParameters;
    const RefineParamsCtor = (cv.aruco && cv.aruco.RefineParameters) || (cv as any).aruco_RefineParameters;
    const CORNER_REFINE_SUBPIX = (cv.aruco && cv.aruco.CORNER_REFINE_SUBPIX != null) ? cv.aruco.CORNER_REFINE_SUBPIX : (cv as any).CORNER_REFINE_SUBPIX;
    const ArucoDetectorCtor = (cv.aruco && cv.aruco.ArucoDetector) || (cv as any).aruco_ArucoDetector || (cv as any).ArucoDetector;

    const arucoAvailable = !!(getDictFn && DICT_4X4_50 != null && (DetectorParamsCtor || ArucoDetectorCtor));
    if (!arucoAvailable) {
      console.log('[CV] ArUco not available', {
        hasGetPredefinedDictionary: !!getDictFn,
        hasDictEnum: DICT_4X4_50 != null,
        hasDetectorParams: !!DetectorParamsCtor,
        hasArucoDetector: !!ArucoDetectorCtor,
        hasCvAruco: !!cv.aruco
      }, '→ using fallback');
    }
    if (arucoAvailable && getDictFn) {
      console.log('[CV] ArUco detection start');
      const arucoDict = getDictFn(DICT_4X4_50);
      const params = DetectorParamsCtor ? new DetectorParamsCtor() : null;
      // RefineParameters(minRepDistance, errorCorrectionRate, checkAllOrders) - defaults 10, 3, true
      const refineParams = RefineParamsCtor ? new RefineParamsCtor(10, 3, true) : null;
      if (params && CORNER_REFINE_SUBPIX != null && typeof params.cornerRefinementMethod !== 'undefined') params.cornerRefinementMethod = CORNER_REFINE_SUBPIX;

      const corners = new cv.MatVector();
      const ids = new cv.Mat();
      // rejectedImgPoints is OutputArrayOfArrays (MatVector), not Mat
      const rejected = new cv.MatVector();

      if (ArucoDetectorCtor && params !== null && refineParams !== null) {
        // ArucoDetector(dictionary, detectorParams, refineParams) - 3 args required in JS bindings
        const detector = new ArucoDetectorCtor(arucoDict, params, refineParams);
        detector.detectMarkers(gray, corners, ids, rejected);
      } else if (cv.aruco && typeof cv.aruco.detectMarkers === 'function') {
        cv.aruco.detectMarkers(gray, arucoDict, corners, ids, params, rejected);
      } else {
        throw new Error('No detectMarkers API available');
      }
      const numRejected = rejected.size();
      const detectedIds: number[] = [];
      for (let i = 0; i < ids.rows; i++) {
        detectedIds.push(ids.intPtr(i, 0)[0]);
      }
      console.log('[CV] ArUco detectMarkers result:', {
        numMarkers: corners.size(),
        numIds: ids.rows,
        numRejected,
        detectedIds: detectedIds.length ? detectedIds : undefined
      });

      if (ids.rows >= 4) {
        // Organize by ID
        const foundMap: {[key: number]: any} = {};
        for (let i = 0; i < ids.rows; i++) {
          const id = ids.intPtr(i, 0)[0];
          if (id >= 0 && id <= 3) {
            foundMap[id] = corners.get(i);
          }
        }
        const foundIds = Object.keys(foundMap).map(Number).sort((a, b) => a - b);
        console.log('[CV] ArUco markers with id 0–3:', { foundIds, count: foundIds.length });

        if (Object.keys(foundMap).length >= 4) {
          // Use outer corners of each marker so the warped image extends to the marker edges (includes markers).
          // ArUco corner order: 0=TL, 1=TR, 2=BR, 3=BL. Sheet: ID 0=TL, 1=TR, 2=BR, 3=BL.
          const getCorner = (marker: any, cornerIdx: number) => {
            return [marker.data32F[cornerIdx * 2], marker.data32F[cornerIdx * 2 + 1]];
          };
          const pt0 = getCorner(foundMap[0], 0); // sheet TL = marker 0 TL
          const pt1 = getCorner(foundMap[1], 1); // sheet TR = marker 1 TR
          const pt2 = getCorner(foundMap[2], 2); // sheet BR = marker 2 BR
          const pt3 = getCorner(foundMap[3], 3); // sheet BL = marker 3 BL
          const xs = [pt0[0], pt1[0], pt2[0], pt3[0]];
          const ys = [pt0[1], pt1[1], pt2[1], pt3[1]];
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          const boxW = maxX - minX, boxH = maxY - minY;
          const aspect = boxW / (boxH || 1);
          const expectedAspect = 180 / 250;
          const minFraction = 0.15;
          const validSize = boxW >= imageData.width * minFraction && boxH >= imageData.height * minFraction;
          const validAspect = aspect >= expectedAspect * 0.6 && aspect <= expectedAspect * 1.6;
          if (validSize && validAspect) {
            srcPts = matFromArrayF32Safe(4, 1, cv.CV_32FC2, [...pt0, ...pt1, ...pt2, ...pt3]);
            foundMarkers = true;
            console.log('[CV] ArUco: quad accepted', { boxW, boxH, aspect, corners: { tl: pt0, tr: pt1, br: pt2, bl: pt3 } });
          } else {
            console.log('[CV] ArUco: quad rejected (size or aspect)', { boxW, boxH, aspect, validSize, validAspect });
          }
          corners.delete(); ids.delete(); rejected.delete(); if (params) params.delete(); if (refineParams && typeof refineParams.delete === 'function') refineParams.delete();
        } else {
          console.log('[CV] ArUco: need ids 0,1,2,3, got', foundIds, '→ using fallback');
          corners.delete(); ids.delete(); rejected.delete(); if (params) params.delete(); if (refineParams && typeof refineParams.delete === 'function') refineParams.delete();
        }
      } else {
        console.log('[CV] ArUco: fewer than 4 markers detected → using fallback');
      }
    }
  } catch (e) {
    console.warn('[CV] ArUco detection failed, using fallback:', e);
  }

  if (!foundMarkers) console.log('[CV] Fallback: square marker detection');

  // Fallback: Square marker detection (original method)
  if (!foundMarkers) {
    let binary = new cv.Mat();
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
    
    let kernel = matOnesU8Safe(5, 5);
    cv.morphologyEx(binary, binary, cv.MORPH_CLOSE, kernel);
    kernel.delete();
    
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);
    
    let markers: any[] = [];
    const minArea = (imageData.width * imageData.height) * 0.0005;
    
    for (let i = 0; i < contours.size(); ++i) {
      let cnt = contours.get(i);
      let area = cv.contourArea(cnt);
      if (area < minArea) continue;
      
      let peri = cv.arcLength(cnt, true);
      let approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.04 * peri, true);
      
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        let rect = cv.boundingRect(approx);
        let aspect = rect.width / rect.height;
        if (aspect >= 0.8 && aspect <= 1.2) {
          let childIdx = hierarchy.intPtr(0, i)[2];
          if (childIdx !== -1) {
            let M = cv.moments(cnt);
            markers.push({ x: M.m10 / M.m00, y: M.m01 / M.m00 });
          }
        }
        approx.delete();
      } else {
        approx.delete();
      }
    }
    
    if (markers.length < 4) {
      src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
      throw new Error(`Found only ${markers.length} markers. Need 4.`);
    }
    
    markers.sort((a, b) => a.y - b.y);
    const top = markers.slice(0, 2).sort((a, b) => a.x - b.x);
    const bottom = markers.slice(2, 4).sort((a, b) => a.x - b.x);
    const corners = [top[0], top[1], bottom[1], bottom[0]];
    
    srcPts = matFromArrayF32Safe(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ]);
    
    binary.delete(); contours.delete(); hierarchy.delete();
    console.log('[CV] Fallback: markers found, srcPts set');
  }

  console.log('[CV] Perspective warp');
  // 2. Perspective Warp
  const dstW = CALIB_CONFIG.REAL_WIDTH_MM * CALIB_CONFIG.SCALE;
  const dstH = CALIB_CONFIG.REAL_HEIGHT_MM * CALIB_CONFIG.SCALE;
  const dstPts = matFromArrayF32Safe(4, 1, cv.CV_32FC2, [0, 0, dstW, 0, dstW, dstH, 0, dstH]);
  
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  cv.warpPerspective(src, warped, M, new cv.Size(dstW, dstH));
  console.log('[CV] Warp done, color calibration (gray ramp)');

  // 3. Color Calibration (Grayscale Ramp)
  const patchY = CALIB_CONFIG.GRAY_PATCH_Y_MM * CALIB_CONFIG.SCALE;
  const radius = Math.floor(1.5 * CALIB_CONFIG.SCALE);
  const observedRGBs: number[][] = [];
  
  for (const xMm of CALIB_CONFIG.GRAY_PATCH_XS_MM) {
    const patchX = xMm * CALIB_CONFIG.SCALE;
    const roi = warped.roi(new cv.Rect(patchX - radius, patchY - radius, radius * 2, radius * 2));
    const mean = cv.mean(roi);
    observedRGBs.push([mean[0], mean[1], mean[2]]);
    roi.delete();
  }
  
  const luts = {
    r: buildLut(observedRGBs.map(p => p[0]), CALIB_CONFIG.EXPECTED_LEVELS),
    g: buildLut(observedRGBs.map(p => p[1]), CALIB_CONFIG.EXPECTED_LEVELS),
    b: buildLut(observedRGBs.map(p => p[2]), CALIB_CONFIG.EXPECTED_LEVELS)
  };
  
  console.log('[CV] LUTs built');
  // 4. CMYK White Balance (for bean mode)
  let wbFactors = { r: 1.0, g: 1.0, b: 1.0 };
  if (mode === 'bean') {
    console.log('[CV] Bean mode: CMYK WB');
    const cmykY = CALIB_CONFIG.CMYK_PATCH_Y_MM * CALIB_CONFIG.SCALE;
    const cmykRadius = Math.floor(3 * CALIB_CONFIG.SCALE);
    const cmykObserved: number[][] = [];
    
    for (const xMm of CALIB_CONFIG.CMYK_PATCH_XS_MM) {
      const patchX = xMm * CALIB_CONFIG.SCALE;
      const roi = warped.roi(new cv.Rect(patchX - cmykRadius, cmykY - cmykRadius, cmykRadius * 2, cmykRadius * 2));
      const mean = cv.mean(roi);
      cmykObserved.push([mean[0], mean[1], mean[2]]);
      roi.delete();
    }
    
    // C+M+Y average for neutral estimate
    // NOTE: `cv.mean()` on our warped RGBA Mat returns channels in R,G,B,(A).
    const neutralR = (cmykObserved[0][0] + cmykObserved[1][0] + cmykObserved[2][0]) / 3;
    const neutralG = (cmykObserved[0][1] + cmykObserved[1][1] + cmykObserved[2][1]) / 3;
    const neutralB = (cmykObserved[0][2] + cmykObserved[1][2] + cmykObserved[2][2]) / 3;
    
    const targetNeutral = 128.0;
    wbFactors = {
      r: neutralR > 0 ? targetNeutral / neutralR : 1.0,
      g: neutralG > 0 ? targetNeutral / neutralG : 1.0,
      b: neutralB > 0 ? targetNeutral / neutralB : 1.0
    };
  }
  
  // 5. Stage Analysis
  // Extract ROI with 10mm margin from each edge (conservative crop)
  // Full stage: 100mm x 100mm, centered at (90mm, 115mm)
  // With 10mm margin: extract 80mm x 80mm from center
  const stageHalfSize = (CALIB_CONFIG.STAGE_SIZE_MM / 2) - CALIB_CONFIG.STAGE_MARGIN_MM;
  const stageX = (CALIB_CONFIG.STAGE_CENTER_X_MM - stageHalfSize) * CALIB_CONFIG.SCALE;
  const stageY = (CALIB_CONFIG.STAGE_CENTER_Y_MM - stageHalfSize) * CALIB_CONFIG.SCALE;
  const stageDim = (stageHalfSize * 2) * CALIB_CONFIG.SCALE;
  const stageRoi = warped.roi(new cv.Rect(stageX, stageY, stageDim, stageDim));
  console.log('[CV] Stage ROI extracted, calling', mode === 'grind' ? 'analyzeGrind' : 'analyzeBeans');

  let results: any;
  if (mode === 'grind') {
    results = analyzeGrind(stageRoi, luts, scaleCorrection);
  } else {
    results = analyzeBeans(stageRoi, luts, wbFactors, scaleCorrection);
  }

  // Debug: warped image with LUT/gamma applied, then overlay circles for gray and CMYK patches
  const warpedVis = warped.clone();
  applyLutToMatRGBA(warpedVis, luts);
  const green = new cv.Scalar(0, 255, 0, 255);   // BGR: gray ramp patches
  const magenta = new cv.Scalar(255, 0, 255, 255); // BGR: CMYK patches
  for (const xMm of CALIB_CONFIG.GRAY_PATCH_XS_MM) {
    const patchX = Math.round(xMm * CALIB_CONFIG.SCALE);
    const patchY = Math.round(CALIB_CONFIG.GRAY_PATCH_Y_MM * CALIB_CONFIG.SCALE);
    cv.circle(warpedVis, new cv.Point(patchX, patchY), radius, green, 2);
  }
  const cmykY = Math.round(CALIB_CONFIG.CMYK_PATCH_Y_MM * CALIB_CONFIG.SCALE);
  const cmykRadius = Math.floor(3 * CALIB_CONFIG.SCALE);
  for (const xMm of CALIB_CONFIG.CMYK_PATCH_XS_MM) {
    const patchX = Math.round(xMm * CALIB_CONFIG.SCALE);
    cv.circle(warpedVis, new cv.Point(patchX, cmykY), cmykRadius, magenta, 2);
  }
  results.warpedImageData = { data: Array.from(warpedVis.data), width: warpedVis.cols, height: warpedVis.rows };
  warpedVis.delete();

  // LUT curves for debugging (input 0..255 -> output value per channel)
  results.lutCurves = { r: Array.from(luts.r), g: Array.from(luts.g), b: Array.from(luts.b) };

  console.log('[CV] Analysis done, cleanup');
  // Cleanup
  src.delete(); gray.delete(); srcPts.delete(); dstPts.delete();
  M.delete(); warped.delete(); stageRoi.delete();

  return results;
}

function analyzeGrind(stageRoi: any, luts: any, scaleCorrection: number) {
  console.log('[CV] analyzeGrind start');

  const stageProc = stageRoi.clone();
  applyLutToMatRGBA(stageProc, luts);

  const gray = new cv.Mat();
  cv.cvtColor(stageProc, gray, cv.COLOR_RGBA2GRAY);

  // 1. Sharpen to catch fine particles and edges
  const graySmooth = new cv.Mat();
  cv.GaussianBlur(gray, graySmooth, new cv.Size(3, 3), 0);
  const graySharp = new cv.Mat();
  cv.addWeighted(gray, 1.5, graySmooth, -0.5, 0, graySharp);

  // 2. High Contrast to capture light brownish particles
  const grayContrast = new cv.Mat();
  cv.convertScaleAbs(graySharp, grayContrast, 2.5, -50);

  // 3. Threshold (Otsu, Inverted so dark particles -> white)
  const bw = new cv.Mat();
  cv.threshold(grayContrast, bw, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  // 4. Morphological Close to fill holes/mosaic without shrinking contours
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
  cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, kernel);
  kernel.delete();

  const mask = matZerosSafe(bw.rows, bw.cols, cv.CV_8UC1);
  const r = Math.floor(Math.min(bw.rows, bw.cols) * 0.48);
  cv.circle(mask, new cv.Point(bw.cols / 2, bw.rows / 2), r, new cv.Scalar(255), -1);
  cv.bitwise_and(bw, bw, bw, mask);

  console.log('[CV] analyzeGrind: findContours');
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bw, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  
  const minAreaPx = 10;
  const maxAreaPx = (bw.rows * bw.cols) * 0.20;
  const pixelScale = CALIB_CONFIG.SCALE / scaleCorrection; // pixels per mm

  const particles: any[] = [];
  const contourColors = [
    new cv.Scalar(0, 255, 0, 255),   // Green
    new cv.Scalar(0, 0, 255, 255),   // Red
    new cv.Scalar(255, 0, 0, 255),   // Blue
    new cv.Scalar(0, 255, 255, 255)  // Yellow
  ];
  const vis = stageProc.clone();

  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    
    if (area < minAreaPx || area > maxAreaPx) continue;
    if (cnt.rows < 5) continue; // Need 5 points for fitEllipse

    const ellipse = cv.fitEllipse(cnt);
    const MA = Math.max(ellipse.size.width, ellipse.size.height);
    const ma = Math.min(ellipse.size.width, ellipse.size.height);
    
    const majorMm = MA / pixelScale;
    const minorMm = ma / pixelScale;
    
    // Filter clumps
    if (majorMm > 3.0) continue;

    // Calculate Surface and Volume (ellipsoid approximation)
    // Surface (projected) in mm^2
    const surfaceMm2 = area / (pixelScale * pixelScale);
    
    // Volume in mm^3. Assume 3rd axis = minor axis (oblate spheroid) or calculate like python script
    // Python script: short_axis = surface/(pi * axis) -> volume = pi * short_axis^2 * axis
    // Our surfaceMm2 is the projected area. 
    // Python script logic: short_axis = surface / (pi * long_axis). 
    // Wait, area of ellipse = pi * a * b. so b = Area / (pi * a). 
    // So minorMm (calculated from area) = surfaceMm2 / (Math.PI * (majorMm / 2)) * 2?
    // Let's stick to fitEllipse minor axis if available, or use area-based if fit is bad.
    // The python script derives short axis from surface area to ensure consistency.
    // Let's use the Python script method for volume to match its logic.
    // axis = majorMm / 2 (semi-major) ? No, script says "axis" is diameter.
    // "axis = np.max(dlist)" -> diameter.
    // "short_axis = surface/(np.pi*axis)". Area = pi * (L/2) * (S/2) = pi/4 * L * S.
    // So S = 4 * Area / (pi * L). 
    // The script uses: short_axis = surface / (pi * axis) -> this implies Area = pi * L * S? 
    // No, maybe axis is semi-major? 
    // "dlist = np.sqrt(...); axis = np.max(dlist)" -> dlist is dist from centroid. So axis is Radius (Semi-major).
    // So Area = pi * axis * short_axis (semi-minor). Correct.
    // So short_axis = Area / (pi * axis).
    // Volume = 4/3 * pi * axis * short_axis^2 (if ellipsoid with 2 short axes).
    // The script says: "volume = np.pi*short_axis**2*axis". 
    // If axis is semi-major (a) and short_axis is semi-minor (b=c).
    // Vol = 4/3 * pi * a * b * c = 4/3 * pi * a * b^2.
    // The script uses just pi * ... maybe omitting 4/3? Or assuming something else.
    // I will use standard ellipsoid volume: 4/3 * pi * (major/2) * (minor/2)^2.
    
    const volMm3 = (4/3) * Math.PI * (majorMm/2) * Math.pow(minorMm/2, 2);

    // Calculate Available Mass and Extraction Yield
    const attainableVol = calculateAttainableVolume(volMm3, majorMm/2, minorMm/2);
    const ey = calculateExtractionYield(surfaceMm2);

    particles.push({
      majorMm,
      minorMm,
      areaPx: area,
      surfaceMm2,
      volMm3,
      attainableVol, // proportional to available mass (assuming constant density)
      ey // extraction yield
    });

    // Draw contour
    const color = contourColors[i % contourColors.length];
    cv.drawContours(vis, contours, i, color, 1);
  }

  // Filter outliers: Discard particles in high-end bins with very few counts.
  // 1. Build a temporary histogram of majorMm (0.1mm bins)
  const binSize = 0.1;
  const maxVal = Math.max(...particles.map(p => p.majorMm));
  const numBins = Math.ceil(maxVal / binSize) + 1;
  const counts = new Array(numBins).fill(0);
  
  for (const p of particles) {
    const bin = Math.floor(p.majorMm / binSize);
    counts[bin]++;
  }

  // 2. Find the cut-off threshold
  // We look from the right (largest bins) towards the left.
  // If a bin has very few particles (e.g. < 3) and is far from the main mode, it's likely noise.
  // However, we must be careful not to cut the main distribution if it's wide.
  // Strategy: Find the peak (mode). Then from the far right, find the first bin that has significant data.
  // Everything to the right of that "significant" bin is considered outlier noise if it's sparse.
  
  const peakBin = counts.indexOf(Math.max(...counts));
  let cutOffMm = 3.0; // Default hard limit

  // Start from the end, find first bin with >= 3 particles (arbitrary small number to filter single/double noise)
  // But we only cut if we are to the right of the peak.
  for (let i = numBins - 1; i > peakBin; i--) {
    if (counts[i] >= 3) {
      // Found significant data. The cut-off is the end of this bin.
      cutOffMm = (i + 1) * binSize;
      break;
    }
  }
  
  // Apply filtering
  const filteredParticles = particles.filter(p => p.majorMm <= cutOffMm);
  console.log(`[CV] Outlier filtering: cut-off ${cutOffMm.toFixed(2)}mm. Removed ${particles.length - filteredParticles.length} particles.`);

  const stageImageData = { data: Array.from(vis.data), width: vis.cols, height: vis.rows };
  
  vis.delete(); contours.delete(); hierarchy.delete();
  gray.delete(); graySmooth.delete(); graySharp.delete(); grayContrast.delete(); bw.delete(); mask.delete();
  // labels.delete(); stats.delete(); centroids.delete(); // No longer used
  stageProc.delete();

  return { mode: 'grind', particles: filteredParticles, stageImageData };
}

// Based on Jonathan Gagné's research
function calculateAttainableVolume(totalVolume: number, _semiMajor: number, _semiMinor: number): number {
  const depthLimit = 0.1; // mm
  // Equivalent radius of a sphere with same volume
  const r_eq = Math.pow((3/4 * totalVolume / Math.PI), 1/3);
  
  if (r_eq <= depthLimit) {
    return totalVolume;
  }
  
  // Unreachable volume (core sphere)
  const unreachable = (4/3) * Math.PI * Math.pow(r_eq - depthLimit, 3);
  return Math.max(0, totalVolume - unreachable);
}

function calculateExtractionYield(surfaceMm2: number): number {
  const k_reference = 0.25014;
  const extraction_limit = 0.3; // 30%
  const extraction_speed = 1.0 / surfaceMm2;
  return (extraction_speed / (k_reference + extraction_speed)) * extraction_limit;
}

/** Apply white balance factors to an RGBA Mat in place (channel order R,G,B,A). */
function applyWhiteBalanceToMatRGBA(mat: any, wbFactors: { r: number; g: number; b: number }) {
  const data = mat.data;
  const len = mat.rows * mat.cols * 4;
  for (let i = 0; i < len; i += 4) {
    data[i] = Math.min(255, Math.max(0, Math.round(data[i] * wbFactors.r)));         // R
    data[i + 1] = Math.min(255, Math.max(0, Math.round(data[i + 1] * wbFactors.g))); // G
    data[i + 2] = Math.min(255, Math.max(0, Math.round(data[i + 2] * wbFactors.b))); // B
    // A channel unchanged
  }
}

function analyzeBeans(stageRoi: any, luts: any, wbFactors: any, scaleCorrection: number) {
  console.log('[CV] analyzeBeans start');

  // Post-process the cropped stage image ONCE, then use it for:
  // - segmentation (thresholding/contours)
  // - per-bean color measurement
  // - outline preview
  const stageProc = stageRoi.clone();
  applyLutToMatRGBA(stageProc, luts);
  applyWhiteBalanceToMatRGBA(stageProc, wbFactors);

  const gray = new cv.Mat();
  cv.cvtColor(stageProc, gray, cv.COLOR_RGBA2GRAY);

  // Denoise first
  const grayBlurred = new cv.Mat();
  cv.GaussianBlur(gray, grayBlurred, new cv.Size(5, 5), 0);
  
  // Background removal - use larger sigma to better smooth out grid patterns
  const bg = new cv.Mat();
  cv.GaussianBlur(grayBlurred, bg, new cv.Size(0, 0), 40); // Increased from 30 to 40 to better remove grid
  const diff = new cv.Mat();
  cv.subtract(bg, grayBlurred, diff);
  cv.normalize(diff, diff, 0, 255, cv.NORM_MINMAX);

  // Higher threshold to avoid detecting grid lines (was 15, now 25)
  const bw = new cv.Mat();
  cv.threshold(diff, bw, 25, 255, cv.THRESH_BINARY);

  // Morphological operations - use smaller kernel and fewer iterations to avoid connecting grid lines
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)); // Smaller kernel (was 5x5)
  // Close to fill small gaps in beans, but fewer iterations
  cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1); // Reduced from 2 to 1
  // Open to remove small noise
  cv.morphologyEx(bw, bw, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 1);

  // Apply rectangular mask (stage is already cropped with 10mm margin, so use full ROI with small safety margin)
  const marginPx = Math.floor(2 * CALIB_CONFIG.SCALE); // 2mm safety margin to avoid edge artifacts
  const mask = matZerosSafe(bw.rows, bw.cols, cv.CV_8UC1);
  const topLeft = new cv.Point(marginPx, marginPx);
  const bottomRight = new cv.Point(bw.cols - marginPx, bw.rows - marginPx);
  cv.rectangle(mask, topLeft, bottomRight, new cv.Scalar(255), -1);
  cv.bitwise_and(bw, bw, bw, mask);

  console.log('[CV] analyzeBeans: findContours');
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bw, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const nContours = contours.size();
  console.log('[CV] analyzeBeans: contours', nContours, 'bean loop start');

  const beans: any[] = [];
  const minArea = 50;

  for (let i = 0; i < nContours; i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < minArea) continue;
    
    if (cnt.rows >= 5) {
      const ellipse = cv.fitEllipse(cnt);
      const MA = ellipse.size.width;
      const ma = ellipse.size.height;
      
      // Filter out long thin shapes (grid lines) - beans should be roughly circular/elliptical
      // Aspect ratio: major/minor should be reasonable for beans (typically < 2.5)
      const aspectRatio = Math.max(MA, ma) / (Math.min(MA, ma) || 1);
      if (aspectRatio > 3.0) {
        console.log('[CV] analyzeBeans: filtered contour with aspect ratio', aspectRatio.toFixed(2));
        continue; // Skip grid lines and other elongated shapes
      }
      
      const majorMm = Math.max(MA, ma) / CALIB_CONFIG.SCALE * scaleCorrection;
      const minorMm = Math.min(MA, ma) / CALIB_CONFIG.SCALE * scaleCorrection;
      
      const beanMask = matZerosSafe(stageRoi.rows, stageRoi.cols, cv.CV_8UC1);
      cv.drawContours(beanMask, contours, i, new cv.Scalar(255), -1);
      const meanColor = cv.mean(stageProc, beanMask);
      
      // stageProc is already LUT + WB corrected; meanColor channels are R,G,B,(A).
      const r = Math.min(255, Math.max(0, meanColor[0]));
      const g = Math.min(255, Math.max(0, meanColor[1]));
      const b = Math.min(255, Math.max(0, meanColor[2]));
      
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      
      beans.push({ majorMm, minorMm, r, g, b, luma });
      beanMask.delete();
    }
  }

  console.log('[CV] analyzeBeans done, beans:', beans.length);

  // Draw bean outlines on the post-processed image (preview == analyzed pixels)
  // IMPORTANT: stageProc is RGBA; include alpha=255 so outlines are visible in the preview.
  const green = new cv.Scalar(0, 255, 0, 255);
  for (let i = 0; i < nContours; i++) {
    const cnt = contours.get(i);
    if (cv.contourArea(cnt) >= minArea && cnt.rows >= 5) cv.drawContours(stageProc, contours, i, green, 4);
    console.log('[CV] analyzeBeans: contour', i, 'area', cv.contourArea(cnt), 'x', cnt.data32F[0], 'y', cnt.data32F[1]);
  }
  const stageImageData = { data: Array.from(stageProc.data), width: stageProc.cols, height: stageProc.rows };

  gray.delete(); grayBlurred.delete(); bg.delete(); diff.delete(); bw.delete(); kernel.delete();
  mask.delete(); contours.delete(); hierarchy.delete();
  stageProc.delete();

  return { mode: 'bean', beans, stageImageData };
}

function buildLut(observed: number[], expected: number[]): Uint8Array {
  const lut = new Uint8Array(256);
  const points = observed.map((val, i) => ({ x: val, y: expected[i] })).sort((a, b) => a.x - b.x);
  
  for (let i = 0; i < 256; i++) {
    if (i <= points[0].x) {
      lut[i] = points[0].y;
    } else if (i >= points[points.length - 1].x) {
      lut[i] = points[points.length - 1].y;
    } else {
      for (let j = 0; j < points.length - 1; j++) {
        if (i >= points[j].x && i <= points[j + 1].x) {
          const range = points[j+1].x - points[j].x;
          const ratio = range === 0 ? 0 : (i - points[j].x) / range;
          lut[i] = Math.round(points[j].y + ratio * (points[j+1].y - points[j].y));
          break;
        }
      }
    }
  }
  return lut;
}

/** Apply R/G/B LUTs to an RGBA Mat in place (channel order R,G,B,A). Used for debug warped image. */
function applyLutToMatRGBA(mat: any, luts: { r: Uint8Array; g: Uint8Array; b: Uint8Array }) {
  const data = mat.data;
  const len = mat.rows * mat.cols * 4;
  for (let i = 0; i < len; i += 4) {
    data[i] = luts.r[data[i]];
    data[i + 1] = luts.g[data[i + 1]];
    data[i + 2] = luts.b[data[i + 2]];
  }
}

export {};
