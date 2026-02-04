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
MARKER_SIZE_MM = 15

# Grayscale Patch Config (11 steps)
GRAY_PATCH_Y_MM = 45
GRAY_PATCH_XS_MM = [55 + i * 9.5 for i in range(11)]
EXPECTED_LEVELS = [int(255 - (i * (255 - 20) / 10)) for i in range(11)]

# CMYK Patch Config (for White Balance)
# From generate_calibration_sheet.py:
# - patch_start_x = margin_x + calib_w - (5 * (12+2)) - 10 = margin_x + 100mm
# - patch_start_y = margin_y + calib_h - 35 = margin_y + 215mm
# - In warped image (top=0): Y = 250 - 215 = 35mm (top edge), center = 35 + 6 = 41mm
# - Patch centers: 100 + 6 + i*(12+2) = 106 + i*14 for i=0,1,2,3
CMYK_PATCH_Y_MM = 30  # Center of 12mm patch
CMYK_PATCH_XS_MM = [106, 120, 134, 148]  # Cyan, Magenta, Yellow, Black centers
# Expected CMYK values (ideal sRGB approximations)
CMYK_EXPECTED = {
    'cyan': [0, 255, 255],      # BGR: (255, 255, 0)
    'magenta': [255, 0, 255],   # BGR: (255, 0, 255)
    'yellow': [0, 255, 255],    # BGR: (0, 255, 255) - wait, yellow is R+G
    'black': [0, 0, 0]          # BGR: (0, 0, 0)
}
# Actually, for WB we want neutral targets. Let's use the average of CMYK to estimate neutral
# Or better: use the fact that C+M+Y should theoretically mix to neutral gray

# Stage Config
STAGE_CENTER_X_MM = 90
STAGE_CENTER_Y_MM = 115
STAGE_RADIUS_MM = 50

# Scale for processing (Pixels per MM)
SCALE = 6

def build_lut(observed, expected):
    """Builds a 256-element Look-Up Table (LUT) using piecewise linear interpolation."""
    points = sorted(zip(observed, expected), key=lambda x: x[0])
    x_points = np.array([p[0] for p in points])
    y_points = np.array([p[1] for p in points])
    lut = np.interp(np.arange(256), x_points, y_points).astype(np.uint8)
    return lut

def apply_lut(val, lut):
    idx = int(np.clip(val, 0, 255))
    return lut[idx]

def preprocess_for_aruco(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
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

    scale_correction = ruler_measured_mm / 100.0
    print(f"Scale Correction Factor: {scale_correction:.4f}")

    # 1. Detect Markers (ArUco)
    gray = preprocess_for_aruco(img)
    
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    parameters = cv2.aruco.DetectorParameters()
    parameters.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    parameters.adaptiveThreshWinSizeMin = 3
    parameters.adaptiveThreshWinSizeMax = 23
    parameters.adaptiveThreshWinSizeStep = 10
    
    if hasattr(cv2.aruco, 'ArucoDetector'):
        detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
        corners, ids, rejected = detector.detectMarkers(gray)
    else:
        corners, ids, rejected = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=parameters)

    if ids is None or len(ids) < 4:
        print(f"Error: Found only {len(ids) if ids is not None else 0} markers. Need 4.")
        return

    # Organize corners by ID
    ids = ids.flatten()
    found_map = {}
    for i, id_val in enumerate(ids):
        if id_val in [0, 1, 2, 3]:
            found_map[id_val] = corners[i]

    if len(found_map) < 4:
        print(f"Error: Missing some required IDs (0-3). Found: {list(found_map.keys())}")
        return

    # Use outer corners for homography
    src_tl = found_map[0][0][0]
    src_tr = found_map[1][0][1]
    src_br = found_map[2][0][2]
    src_bl = found_map[3][0][3]
    src_pts = np.float32([src_tl, src_tr, src_br, src_bl])
    
    # 2. Perspective Warp
    dst_w = int(REAL_WIDTH_MM * SCALE)
    dst_h = int(REAL_HEIGHT_MM * SCALE)
    dst_pts = np.float32([[0, 0], [dst_w, 0], [dst_w, dst_h], [0, dst_h]])
    
    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    warped = cv2.warpPerspective(img, M, (dst_w, dst_h))
    cv2.imwrite(f"{output_dir}/warped.jpg", warped)
    
    # 3. Calibration (Grayscale Ramp for Gamma + CMYK for White Balance)
    patch_y_px = int(GRAY_PATCH_Y_MM * SCALE)
    radius_px = int(1.5 * SCALE)
    
    observed_rgbs = []
    vis_warped = warped.copy()
    
    # Sample grayscale patches for gamma correction
    for x_mm in GRAY_PATCH_XS_MM:
        patch_x_px = int(x_mm * SCALE)
        cv2.circle(vis_warped, (patch_x_px, patch_y_px), radius_px, (0, 0, 255), 2)
        roi = warped[patch_y_px-radius_px:patch_y_px+radius_px, patch_x_px-radius_px:patch_x_px+radius_px]
        mean_color = cv2.mean(roi)[:3]  # BGR
        observed_rgbs.append(mean_color)
    
    # Sample CMYK patches for white balance
    cmyk_y_px = int(CMYK_PATCH_Y_MM * SCALE)
    cmyk_radius_px = int(3 * SCALE)  # Larger radius for CMYK patches (12mm)
    
    cmyk_observed = []
    for x_mm in CMYK_PATCH_XS_MM:
        patch_x_px = int(x_mm * SCALE)
        cv2.circle(vis_warped, (patch_x_px, cmyk_y_px), cmyk_radius_px, (255, 0, 0), 2)
        roi = warped[cmyk_y_px-cmyk_radius_px:cmyk_y_px+cmyk_radius_px, 
                     patch_x_px-cmyk_radius_px:patch_x_px+cmyk_radius_px]
        mean_color = cv2.mean(roi)[:3]  # BGR
        cmyk_observed.append(mean_color)
        
    cv2.imwrite(f"{output_dir}/warped_annotated.jpg", vis_warped)

    # Build LUTs for gamma correction (using grayscale ramp)
    obs_b = [c[0] for c in observed_rgbs]
    obs_g = [c[1] for c in observed_rgbs]
    obs_r = [c[2] for c in observed_rgbs]
    
    lut_b = build_lut(obs_b, EXPECTED_LEVELS)
    lut_g = build_lut(obs_g, EXPECTED_LEVELS)
    lut_r = build_lut(obs_r, EXPECTED_LEVELS)
    
    # Calculate White Balance factors from CMYK patches
    # Strategy: C+M+Y should theoretically mix to neutral gray
    # We can use the average of C, M, Y to estimate what "neutral" looks like under current lighting
    # Then calculate correction factors to make it truly neutral
    
    # Observed CMYK values (BGR)
    c_obs = cmyk_observed[0]  # Cyan
    m_obs = cmyk_observed[1]  # Magenta  
    y_obs = cmyk_observed[2]  # Yellow
    k_obs = cmyk_observed[3]  # Black
    
    # Estimate neutral gray from C+M+Y average (theoretical mix)
    # In ideal conditions, C+M+Y should produce a dark neutral gray
    neutral_obs_b = (c_obs[0] + m_obs[0] + y_obs[0]) / 3.0
    neutral_obs_g = (c_obs[1] + m_obs[1] + y_obs[1]) / 3.0
    neutral_obs_r = (c_obs[2] + m_obs[2] + y_obs[2]) / 3.0
    
    # Target neutral gray (medium gray, e.g., 128)
    target_neutral = 128.0
    
    # Calculate WB correction factors
    wb_factor_b = target_neutral / neutral_obs_b if neutral_obs_b > 0 else 1.0
    wb_factor_g = target_neutral / neutral_obs_g if neutral_obs_g > 0 else 1.0
    wb_factor_r = target_neutral / neutral_obs_r if neutral_obs_r > 0 else 1.0
    
    print(f"White Balance Factors (from CMYK): R={wb_factor_r:.3f}, G={wb_factor_g:.3f}, B={wb_factor_b:.3f}")
    
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
    
    # 4. Bean Analysis (Roasting Color & Size)
    stage_x = int((STAGE_CENTER_X_MM - STAGE_RADIUS_MM) * SCALE)
    stage_y = int((STAGE_CENTER_Y_MM - STAGE_RADIUS_MM) * SCALE)
    stage_dim = int(STAGE_RADIUS_MM * 2 * SCALE)
    
    stage_roi = warped[stage_y:stage_y+stage_dim, stage_x:stage_x+stage_dim]
    
    def detect_beans(stage_roi_bgr, min_area_px=50):
        """Detect whole coffee beans (not particles) for size and color analysis."""
        gray = cv2.cvtColor(stage_roi_bgr, cv2.COLOR_BGR2GRAY)
        
        # Denoise
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        
        # Background removal
        bg = cv2.GaussianBlur(gray, (0, 0), 30)
        diff = cv2.subtract(bg, gray)
        diff = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
        
        # Threshold to find dark beans
        _, bw = cv2.threshold(diff, 15, 255, cv2.THRESH_BINARY)
        
        # Morphological operations to clean up
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel, iterations=2)
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kernel, iterations=1)
        
        # Mask to circular stage
        h, w = bw.shape
        mask = np.zeros_like(bw)
        r = int(min(h, w) * 0.48)
        cv2.circle(mask, (w // 2, h // 2), r, 255, -1)
        bw = cv2.bitwise_and(bw, bw, mask=mask)
        
        # Find contours
        contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        beans = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < min_area_px:
                continue
            
            # Fit ellipse for bean shape
            if len(cnt) >= 5:
                ellipse = cv2.fitEllipse(cnt)
                beans.append({
                    'contour': cnt,
                    'ellipse': ellipse,
                    'area_px': area
                })
        
        return beans, bw, diff
    
    # Detect beans
    beans_detected, stage_bin, stage_diff = detect_beans(stage_roi, min_area_px=50)
    
    # Visualize
    vis_stage = stage_roi.copy()
    beans_data = []
    
    for i, bean in enumerate(beans_detected):
        ellipse = bean['ellipse']
        cnt = bean['contour']
        
        # Draw ellipse
        cv2.ellipse(vis_stage, ellipse, (0, 255, 0), 2)
        
        # Calculate size in mm
        (xe, ye), (MA, ma), angle = ellipse
        major_mm = max(MA, ma) / SCALE * scale_correction
        minor_mm = min(MA, ma) / SCALE * scale_correction
        
        # Measure color (calibrated)
        mask = np.zeros(stage_roi.shape[:2], dtype=np.uint8)
        cv2.drawContours(mask, [cnt], -1, 255, -1)
        mean_val = cv2.mean(stage_roi, mask=mask)[:3]  # BGR
        
        # Apply color correction: First gamma correction (LUT), then white balance
        corr_b = apply_lut(mean_val[0], lut_b)
        corr_g = apply_lut(mean_val[1], lut_g)
        corr_r = apply_lut(mean_val[2], lut_r)
        
        # Apply white balance factors (from CMYK patches)
        corr_b = np.clip(corr_b * wb_factor_b, 0, 255)
        corr_g = np.clip(corr_g * wb_factor_g, 0, 255)
        corr_r = np.clip(corr_r * wb_factor_r, 0, 255)
        
        # Calculate Lightness (L from LAB color space approximation)
        luma = 0.299 * corr_r + 0.587 * corr_g + 0.114 * corr_b
        
        beans_data.append({
            'id': i,
            'major_mm': major_mm,
            'minor_mm': minor_mm,
            'r': corr_r, 'g': corr_g, 'b': corr_b,
            'luma': luma
        })
    
    cv2.imwrite(f"{output_dir}/stage_diff.jpg", stage_diff)
    cv2.imwrite(f"{output_dir}/stage_bin.jpg", stage_bin)
    cv2.imwrite(f"{output_dir}/stage_analyzed.jpg", vis_stage)
    
    # 5. Output Data
    csv_path = f"{output_dir}/beans.csv"
    with open(csv_path, 'w', newline='') as csvfile:
        fieldnames = ['id', 'major_mm', 'minor_mm', 'r', 'g', 'b', 'luma']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for b in beans_data:
            writer.writerow(b)
            
    print(f"Analysis Complete. Found {len(beans_data)} beans.")
    print(f"Average size: {np.mean([b['major_mm'] for b in beans_data]):.2f}mm x {np.mean([b['minor_mm'] for b in beans_data]):.2f}mm")
    print(f"Average lightness (L): {np.mean([b['luma'] for b in beans_data]):.1f}")
    print(f"Data saved to {csv_path}")
    
    # 6. Plot Bean Analysis
    if beans_data:
        fig, axes = plt.subplots(1, 2, figsize=(12, 5))
        
        # Size distribution
        major_sizes = [b['major_mm'] for b in beans_data]
        minor_sizes = [b['minor_mm'] for b in beans_data]
        axes[0].scatter(major_sizes, minor_sizes, alpha=0.6, s=50)
        axes[0].set_xlabel('Major Axis (mm)', fontsize=11)
        axes[0].set_ylabel('Minor Axis (mm)', fontsize=11)
        axes[0].set_title(f'Bean Size Distribution (N={len(beans_data)})', fontsize=12)
        axes[0].grid(True, alpha=0.3)
        
        # Color (Lightness) distribution
        lumas = [b['luma'] for b in beans_data]
        axes[1].hist(lumas, bins=20, color='brown', alpha=0.7, edgecolor='black')
        axes[1].set_xlabel('Lightness (L)', fontsize=11)
        axes[1].set_ylabel('Count', fontsize=11)
        axes[1].set_title('Roast Level Distribution', fontsize=12)
        axes[1].axvline(np.mean(lumas), color='r', linestyle='dashed', linewidth=1.5, 
                        label=f'Mean: {np.mean(lumas):.1f}')
        axes[1].legend()
        axes[1].grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(f"{output_dir}/bean_analysis.png", dpi=150)
        plt.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BeanLog Bean CV Test (Roasting Color & Size)")
    parser.add_argument("image", help="Path to input image containing calibration sheet with beans")
    parser.add_argument("--ruler", type=float, default=100.0, help="Measured length of 10cm ruler in mm")
    
    args = parser.parse_args()
    process_image(args.image, args.ruler)

