// CV Worker Implementation - Ported from test_cv.py and test_bean_cv.py

type AnalysisMode = 'grind' | 'bean';

type WorkerMessage = 
  | { type: 'INIT' }
  | { type: 'PROCESS_IMAGE', payload: { 
      imageData: ImageData, 
      width: number, 
      height: number,
      rulerLengthMm: number,
      mode: AnalysisMode
    } 
  };

declare const cv: any;

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
  STAGE_RADIUS_MM: 50,
  SCALE: 20  // Higher resolution for better detection
};

let isCvReady = false;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'INIT') {
    try {
        // Load custom OpenCV.js with ArUco from public directory
        // @ts-ignore
        importScripts('/opencv.js');
        
        if (cv.getBuildInformation) {
             isCvReady = true;
             postMessage({ type: 'CV_READY' });
        } else {
            cv['onRuntimeInitialized'] = () => {
                isCvReady = true;
                postMessage({ type: 'CV_READY' });
            };
        }
    } catch (err) {
        console.error('Failed to load OpenCV', err);
        postMessage({ type: 'ERROR', payload: 'Failed to load OpenCV. Make sure opencv.js is in public/ directory.' });
    }
  } 
  else if (msg.type === 'PROCESS_IMAGE' && isCvReady) {
    try {
      const result = processImage(msg.payload);
      postMessage({ type: 'ANALYSIS_COMPLETE', payload: result });
    } catch (error: any) {
      console.error('CV Processing Error:', error);
      postMessage({ type: 'ERROR', payload: error.message });
    }
  }
};

function processImage(input: { imageData: ImageData, width: number, height: number, rulerLengthMm: number, mode: AnalysisMode }) {
  const { imageData, rulerLengthMm, mode } = input;
  const scaleCorrection = rulerLengthMm / 100.0;
  
  let src = cv.matFromImageData(imageData);
  let gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  
  // 1. Detect ArUco Markers
  // Try ArUco first, fallback to square detection if not available
  let srcPts: any;
  let foundMarkers = false;
  
  try {
    // Check if ArUco is available
    if (cv.aruco && cv.aruco.getPredefinedDictionary) {
      const arucoDict = cv.aruco.getPredefinedDictionary(cv.aruco.DICT_4X4_50);
      const params = new cv.aruco.DetectorParameters();
      params.cornerRefinementMethod = cv.aruco.CORNER_REFINE_SUBPIX;
      
      const corners = new cv.MatVector();
      const ids = new cv.Mat();
      const rejected = new cv.Mat();
      
      cv.aruco.detectMarkers(gray, arucoDict, corners, ids, params, rejected);
      
      if (ids.rows >= 4) {
        // Organize by ID
        const foundMap: {[key: number]: any} = {};
        for (let i = 0; i < ids.rows; i++) {
          const id = ids.intPtr(i, 0)[0];
          if (id >= 0 && id <= 3) {
            foundMap[id] = corners.get(i);
          }
        }
        
        if (Object.keys(foundMap).length >= 4) {
          // Extract outer corners from ArUco markers
          // Each corner is a 4x1 Mat with 4 points (corners of the marker)
          const getOuterCorner = (marker: any, cornerIdx: number) => {
            // cornerIdx: 0=TL, 1=TR, 2=BR, 3=BL of the marker
            return [marker.data32F[cornerIdx * 2], marker.data32F[cornerIdx * 2 + 1]];
          };
          
          srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            ...getOuterCorner(foundMap[0], 0), // ID 0 = TL marker, use its TL corner
            ...getOuterCorner(foundMap[1], 1), // ID 1 = TR marker, use its TR corner
            ...getOuterCorner(foundMap[2], 2), // ID 2 = BR marker, use its BR corner
            ...getOuterCorner(foundMap[3], 3)  // ID 3 = BL marker, use its BL corner
          ]);
          foundMarkers = true;
          
          corners.delete(); ids.delete(); rejected.delete(); params.delete();
        }
      }
    }
  } catch (e) {
    console.warn('ArUco detection failed, using fallback:', e);
  }
  
  // Fallback: Square marker detection (original method)
  if (!foundMarkers) {
    let binary = new cv.Mat();
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
    
    let kernel = cv.Mat.ones(5, 5, cv.CV_8U);
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
    
    srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ]);
    
    binary.delete(); contours.delete(); hierarchy.delete();
  }
  
  // 2. Perspective Warp
  const dstW = CALIB_CONFIG.REAL_WIDTH_MM * CALIB_CONFIG.SCALE;
  const dstH = CALIB_CONFIG.REAL_HEIGHT_MM * CALIB_CONFIG.SCALE;
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, dstW, 0, dstW, dstH, 0, dstH]);
  
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  cv.warpPerspective(src, warped, M, new cv.Size(dstW, dstH));
  
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
  
  // 4. CMYK White Balance (for bean mode)
  let wbFactors = { r: 1.0, g: 1.0, b: 1.0 };
  if (mode === 'bean') {
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
    const neutralB = (cmykObserved[0][0] + cmykObserved[1][0] + cmykObserved[2][0]) / 3;
    const neutralG = (cmykObserved[0][1] + cmykObserved[1][1] + cmykObserved[2][1]) / 3;
    const neutralR = (cmykObserved[0][2] + cmykObserved[1][2] + cmykObserved[2][2]) / 3;
    
    const targetNeutral = 128.0;
    wbFactors = {
      r: neutralR > 0 ? targetNeutral / neutralR : 1.0,
      g: neutralG > 0 ? targetNeutral / neutralG : 1.0,
      b: neutralB > 0 ? targetNeutral / neutralB : 1.0
    };
  }
  
  // 5. Stage Analysis
  const stageX = (CALIB_CONFIG.STAGE_CENTER_X_MM - CALIB_CONFIG.STAGE_RADIUS_MM) * CALIB_CONFIG.SCALE;
  const stageY = (CALIB_CONFIG.STAGE_CENTER_Y_MM - CALIB_CONFIG.STAGE_RADIUS_MM) * CALIB_CONFIG.SCALE;
  const stageDim = CALIB_CONFIG.STAGE_RADIUS_MM * 2 * CALIB_CONFIG.SCALE;
  const stageRoi = warped.roi(new cv.Rect(stageX, stageY, stageDim, stageDim));
  
  let results: any;
  if (mode === 'grind') {
    results = analyzeGrind(stageRoi, luts, scaleCorrection);
  } else {
    results = analyzeBeans(stageRoi, luts, wbFactors, scaleCorrection);
  }
  
  // Cleanup
  src.delete(); gray.delete(); srcPts.delete(); dstPts.delete();
  M.delete(); warped.delete(); stageRoi.delete();
  
  return results;
}

function analyzeGrind(stageRoi: any, luts: any, scaleCorrection: number) {
  const gray = new cv.Mat();
  cv.cvtColor(stageRoi, gray, cv.COLOR_RGBA2GRAY);
  
  // DoG filtering for fine particles
  const grayDn = new cv.Mat();
  cv.fastNlMeansDenoising(gray, grayDn, 10, 7, 21);
  
  const bg = new cv.Mat();
  cv.GaussianBlur(grayDn, bg, new cv.Size(0, 0), 25);
  const hp = new cv.Mat();
  cv.subtract(bg, grayDn, hp);
  
  const g1 = new cv.Mat(), g2 = new cv.Mat();
  cv.GaussianBlur(hp, g1, new cv.Size(0, 0), 0.8);
  cv.GaussianBlur(hp, g2, new cv.Size(0, 0), 1.6);
  const dog = new cv.Mat();
  cv.subtract(g1, g2, dog);
  cv.normalize(dog, dog, 0, 255, cv.NORM_MINMAX);
  
  const bw = new cv.Mat();
  cv.threshold(dog, bw, 20, 255, cv.THRESH_BINARY);
  
  // Circular mask
  const mask = new cv.Mat.zeros(bw.rows, bw.cols, cv.CV_8UC1);
  const r = Math.floor(Math.min(bw.rows, bw.cols) * 0.48);
  cv.circle(mask, new cv.Point(bw.cols / 2, bw.rows / 2), r, new cv.Scalar(255), -1);
  cv.bitwise_and(bw, bw, bw, mask);
  
  // Connected components
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const num = cv.connectedComponentsWithStats(bw, labels, stats, centroids, 8);
  
  const particles: any[] = [];
  for (let i = 1; i < num; i++) {
    const area = stats.intPtr(i, cv.CC_STAT_AREA)[0];
    if (area < 1) continue;
    
    const cx = centroids.doublePtr(i, 0)[0];
    const cy = centroids.doublePtr(i, 1)[0];
    
    // Size estimate
    const majorMm = (Math.sqrt(area / Math.PI) * 2) / CALIB_CONFIG.SCALE * scaleCorrection;
    
    // Color (sample small region)
    const sampleMask = new cv.Mat.zeros(stageRoi.rows, stageRoi.cols, cv.CV_8UC1);
    cv.circle(sampleMask, new cv.Point(cx, cy), 2, new cv.Scalar(255), -1);
    const meanColor = cv.mean(stageRoi, sampleMask);
    
    const r = applyLut(meanColor[2], luts.r);
    const g = applyLut(meanColor[1], luts.g);
    const b = applyLut(meanColor[0], luts.b);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    
    particles.push({
      majorMm,
      minorMm: majorMm,
      areaPx: area,
      r, g, b, luma
    });
    
    sampleMask.delete();
  }
  
  gray.delete(); grayDn.delete(); bg.delete(); hp.delete(); g1.delete(); g2.delete();
  dog.delete(); bw.delete(); mask.delete(); labels.delete(); stats.delete(); centroids.delete();
  
  return { mode: 'grind', particles };
}

function analyzeBeans(stageRoi: any, luts: any, wbFactors: any, scaleCorrection: number) {
  const gray = new cv.Mat();
  cv.cvtColor(stageRoi, gray, cv.COLOR_RGBA2GRAY);
  
  cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
  const bg = new cv.Mat();
  cv.GaussianBlur(gray, bg, new cv.Size(0, 0), 30);
  const diff = new cv.Mat();
  cv.subtract(bg, gray, diff);
  cv.normalize(diff, diff, 0, 255, cv.NORM_MINMAX);
  
  const bw = new cv.Mat();
  cv.threshold(diff, bw, 15, 255, cv.THRESH_BINARY);
  
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  cv.morphologyEx(bw, bw, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
  cv.morphologyEx(bw, bw, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 1);
  
  const mask = new cv.Mat.zeros(bw.rows, bw.cols, cv.CV_8UC1);
  const r = Math.floor(Math.min(bw.rows, bw.cols) * 0.48);
  cv.circle(mask, new cv.Point(bw.cols / 2, bw.rows / 2), r, new cv.Scalar(255), -1);
  cv.bitwise_and(bw, bw, bw, mask);
  
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(bw, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  
  const beans: any[] = [];
  const minArea = 50;
  
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area < minArea) continue;
    
    if (cnt.rows >= 5) {
      const ellipse = cv.fitEllipse(cnt);
      const MA = ellipse.size.width;
      const ma = ellipse.size.height;
      const majorMm = Math.max(MA, ma) / CALIB_CONFIG.SCALE * scaleCorrection;
      const minorMm = Math.min(MA, ma) / CALIB_CONFIG.SCALE * scaleCorrection;
      
      const beanMask = new cv.Mat.zeros(stageRoi.rows, stageRoi.cols, cv.CV_8UC1);
      cv.drawContours(beanMask, contours, i, new cv.Scalar(255), -1);
      const meanColor = cv.mean(stageRoi, beanMask);
      
      let r = applyLut(meanColor[2], luts.r);
      let g = applyLut(meanColor[1], luts.g);
      let b = applyLut(meanColor[0], luts.b);
      
      // Apply WB
      r = Math.min(255, Math.max(0, r * wbFactors.r));
      g = Math.min(255, Math.max(0, g * wbFactors.g));
      b = Math.min(255, Math.max(0, b * wbFactors.b));
      
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      
      beans.push({ majorMm, minorMm, r, g, b, luma });
      beanMask.delete();
    }
  }
  
  gray.delete(); bg.delete(); diff.delete(); bw.delete(); kernel.delete();
  mask.delete(); contours.delete(); hierarchy.delete();
  
  return { mode: 'bean', beans };
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

function applyLut(val: number, lut: Uint8Array): number {
  const idx = Math.max(0, Math.min(255, Math.round(val)));
  return lut[idx];
}

export {};
