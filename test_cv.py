import cv2
import numpy as np
import argparse
import sys
import matplotlib.pyplot as plt
import csv
import os

# ---------------------------------------------------------
# CONFIGURATION (Must match src/workers/cv.worker.ts)
# ---------------------------------------------------------
REAL_WIDTH_MM = 180
REAL_HEIGHT_MM = 250
MARKER_SIZE_MM = 15 # Updated to 15mm ArUco

# Grayscale Patch Config (11 steps)
GRAY_PATCH_Y_MM = 53
GRAY_PATCH_XS_MM = [55 + i * 9.5 for i in range(11)]
EXPECTED_LEVELS = [int(255 - (i * (255 - 20) / 10)) for i in range(11)]

# Stage Config
STAGE_CENTER_X_MM = 90
STAGE_CENTER_Y_MM = 125
STAGE_RADIUS_MM = 50

# Scale for processing (Pixels per MM)
SCALE = 4 

def build_lut(observed, expected):
    """
    Builds a 256-element Look-Up Table (LUT) using piecewise linear interpolation.
    """
    lut = np.arange(256, dtype=np.uint8)
    
    # Sort observed/expected pairs
    points = sorted(zip(observed, expected), key=lambda x: x[0])
    
    # Unzip
    x_points = np.array([p[0] for p in points])
    y_points = np.array([p[1] for p in points])
    
    # Interpolate
    # np.interp works well for 1D linear interpolation
    lut = np.interp(np.arange(256), x_points, y_points).astype(np.uint8)
    return lut

def apply_lut(val, lut):
    idx = int(np.clip(val, 0, 255))
    return lut[idx]
def preprocess_for_aruco(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    
    # Simple Blur to remove only high-freq noise
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    
    return gray
def process_image(image_path, ruler_measured_mm=100.0, output_dir="output"):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    print(f"Processing: {image_path}")
    img = cv2.imread(image_path)
    if img is None:
        print("Error: Could not load image.")
        return

    # Scale Correction Factor
    scale_correction = ruler_measured_mm / 100.0
    print(f"Scale Correction Factor: {scale_correction:.4f}")

    # 1. Detect Markers (ArUco)
    gray = preprocess_for_aruco(img)
    
    # Define dictionary (DICT_4X4_50)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    
    # Standard Robust Params for Printed Markers
    parameters.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    parameters.adaptiveThreshWinSizeMin = 3
    parameters.adaptiveThreshWinSizeMax = 23
    parameters.adaptiveThreshWinSizeStep = 10
    
    # Detect
    # Detect
    if hasattr(cv2.aruco, 'ArucoDetector'):
        # OpenCV 4.7+
        detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
        corners, ids, rejected = detector.detectMarkers(gray)
    else:
        # Older OpenCV
        corners, ids, rejected = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=parameters)
    
    debug_img = img.copy()
    gray_debug = gray.copy()
    cv2.aruco.drawDetectedMarkers(debug_img, corners, ids)# Add this to your debug section
    cv2.aruco.drawDetectedMarkers(gray_debug, corners, ids)# Add this to your debug section
    if rejected is not None and len(rejected) > 0:
        cv2.aruco.drawDetectedMarkers(debug_img, rejected, borderColor=(0, 0, 255)) 
        cv2.aruco.drawDetectedMarkers(gray_debug, rejected, borderColor=(0, 0, 255)) 

        # Rejected will be drawn in Red
    cv2.imwrite(f"{output_dir}/debug_markers_aruco.jpg", debug_img)
    cv2.imwrite(f"{output_dir}/debug_markers_aruco_gray.jpg", gray_debug   )
    
    # Debug: Print found
    if ids is not None:
        print(f"Found Marker IDs: {ids.flatten()}")
    else:
        print("No markers found.")
        
        # Try adaptive threshold manually to see what's wrong
        th = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 21, 7)
        cv2.imwrite(f"{output_dir}/debug_binary_aruco_check.jpg", th)

    if ids is None or len(ids) < 4:
        print(f"Error: Found only {len(ids) if ids is not None else 0} markers. Need 4.")
        
        # Attempt fallback or help user debug
        # Maybe parameters need tuning for small markers
        return

    # We need IDs 0, 1, 2, 3
    # Flatten ids
    ids = ids.flatten()
    
    # Organize corners by ID
    # corners is a list of arrays (1, 4, 2)
    
    found_map = {}
    for i, id_val in enumerate(ids):
        if id_val in [0, 1, 2, 3]:
            # Store the full corner array (1, 4, 2)
            found_map[id_val] = corners[i]

    if len(found_map) < 4:
        print(f"Error: Missing some required IDs (0-3). Found: {list(found_map.keys())}")
        return

    # Ordered: 0 (TL), 1 (TR), 2 (BR), 3 (BL)
    # ArUco order matches our PDF placement
    
    # USE OUTER CORNERS
    # ID 0 (TL): Top-Left Corner is index 0
    src_tl = found_map[0][0][0] # corners[i][0][0]
    # ID 1 (TR): Top-Right Corner is index 1
    src_tr = found_map[1][0][1]
    # ID 2 (BR): Bottom-Right Corner is index 2
    src_br = found_map[2][0][2]
    # ID 3 (BL): Bottom-Left Corner is index 3
    src_bl = found_map[3][0][3]
    
    src_pts = np.float32([src_tl, src_tr, src_br, src_bl])
    
    # 2. Perspective Warp
    dst_w = int(REAL_WIDTH_MM * SCALE)
    dst_h = int(REAL_HEIGHT_MM * SCALE)
    
    # Since we mapped OUTER corners of the markers, we need to map them to the 
    # OUTER edges of where the markers sit in the design.
    # Markers are at margin_x/y. 
    # But in our warp, we usually want (0,0) to be the top-left of the calibration RECT.
    # 
    # ID 0 (TL) Outer Corner (Top-Left): 
    #   In design, this is exactly at (margin_x, margin_y + calib_h - marker_size + marker_size)?? 
    #   No, PDF Y is inverted.
    #   In Image Space (Top-Left Origin):
    #   TL Marker Top-Left = (0, 0) relative to calib rect top-left?
    #   Yes, we draw ID 0 at margin_x, margin_y + calib_h - marker_size.
    #   The Top-Left corner of that marker is (margin_x, margin_y + calib_h) in PDF coords.
    #   Which is (0,0) in our desired warped image (if we warp the whole calib rect).
    
    # ID 1 (TR) Outer Corner (Top-Right):
    #   At (calib_w, 0)
    
    # ID 2 (BR) Outer Corner (Bottom-Right):
    #   At (calib_w, calib_h)
    
    # ID 3 (BL) Outer Corner (Bottom-Left):
    #   At (0, calib_h)
    
    dst_pts = np.float32([
        [0, 0],                  # TL Outer
        [dst_w, 0],              # TR Outer
        [dst_w, dst_h],          # BR Outer
        [0, dst_h]               # BL Outer
    ])
    
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(img, M, (dst_w, dst_h))
    
    cv2.imwrite(f"{output_dir}/warped.jpg", warped)
    
    # 3. Calibration (Grayscale Ramp)
    patch_y_px = int(GRAY_PATCH_Y_MM * SCALE)
    radius_px = int(1.5 * SCALE)
    
    observed_rgbs = []
    
    vis_warped = warped.copy()
    
    for x_mm in GRAY_PATCH_XS_MM:
        patch_x_px = int(x_mm * SCALE)
        
        # Draw on debug
        cv2.circle(vis_warped, (patch_x_px, patch_y_px), radius_px, (0, 0, 255), 2)
        
        # Sample
        # Slice: y1:y2, x1:x2
        roi = warped[patch_y_px-radius_px:patch_y_px+radius_px, patch_x_px-radius_px:patch_x_px+radius_px]
        mean_color = cv2.mean(roi)[:3] # BGR
        observed_rgbs.append(mean_color)
        
    cv2.imwrite(f"{output_dir}/warped_annotated.jpg", vis_warped)

    # BGR in OpenCV
    obs_b = [c[0] for c in observed_rgbs]
    obs_g = [c[1] for c in observed_rgbs]
    obs_r = [c[2] for c in observed_rgbs]
    
    lut_b = build_lut(obs_b, EXPECTED_LEVELS)
    lut_g = build_lut(obs_g, EXPECTED_LEVELS)
    lut_r = build_lut(obs_r, EXPECTED_LEVELS)
    
    # Plot LUT curves
    plt.figure()
    plt.plot(lut_r, color='red', label='Red LUT')
    plt.plot(lut_g, color='green', label='Green LUT')
    plt.plot(lut_b, color='blue', label='Blue LUT')
    plt.plot([0, 255], [0, 255], 'k--', label='Linear')
    plt.legend()
    plt.title("Calibration Curves (Gamma/WB Correction)")
    plt.savefig(f"{output_dir}/lut_curves.png")
    plt.close()
    
    # 4. Bean Analysis
    stage_x = int((STAGE_CENTER_X_MM - STAGE_RADIUS_MM) * SCALE)
    stage_y = int((STAGE_CENTER_Y_MM - STAGE_RADIUS_MM) * SCALE)
    stage_dim = int(STAGE_RADIUS_MM * 2 * SCALE)
    
    stage_roi = warped[stage_y:stage_y+stage_dim, stage_x:stage_x+stage_dim]
    
    # Detect beans
    stage_gray = cv2.cvtColor(stage_roi, cv2.COLOR_BGR2GRAY)
    _, stage_bin = cv2.threshold(stage_gray, 100, 255, cv2.THRESH_BINARY_INV)
    
    bean_contours, _ = cv2.findContours(stage_bin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    min_bean_area = 5 * SCALE * SCALE
    
    beans = []
    
    vis_stage = stage_roi.copy()
    
    for i, b_cnt in enumerate(bean_contours):
        area = cv2.contourArea(b_cnt)
        if area < min_bean_area:
            continue
            
        if len(b_cnt) >= 5:
            ellipse = cv2.fitEllipse(b_cnt)
            (xe, ye), (MA, ma), angle = ellipse
            
            # Draw ellipse
            cv2.ellipse(vis_stage, ellipse, (0, 255, 0), 2)
            
            # Dimensions in mm (corrected)
            major_mm = max(MA, ma) / SCALE * scale_correction
            minor_mm = min(MA, ma) / SCALE * scale_correction
            
            # Color measurement
            mask = np.zeros(stage_roi.shape[:2], dtype=np.uint8)
            cv2.drawContours(mask, [b_cnt], -1, 255, -1)
            mean_val = cv2.mean(stage_roi, mask=mask)[:3] # BGR
            
            # Correct Color
            corr_b = apply_lut(mean_val[0], lut_b)
            corr_g = apply_lut(mean_val[1], lut_g)
            corr_r = apply_lut(mean_val[2], lut_r)
            
            luma = 0.299 * corr_r + 0.587 * corr_g + 0.114 * corr_b
            
            beans.append({
                'id': i,
                'major_mm': major_mm,
                'minor_mm': minor_mm,
                'r': corr_r, 'g': corr_g, 'b': corr_b,
                'luma': luma
            })

    cv2.imwrite(f"{output_dir}/stage_analyzed.jpg", vis_stage)
    
    # 5. Output Data
    csv_path = f"{output_dir}/particles.csv"
    with open(csv_path, 'w', newline='') as csvfile:
        fieldnames = ['id', 'major_mm', 'minor_mm', 'r', 'g', 'b', 'luma']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for b in beans:
            writer.writerow(b)
            
    print(f"Analysis Complete. Found {len(beans)} particles.")
    print(f"Data saved to {csv_path}")
    
    # 6. Plot Particle Sizes
    if beans:
        sizes = [b['major_mm'] for b in beans]
        plt.figure()
        plt.hist(sizes, bins=20, color='brown', alpha=0.7, edgecolor='black')
        plt.xlabel('Major Axis Length (mm)')
        plt.ylabel('Count')
        plt.title(f'Particle Size Distribution (N={len(beans)})')
        plt.axvline(np.mean(sizes), color='k', linestyle='dashed', linewidth=1, label=f'Mean: {np.mean(sizes):.2f}mm')
        plt.legend()
        plt.savefig(f"{output_dir}/size_distribution.png")
        plt.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BeanLog CV Test Frontend")
    parser.add_argument("image", help="Path to input image containing calibration sheet")
    parser.add_argument("--ruler", type=float, default=100.0, help="Measured length of 10cm ruler in mm")
    
    args = parser.parse_args()
    
    process_image(args.image, args.ruler)

