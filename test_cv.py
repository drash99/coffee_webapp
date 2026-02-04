import cv2
import numpy as np
import argparse
import sys
import matplotlib.pyplot as plt
import csv
import os

# Try to import LOESS smoothing
try:
    from statsmodels.nonparametric.smoothers_lowess import lowess
    HAS_LOWESS = True
except ImportError:
    try:
        from scipy.interpolate import UnivariateSpline
        HAS_SPLINE = True
        HAS_LOWESS = False
    except ImportError:
        HAS_LOWESS = False
        HAS_SPLINE = False

# ---------------------------------------------------------
# CONFIGURATION (Must match src/workers/cv.worker.ts)
# ---------------------------------------------------------
REAL_WIDTH_MM = 180
REAL_HEIGHT_MM = 250
MARKER_SIZE_MM = 15 # Updated to 15mm ArUco

# Grayscale Patch Config (11 steps)
GRAY_PATCH_Y_MM = 45
GRAY_PATCH_XS_MM = [55 + i * 9.5 for i in range(11)]
EXPECTED_LEVELS = [int(255 - (i * (255 - 20) / 10)) for i in range(11)]

# Stage Config
STAGE_CENTER_X_MM = 90
STAGE_CENTER_Y_MM = 115
STAGE_RADIUS_MM = 50

# Scale for processing (Pixels per MM)
SCALE = 20

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
    if hasattr(cv2.aruco, 'ArucoDetector'):
        # OpenCV 4.7+
        detector = cv2.aruco.ArucoDetector(aruco_dict, parameters)
        corners, ids, rejected = detector.detectMarkers(gray)
    else:
        # Older OpenCV
        corners, ids, rejected = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=parameters)
    
    if ids is None or len(ids) < 4:
        print(f"Error: Found only {len(ids) if ids is not None else 0} markers. Need 4.")
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
    
    # 4. Bean/Particle Analysis (All Dots Including 1px)
    stage_x = int((STAGE_CENTER_X_MM - STAGE_RADIUS_MM) * SCALE)
    stage_y = int((STAGE_CENTER_Y_MM - STAGE_RADIUS_MM) * SCALE)
    stage_dim = int(STAGE_RADIUS_MM * 2 * SCALE)
    
    stage_roi = warped[stage_y:stage_y+stage_dim, stage_x:stage_x+stage_dim]
    
    def detect_all_dots(stage_roi_bgr, keep_single_pixels=True, threshold=20):
        """Detect all dark particles including 1px dots using DoG filtering."""
        gray = cv2.cvtColor(stage_roi_bgr, cv2.COLOR_BGR2GRAY)
        
        # 1) Strong denoise (helps single-pixel stability)
        gray_dn = cv2.fastNlMeansDenoising(gray, None, h=10, templateWindowSize=7, searchWindowSize=21)
        
        # 2) Background removal: estimate illumination/paper tone
        bg = cv2.GaussianBlur(gray_dn, (0, 0), 25)  # large sigma
        hp = cv2.subtract(bg, gray_dn)  # dark specks -> bright
        
        # 3) Enhance tiny blobs: Difference of Gaussians (DoG)
        g1 = cv2.GaussianBlur(hp, (0, 0), 0.8)  # small
        g2 = cv2.GaussianBlur(hp, (0, 0), 1.6)  # slightly larger
        dog = cv2.subtract(g1, g2)  # tiny bright features pop
        
        # Normalize for stable thresholding
        dog = cv2.normalize(dog, None, 0, 255, cv2.NORM_MINMAX)
        
        # 4) Threshold
        bw = (dog >= threshold).astype(np.uint8) * 255
        
        # 5) Mask to circular stage (prevents grid edges / outside noise)
        h, w = bw.shape
        mask = np.zeros_like(bw)
        r = int(min(h, w) * 0.48)
        cv2.circle(mask, (w // 2, h // 2), r, 255, -1)
        bw = cv2.bitwise_and(bw, bw, mask=mask)
        
        # 6) Connected components (keeps 1px components if you want)
        num, labels, stats, centroids = cv2.connectedComponentsWithStats(bw, connectivity=8)
        
        dots = []
        min_area = 1 if keep_single_pixels else 2
        for i in range(1, num):  # 0 = background
            area = stats[i, cv2.CC_STAT_AREA]
            if area < min_area:
                continue
            x, y, ww, hh = stats[i, :4]
            cx, cy = centroids[i]
            dots.append({
                "area_px": int(area),
                "bbox": (int(x), int(y), int(ww), int(hh)),
                "centroid": (float(cx), float(cy))
            })
        
        return dots, bw, dog
    
    # Detect all dots
    dots, stage_bin, stage_dog = detect_all_dots(stage_roi, keep_single_pixels=True, threshold=20)
    
    # Visualize
    vis_stage = stage_roi.copy()
    for d in dots:
        x, y, w, h = d["bbox"]
        cv2.rectangle(vis_stage, (x, y), (x+w-1, y+h-1), (0, 255, 0), 1)
        # Draw centroid
        cx, cy = d["centroid"]
        cv2.circle(vis_stage, (int(cx), int(cy)), 2, (0, 0, 255), -1)
    
    cv2.imwrite(f"{output_dir}/stage_dog.jpg", stage_dog)
    cv2.imwrite(f"{output_dir}/stage_bin_all_dots.jpg", stage_bin)
    cv2.imwrite(f"{output_dir}/stage_analyzed.jpg", vis_stage)
    
    # Convert dots to beans format with size/color measurements
    beans = []
    for i, d in enumerate(dots):
        x, y, w, h = d["bbox"]
        cx, cy = d["centroid"]
        
        # Estimate size (for single pixels, use area; for larger, fit ellipse)
        area_px = d["area_px"]
        
        # Create mask for this dot
        mask = np.zeros(stage_roi.shape[:2], dtype=np.uint8)
        if area_px == 1:
            # Single pixel
            cv2.circle(mask, (int(cx), int(cy)), 1, 255, -1)
            # Approximate as tiny circle
            major_mm = minor_mm = (np.sqrt(area_px / np.pi) * 2) / SCALE * scale_correction
        else:
            # Multi-pixel: use bounding box or fit ellipse
            cv2.rectangle(mask, (x, y), (x+w-1, y+h-1), 255, -1)
            # Rough estimate: use diagonal of bbox
            diag = np.sqrt(w*w + h*h)
            major_mm = diag / SCALE * scale_correction
            minor_mm = (area_px / (np.pi * diag/2)) / SCALE * scale_correction if diag > 0 else major_mm
        
        # Color measurement
        mean_val = cv2.mean(stage_roi, mask=mask)[:3]  # BGR
        
        # Correct Color
        corr_b = apply_lut(mean_val[0], lut_b)
        corr_g = apply_lut(mean_val[1], lut_g)
        corr_r = apply_lut(mean_val[2], lut_r)
        
        luma = 0.299 * corr_r + 0.587 * corr_g + 0.114 * corr_b
        
        beans.append({
            'id': i,
            'major_mm': major_mm,
            'minor_mm': minor_mm,
            'area_px': area_px,
            'r': corr_r, 'g': corr_g, 'b': corr_b,
            'luma': luma
        })
    
    # 5. Output Data
    csv_path = f"{output_dir}/particles.csv"
    with open(csv_path, 'w', newline='') as csvfile:
        fieldnames = ['id', 'major_mm', 'minor_mm', 'area_px', 'r', 'g', 'b', 'luma']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for b in beans:
            writer.writerow(b)
            
    print(f"Analysis Complete. Found {len(beans)} particles (including {sum(1 for b in beans if b['area_px'] == 1)} single-pixel dots).")
    print(f"Data saved to {csv_path}")
    
    # 6. Plot Particle Sizes (LOESS density distribution in micrometers)
    if beans:
        # Convert mm to micrometers (1mm = 1000um)
        sizes_um = np.array([b['major_mm'] * 1000 for b in beans])
        
        # Filter to 0-2000um range
        sizes_um = sizes_um[(sizes_um >= 0) & (sizes_um <= 2000)]
        
        if len(sizes_um) == 0:
            print("No particles in 0-2000μm range for plotting.")
            return
        
        # Create density histogram (coarser bins)
        counts, bin_edges = np.histogram(sizes_um, bins=20, range=(0, 2000))
        bin_centers = (bin_edges[:-1] + bin_edges[1:]) / 2
        density = counts / len(sizes_um) * 100  # Percentage
        
        plt.figure(figsize=(10, 6))
        
        # Plot histogram bars (light)
        plt.bar(bin_centers, density, width=bin_edges[1]-bin_edges[0], 
                alpha=0.3, color='gray', edgecolor='black', linewidth=0.5, label='Histogram')
        
        # Apply LOESS smoothing to density curve
        if HAS_LOWESS:
            # Use statsmodels LOESS
            smoothed = lowess(density, bin_centers, frac=0.2, it=3)
            plt.plot(smoothed[:, 0], smoothed[:, 1], 'b-', linewidth=2.5, label='LOESS fit')
        elif HAS_SPLINE:
            # Use scipy spline as fallback
            spline = UnivariateSpline(bin_centers, density, s=len(bin_centers)*2)
            x_smooth = np.linspace(0, 2000, 200)
            y_smooth = spline(x_smooth)
            y_smooth = np.maximum(y_smooth, 0)  # Ensure non-negative
            plt.plot(x_smooth, y_smooth, 'b-', linewidth=2.5, label='Spline fit')
        else:
            # Simple moving average fallback
            window = max(3, len(bin_centers) // 10)
            y_smooth = np.convolve(density, np.ones(window)/window, mode='same')
            plt.plot(bin_centers, y_smooth, 'b-', linewidth=2.5, label='Smoothed')
        
        plt.xlabel('Major Axis Length (μm)', fontsize=12)
        plt.ylabel('Density (%)', fontsize=12)
        plt.xlim(0, 2000)
        plt.ylim(bottom=0)
        plt.title(f'Particle Size Distribution (N={len(sizes_um)})', fontsize=14)
        plt.grid(True, alpha=0.3, linestyle='--')
        plt.axvline(np.mean(sizes_um), color='r', linestyle='dashed', linewidth=1.5, label=f'Mean: {np.mean(sizes_um):.1f}μm')
        plt.axvline(np.median(sizes_um), color='g', linestyle='dashed', linewidth=1.5, label=f'Median: {np.median(sizes_um):.1f}μm')
        plt.legend()
        plt.tight_layout()
        plt.savefig(f"{output_dir}/size_distribution.png", dpi=150)
        plt.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BeanLog CV Test Frontend")
    parser.add_argument("image", help="Path to input image containing calibration sheet")
    parser.add_argument("--ruler", type=float, default=100.0, help="Measured length of 10cm ruler in mm")
    
    args = parser.parse_args()
    
    process_image(args.image, args.ruler)

