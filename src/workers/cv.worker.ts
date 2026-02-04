// CV Worker Implementation

// Define message types
type WorkerMessage = 
  | { type: 'INIT' }
  | { type: 'PROCESS_IMAGE', payload: { 
      imageData: ImageData, 
      width: number, 
      height: number 
    } 
  };

// Global OpenCV instance
declare const cv: any;

// Configuration based on Calibration Sheet Spec
const CALIB_CONFIG = {
  // Physical dimensions in mm (from generate_calibration_sheet.py)
  REAL_WIDTH_MM: 180,
  REAL_HEIGHT_MM: 250,
  MARKER_SIZE_MM: 10,
  
  // Grayscale Patch Centers in Warped Image Coordinates (mm)
  // Updated for 11-step ramp
  // PDF Logic:
  //   patch_start_y (CMYK) = margin_y + 215mm.
  //   gray_y = patch_start_y - (8mm + 6mm) = 215 - 14 = 201mm (relative to margin bottom).
  //   Image Y (from Top 250mm) = 250 - 201 = 49mm.
  //   Patch Height 8mm. Center Y = 49 + 4 = 53mm.
  //
  //   X Logic:
  //   Right aligned with CMYK end.
  //   CMYK End X (rel margin) = 100mm (Start) + 4*12 + 3*2 = 100 + 48 + 6 = 154mm.
  //   Gray Row Width = 11*8 + 10*1.5 = 88 + 15 = 103mm.
  //   Gray Start X = 154 - 103 = 51mm.
  //   Step X = 8 + 1.5 = 9.5mm.
  //   Centers X = 51 + 4 + i*9.5 = 55 + i*9.5
  
  GRAY_PATCH_Y_MM: 53,
  GRAY_PATCH_XS_MM: Array.from({length: 11}, (_, i) => 55 + i * 9.5), // 0% to 100%

  // Expected Grayscale Values (0-255) for the patches (0%, 10%, ... 100% Ink)
  // 0% Ink = 255 (White), 100% Ink = 20 (Black approx)
  // Linear ramp expectation
  EXPECTED_LEVELS: Array.from({length: 11}, (_, i) => Math.round(255 - (i * (255 - 20) / 10)))
};

let isCvReady = false;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === 'INIT') {
    try {
        // Load OpenCV.js from CDN (reliable source)
        // @ts-ignore
        importScripts('https://docs.opencv.org/4.8.0/opencv.js');
        
        // Wait for runtime
        if (cv.getBuildInformation) {
             console.log('OpenCV Loaded:', cv.getBuildInformation());
             isCvReady = true;
             postMessage({ type: 'CV_READY' });
        } else {
            cv['onRuntimeInitialized'] = () => {
                isCvReady = true;
                console.log('OpenCV Ready (Async)');
                postMessage({ type: 'CV_READY' });
            };
        }
    } catch (err) {
        console.error('Failed to load OpenCV', err);
        postMessage({ type: 'ERROR', payload: 'Failed to load OpenCV' });
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

function processImage(input: { imageData: ImageData, width: number, height: number }) {
  const { imageData, width, height } = input;
  
  // 1. Read Image
  let src = cv.matFromImageData(imageData);
  let gray = new cv.Mat();
  
  // Convert to Grayscale for detection
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  
  // 2. Detect Markers (The 4 black squares at corners)
  // Threshold to find black markers
  let binary = new cv.Mat();
  cv.threshold(gray, binary, 80, 255, cv.THRESH_BINARY_INV);
  
  let contours = new cv.MatVector();
  let hierarchy = new cv.Mat();
  cv.findContours(binary, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

  // Find the 4 corner markers
  let markers = [];
  const minArea = (width * height) * 0.001; // minimal size constraint
  
  for (let i = 0; i < contours.size(); ++i) {
    let cnt = contours.get(i);
    let area = cv.contourArea(cnt);
    if (area < minArea) continue;
    
    let peri = cv.arcLength(cnt, true);
    let approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.04 * peri, true);
    
    // Check if square (4 corners)
    if (approx.rows === 4) {
      let M = cv.moments(cnt);
      let cx = M.m10 / M.m00;
      let cy = M.m01 / M.m00;
      markers.push({ x: cx, y: cy, approx: approx });
    } else {
        approx.delete();
    }
  }

  if (markers.length < 4) {
    src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
    throw new Error(`Found only ${markers.length} markers. Need 4.`);
  }

  // Sort markers to TopLeft, TopRight, BottomRight, BottomLeft
  markers.sort((a, b) => a.y - b.y);
  const top = markers.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = markers.slice(2, 4).sort((a, b) => a.x - b.x);
  const corners = [top[0], top[1], bottom[1], bottom[0]]; // TL, TR, BR, BL

  // 3. Perspective Warp (Homography)
  // Target dimensions (pixels) - we can scale this up for resolution
  const scale = 4; // 1mm = 4 pixels (approx 100 DPI)
  const dstWidth = CALIB_CONFIG.REAL_WIDTH_MM * scale;
  const dstHeight = CALIB_CONFIG.REAL_HEIGHT_MM * scale;

  // Marker offsets (center of 10mm square is 5mm from corner edge)
  const offset = CALIB_CONFIG.MARKER_SIZE_MM / 2 * scale;
  const w = CALIB_CONFIG.REAL_WIDTH_MM * scale;
  const h = CALIB_CONFIG.REAL_HEIGHT_MM * scale;

  let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners[0].x, corners[0].y,
    corners[1].x, corners[1].y,
    corners[2].x, corners[2].y,
    corners[3].x, corners[3].y
  ]);
  
  let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    offset, offset,          // TL
    w - offset, offset,      // TR
    w - offset, h - offset,  // BR
    offset, h - offset       // BL
  ]);

  let M = cv.getPerspectiveTransform(srcTri, dstTri);
  let warped = new cv.Mat();
  cv.warpPerspective(src, warped, M, new cv.Size(dstWidth, dstHeight));

  // 4. Advanced Color Calibration (Grayscale Ramp)
  // We sample all 11 patches to build a per-channel Look-Up Table (LUT)
  
  const patchY = CALIB_CONFIG.GRAY_PATCH_Y_MM * scale;
  const sampleRadius = 1.5 * scale; // Reduce radius slightly for smaller patches
  
  // Store observed mean RGB for each patch
  const observedRGBs: number[][] = [];
  
  CALIB_CONFIG.GRAY_PATCH_XS_MM.forEach(x_mm => {
    const patchX = x_mm * scale;
    let patchRoi = warped.roi(new cv.Rect(
        patchX - sampleRadius, 
        patchY - sampleRadius, 
        sampleRadius * 2, 
        sampleRadius * 2
    ));
    let mean = cv.mean(patchRoi); // [R, G, B, A]
    observedRGBs.push([mean[0], mean[1], mean[2]]);
    patchRoi.delete();
  });

  // Build Look-Up Tables for R, G, B
  const luts = {
    r: buildLut(observedRGBs.map(p => p[0]), CALIB_CONFIG.EXPECTED_LEVELS),
    g: buildLut(observedRGBs.map(p => p[1]), CALIB_CONFIG.EXPECTED_LEVELS),
    b: buildLut(observedRGBs.map(p => p[2]), CALIB_CONFIG.EXPECTED_LEVELS)
  };

  // 5. Bean Analysis (Central Stage)
  // Stage Center: (90mm, 125mm)
  // Radius: 50mm
  // We'll crop to this area to find beans
  let stageX = (90 - 50) * scale;
  let stageY = (125 - 50) * scale;
  let stageW = 100 * scale;
  let stageH = 100 * scale;
  
  let stageRoi = warped.roi(new cv.Rect(stageX, stageY, stageW, stageH));
  
  let stageGray = new cv.Mat();
  cv.cvtColor(stageRoi, stageGray, cv.COLOR_RGBA2GRAY);
  cv.threshold(stageGray, stageGray, 100, 255, cv.THRESH_BINARY_INV);
  
  let beanContours = new cv.MatVector();
  let beanHierarchy = new cv.Mat();
  cv.findContours(stageGray, beanContours, beanHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  
  let beanData = [];
  const minBeanArea = 5 * scale * scale; 
  
  for (let i = 0; i < beanContours.size(); ++i) {
    let bCnt = beanContours.get(i);
    let area = cv.contourArea(bCnt);
    if (area < minBeanArea) continue;
    
    // Fit Ellipse
    if (bCnt.rows >= 5) {
        let ellipse = cv.fitEllipse(bCnt);
        let majorAxis = Math.max(ellipse.size.width, ellipse.size.height) / scale;
        let minorAxis = Math.min(ellipse.size.width, ellipse.size.height) / scale;
        
        // Get Color from original ROI
        let mask = new cv.Mat.zeros(stageRoi.rows, stageRoi.cols, cv.CV_8UC1);
        cv.drawContours(mask, beanContours, i, new cv.Scalar(255), -1);
        let meanBeanColor = cv.mean(stageRoi, mask);
        mask.delete();
        
        // Apply Correction LUTs
        let r = applyLut(meanBeanColor[0], luts.r);
        let g = applyLut(meanBeanColor[1], luts.g);
        let b = applyLut(meanBeanColor[2], luts.b);
        
        let luma = 0.299*r + 0.587*g + 0.114*b;

        beanData.push({
            majorMm: majorAxis,
            minorMm: minorAxis,
            color: { r, g, b, luma }
        });
    }
  }

  // Cleanup
  src.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
  srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
  stageRoi.delete(); stageGray.delete(); beanContours.delete(); beanHierarchy.delete();

  return {
    wbFactors: { 
        r: 127 / (observedRGBs[5] ? observedRGBs[5][0] : 1), // 50% is index 5
        g: 127 / (observedRGBs[5] ? observedRGBs[5][1] : 1), 
        b: 127 / (observedRGBs[5] ? observedRGBs[5][2] : 1) 
    },
    beans: beanData,
    debugUrl: ''
  };
}

// Helper: Build a 256-element LUT using linear interpolation between known points
function buildLut(observed: number[], expected: number[]): Uint8Array {
    const lut = new Uint8Array(256);
    
    // Sort pairs by observed value
    const points = observed.map((val, i) => ({ x: val, y: expected[i] }));
    points.sort((a, b) => a.x - b.x);

    for (let i = 0; i < 256; i++) {
        if (i <= points[0].x) {
            lut[i] = points[0].y; 
        } else if (i >= points[points.length - 1].x) {
            lut[i] = points[points.length - 1].y;
        } else {
            for (let j = 0; j < points.length - 1; j++) {
                if (i >= points[j].x && i <= points[j + 1].x) {
                    const range = points[j+1].x - points[j].x;
                    const ratio = (range === 0) ? 0 : (i - points[j].x) / range;
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
