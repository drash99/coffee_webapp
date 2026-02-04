import sys

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import LETTER
    from reportlab.lib import colors
    from reportlab.lib.colors import CMYKColor
    from reportlab.lib.units import mm
except ImportError:
    print("This script requires 'reportlab'. Please install it using:")
    print("pip install reportlab")
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
    # 1. Corner Markers (Perspective Detection)
    # ---------------------------------------------------------
    # Drawing solid black squares at the exact corners of the calib rect.
    marker_size = 10 * mm 
    
    # Helper to draw a specialized fiducial marker (e.g., ArUco-like or just a square with a white inner)
    # For simplicity and high contrast, we use a black square with a white center dot.
    def draw_fiducial(x, y):
        c.setFillColor(colors.black)
        c.rect(x, y, marker_size, marker_size, fill=1, stroke=0)
        # Center white dot for sub-pixel accuracy if needed later
        c.setFillColor(colors.white)
        c.circle(x + marker_size/2, y + marker_size/2, 1.5*mm, fill=1, stroke=0)

    # Bottom-Left
    draw_fiducial(margin_x, margin_y)
    # Bottom-Right
    draw_fiducial(margin_x + calib_w - marker_size, margin_y)
    # Top-Left
    draw_fiducial(margin_x, margin_y + calib_h - marker_size)
    # Top-Right
    draw_fiducial(margin_x + calib_w - marker_size, margin_y + calib_h - marker_size)

    # Draw the boundary lines (optional, helpful for cutting, but dashed to not confuse CV too much)
    c.setLineWidth(0.5)
    c.setStrokeColor(colors.gray)
    c.setDash(2, 4)
    c.rect(margin_x, margin_y, calib_w, calib_h, stroke=1, fill=0)
    c.setDash([]) # Reset dash

    # ---------------------------------------------------------
    # 2. Checkerboard (Lens Distortion)
    # ---------------------------------------------------------
    # Placing it near Top-Left, below the marker
    check_start_x = margin_x + 15 * mm
    check_start_y = margin_y + calib_h - 40 * mm
    check_cell_size = 5 * mm
    rows, cols = 5, 8 # 5x8 grid
    
    c.setStrokeColor(colors.black)
    c.setLineWidth(1)
    
    for r in range(rows):
        for col in range(cols):
            if (r + col) % 2 == 0:
                c.setFillColor(colors.black)
            else:
                c.setFillColor(colors.white)
            c.rect(check_start_x + col*check_cell_size, check_start_y + r*check_cell_size, check_cell_size, check_cell_size, fill=1, stroke=1)
    
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8)
    c.drawString(check_start_x, check_start_y - 4*mm, "Distortion Check")

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

