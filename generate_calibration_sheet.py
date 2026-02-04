import cv2
import numpy as np
import sys
import math

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib.colors import CMYKColor
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    # Use ReportLab's ImageReader to embed numpy arrays
    from reportlab.lib.utils import ImageReader
except ImportError:
    print("This script requires 'reportlab' and 'opencv-python'. Please install them using:")
    print("pip install reportlab opencv-python")
    sys.exit(1)

def draw_calibration_sheet(filename="calibration_target.pdf"):
    c = canvas.Canvas(filename, pagesize=LETTER)
    width, height = LETTER
    
    # ---------------------------------------------------------
    # CONFIGURATION
    # ---------------------------------------------------------
    # Defined strictly for Letter.
    # Calibration Rectangle: 180mm x 250mm (Reduced slightly from 260mm to fit safe margins)
    # Letter is ~216mm x 279mm. 260mm height leaves <1cm margin top/bottom.
    # Let's adjust height to 250mm to be safer for home printers.
    calib_w = 180 * mm
    calib_h = 250 * mm
    
    # Centering the calibration rect
    margin_x = (width - calib_w) / 2
    margin_y = (height - calib_h) / 2
    
    # ---------------------------------------------------------
    # 1. Corner Markers (ArUco 4x4)
    # ---------------------------------------------------------
    # Replacing generic squares with ArUco Markers (DICT_4X4_50)
    # IDs: 0 (TL), 1 (TR), 2 (BR), 3 (BL)
    
    # Initialize ArUco Dictionary
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    
    marker_size = 15 * mm # 15mm for better visibility
    
    def draw_aruco_png(x, y, id_val):
        # Generate marker image using OpenCV (white border included by default? No, usually just the bits + black border)
        # We generate a 200x200 px image
        marker_img = cv2.aruco.generateImageMarker(aruco_dict, id_val, 200, borderBits=1)
        
        # Convert grayscale to RGB for ReportLab
        marker_rgb = cv2.cvtColor(marker_img, cv2.COLOR_GRAY2RGB)
        
        # Convert numpy array to PIL Image
        from PIL import Image
        pil_img = Image.fromarray(marker_rgb)
        
        # Draw White 'Quiet Zone' Background (Marker Size + 2mm)
        pad = 1 * mm
        c.setFillColor(colors.white)
        c.rect(x - pad, y - pad, marker_size + 2*pad, marker_size + 2*pad, fill=1, stroke=0)
        
        # Draw the Marker using ImageReader wrapping the PIL image
        c.drawImage(ImageReader(pil_img), x, y, width=marker_size, height=marker_size, mask=None)

    # Bottom-Left (ID 3)
    draw_aruco_png(margin_x, margin_y, 3)
    # Bottom-Right (ID 2)
    draw_aruco_png(margin_x + calib_w - marker_size, margin_y, 2)
    # Top-Left (ID 0)
    draw_aruco_png(margin_x, margin_y + calib_h - marker_size, 0)
    # Top-Right (ID 1)
    draw_aruco_png(margin_x + calib_w - marker_size, margin_y + calib_h - marker_size, 1)

    # Draw the boundary lines (optional, helpful for cutting, but dashed to not confuse CV too much)
    c.setLineWidth(0.5)
    c.setStrokeColor(colors.gray)
    c.setDash(2, 4)
    c.rect(margin_x, margin_y, calib_w, calib_h, stroke=1, fill=0)
    c.setDash([]) # Reset dash

    # ---------------------------------------------------------
    # 2. Distortion Grid (Full coverage except Stage)
    # ---------------------------------------------------------
    # Replacing small checkerboard with a full 10mm grid
    # to allow for more advanced distortion correction if needed.
    
    grid_step = 10 * mm
    stage_center_x = width / 2
    stage_center_y = height / 2 + 10 * mm
    stage_radius = 50 * mm + 2 * mm # Add slight margin
    
    c.setStrokeColor(colors.lightgrey)
    c.setLineWidth(0.5)
    
    # Function to check if a segment is inside the exclusion zone
    # We'll just draw lines and rely on simple geometry to skip the center
    
    # Vertical Lines
    # Iterate relative to calibration rect to align with markers?
    # Let's align with the margin_x/y
    
    # Calc range
    x_start = margin_x
    x_end = margin_x + calib_w
    y_start = margin_y
    y_end = margin_y + calib_h
    
    # Vertical lines
    x = x_start
    while x <= x_end:
        # Exclusion Zone 1: Stage Circle
        dx_stage = x - stage_center_x
        
        # Exclusion Zone 2: Markers (Top/Bottom corners)
        # Markers are now 15mm
        m_sz = 15 * mm
        in_left_marker_col = abs(x - margin_x) < 0.1*mm or abs(x - (margin_x+m_sz)) < 0.1*mm or (x > margin_x and x < margin_x+m_sz)
        in_right_marker_col = abs(x - (margin_x+calib_w-m_sz)) < 0.1*mm or abs(x - (margin_x+calib_w)) < 0.1*mm or (x > margin_x+calib_w-m_sz and x < margin_x+calib_w)
        
        segments = [(y_start, y_end)]
        
        if in_left_marker_col or in_right_marker_col:
             # Cut bottom segment
             segments = [(margin_y + m_sz + 1*mm, y_end)] 
             # Cut top segment
             segments[0] = (segments[0][0], margin_y + calib_h - m_sz - 1*mm)
             
        # Now handle Stage exclusion for the remaining segments
        final_segments = []
        for (seg_y1, seg_y2) in segments:
             # Check overlap with stage
             # For a vertical line x, stage intersection is y_enter, y_exit
             if abs(dx_stage) < stage_radius:
                  dy_stage = math.sqrt(stage_radius**2 - dx_stage**2)
                  y_enter = stage_center_y - dy_stage
                  y_exit = stage_center_y + dy_stage
                  
                  # Segment 1: seg_y1 to y_enter
                  if seg_y1 < y_enter:
                      final_segments.append((seg_y1, min(seg_y2, y_enter)))
                  # Segment 2: y_exit to seg_y2
                  if seg_y2 > y_exit:
                      final_segments.append((max(seg_y1, y_exit), seg_y2))
             else:
                  final_segments.append((seg_y1, seg_y2))
                  
        for (y1, y2) in final_segments:
             if y2 > y1: c.line(x, y1, x, y2)
             
        x += grid_step

    # Horizontal lines
    y = y_start
    while y <= y_end:
        # Exclusion 1: Stage
        dy_stage = y - stage_center_y
        
        # Exclusion 2: Markers (15mm)
        m_sz = 15 * mm
        in_bottom_marker_row = (y >= margin_y and y <= margin_y + m_sz)
        in_top_marker_row = (y >= margin_y + calib_h - m_sz and y <= margin_y + calib_h)
        
        segments = [(x_start, x_end)]
        
        if in_bottom_marker_row or in_top_marker_row:
             segments = [(margin_x + m_sz + 1*mm, margin_x + calib_w - m_sz - 1*mm)]
             
        final_segments = []
        for (seg_x1, seg_x2) in segments:
             if abs(dy_stage) < stage_radius:
                  dx_stage = math.sqrt(stage_radius**2 - dy_stage**2)
                  x_enter = stage_center_x - dx_stage
                  x_exit = stage_center_x + dx_stage
                  
                  if seg_x1 < x_enter:
                      final_segments.append((seg_x1, min(seg_x2, x_enter)))
                  if seg_x2 > x_exit:
                      final_segments.append((max(seg_x1, x_exit), seg_x2))
             else:
                  final_segments.append((seg_x1, seg_x2))
                  
        for (x1, x2) in final_segments:
             if x2 > x1: c.line(x1, y, x2, y)
             
        y += grid_step

    c.setFillColor(colors.black)
    c.setFont("Helvetica", 6)
    c.drawString(margin_x + 100*mm, margin_y + 2*mm, "10mm Distortion Grid")

    # ---------------------------------------------------------
    # 3. 10cm Ruler (Scale Verification)
    # ---------------------------------------------------------
    # Bottom Center
    ruler_len = 100 * mm
    ruler_x = (width - ruler_len) / 2
    ruler_y = margin_y + 20 * mm
    
    c.setLineWidth(1.5)
    c.setStrokeColor(colors.black)
    c.line(ruler_x, ruler_y, ruler_x + ruler_len, ruler_y)
    
    # Ticks
    c.setLineWidth(1)
    for i in range(11):
        x_pos = ruler_x + (i * 10 * mm)
        height_tick = 5 * mm if i % 5 == 0 else 3 * mm
        c.line(x_pos, ruler_y, x_pos, ruler_y + height_tick)
        if i % 1 == 0: # Label all cm
            c.drawCentredString(x_pos, ruler_y - 4*mm, f"{i}")
            
    c.drawCentredString(width/2, ruler_y - 8*mm, "10 cm Scale")

    # ---------------------------------------------------------
    # 4. Color & Grayscale Patches (Calibration)
    # ---------------------------------------------------------
    # Located Top-Right area
    patch_size = 12 * mm
    gap = 2 * mm
    # Position: top right, moved in slightly
    patch_start_x = margin_x + calib_w - (5 * (patch_size + gap)) - 10*mm
    patch_start_y = margin_y + calib_h - 35 * mm
    
    # CMYK Row
    # Using CMYK colors explicitly if supported, otherwise RGB fallback that maps well to CMYK.
    # ReportLab supports CMYKColor(c,m,y,k) where 0-1.
    c.setFillColor(CMYKColor(1, 0, 0, 0)); c.rect(patch_start_x, patch_start_y, patch_size, patch_size, fill=1, stroke=1)
    c.setFillColor(CMYKColor(0, 1, 0, 0)); c.rect(patch_start_x + 1*(patch_size+gap), patch_start_y, patch_size, patch_size, fill=1, stroke=1)
    c.setFillColor(CMYKColor(0, 0, 1, 0)); c.rect(patch_start_x + 2*(patch_size+gap), patch_start_y, patch_size, patch_size, fill=1, stroke=1)
    c.setFillColor(CMYKColor(0, 0, 0, 1)); c.rect(patch_start_x + 3*(patch_size+gap), patch_start_y, patch_size, patch_size, fill=1, stroke=1)
    
    # Grayscale Ramp (11 steps)
    # 0%, 10%, 20% ... 100% Black (K)
    # Using smaller patches to fit 11 steps
    gray_patch_size = 8 * mm
    gray_gap = 1.5 * mm
    num_steps = 11
    
    # Calculate width to right-align
    gray_row_width = num_steps * gray_patch_size + (num_steps - 1) * gray_gap
    # Right align with the CMYK row end (approx)
    # CMYK end X = patch_start_x + 4*size + 3*gap
    cmyk_end_x = patch_start_x + 4*patch_size + 3*gap
    gray_start_x = cmyk_end_x - gray_row_width
    
    gray_y = patch_start_y - (gray_patch_size + 6*mm) # Position below CMYK
    
    for i in range(num_steps):
        # 0.0 to 1.0
        k_val = i / 10.0
        c.setFillColor(CMYKColor(0, 0, 0, k_val))
        
        gx = gray_start_x + i * (gray_patch_size + gray_gap)
        c.rect(gx, gray_y, gray_patch_size, gray_patch_size, fill=1, stroke=1)
        
        # Label 0, 50, 100
        if i == 0:
            c.setFillColor(colors.black)
            c.drawCentredString(gx + gray_patch_size/2, gray_y - 3*mm, "0")
        elif i == 5:
            c.setFillColor(colors.black)
            c.drawCentredString(gx + gray_patch_size/2, gray_y - 3*mm, "50")
        elif i == 10:
            c.setFillColor(colors.black)
            c.drawCentredString(gx + gray_patch_size/2, gray_y - 3*mm, "100")

    # ---------------------------------------------------------
    # 5. Central Stage
    # ---------------------------------------------------------
    c.setStrokeColor(colors.lightgrey)
    c.setLineWidth(2)
    # Draw a 10cm circle in the middle
    c.circle(width/2, height/2 + 10*mm, 50*mm, fill=0, stroke=1)
    
    c.setFillColor(colors.gray)
    c.setFont("Helvetica", 14)
    c.drawCentredString(width/2, height/2 + 10*mm, "BEAN / GRIND STAGE")
    c.setFont("Helvetica", 10)
    c.drawCentredString(width/2, height/2 + 5*mm, "(Place Sample Here)")

    # ---------------------------------------------------------
    # Metadata
    # ---------------------------------------------------------
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8)
    info_text = f"BeanLog Calibration Sheet | Dimensions: {calib_w/mm:.1f}mm x {calib_h/mm:.1f}mm"
    c.drawString(margin_x, margin_y - 8*mm, info_text)
    c.drawString(margin_x, margin_y - 12*mm, "IMPORTANT: Print at 100% Scale (Actual Size). Do not 'Fit to Page'.")

    c.showPage()
    c.save()
    print(f"Success! Generated '{filename}'")

if __name__ == "__main__":
    draw_calibration_sheet()
