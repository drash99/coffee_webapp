import cv2
import numpy as np
import sys
import math

try:
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.colors import CMYKColor
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    # Use ReportLab's ImageReader to embed numpy arrays
    from reportlab.lib.utils import ImageReader
except ImportError:
    print("This script requires 'reportlab' and 'opencv-python'. Please install them using:")
    print("pip install reportlab opencv-python Pillow")
    sys.exit(1)


def draw_calibration_sheet_a4(filename="calibration_target_a4.pdf"):
    """
    A4 version of the calibration sheet.
    - Page: A4
    - Calibration rectangle: 180mm x 250mm (same as Letter version)
    - ArUco markers (IDs 0-3) at the corners of the calibration rectangle
    - 10mm distortion grid excluding the stage square + markers
    - 10cm ruler
    - CMYK + grayscale patches
    - 100mm x 100mm square stage
    """
    c = canvas.Canvas(filename, pagesize=A4)
    width, height = A4

    # ---------------------------------------------------------
    # CONFIGURATION (keep calibration region identical across paper sizes)
    # ---------------------------------------------------------
    calib_w = 180 * mm
    calib_h = 250 * mm

    # Center calibration rect on A4
    margin_x = (width - calib_w) / 2
    margin_y = (height - calib_h) / 2

    # ---------------------------------------------------------
    # 1. Corner Markers (ArUco 4x4)
    # ---------------------------------------------------------
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    marker_size = 15 * mm  # 15mm for better visibility

    def draw_aruco_png(x, y, id_val):
        marker_img = cv2.aruco.generateImageMarker(aruco_dict, id_val, 200, borderBits=1)
        marker_rgb = cv2.cvtColor(marker_img, cv2.COLOR_GRAY2RGB)

        from PIL import Image
        pil_img = Image.fromarray(marker_rgb)

        # Quiet zone background
        pad = 1 * mm
        c.setFillColor(colors.white)
        c.rect(x - pad, y - pad, marker_size + 2 * pad, marker_size + 2 * pad, fill=1, stroke=0)

        c.drawImage(ImageReader(pil_img), x, y, width=marker_size, height=marker_size, mask=None)

    # Bottom-Left (ID 3)
    draw_aruco_png(margin_x, margin_y, 3)
    # Bottom-Right (ID 2)
    draw_aruco_png(margin_x + calib_w - marker_size, margin_y, 2)
    # Top-Left (ID 0)
    draw_aruco_png(margin_x, margin_y + calib_h - marker_size, 0)
    # Top-Right (ID 1)
    draw_aruco_png(margin_x + calib_w - marker_size, margin_y + calib_h - marker_size, 1)

    # Boundary (dashed)
    c.setLineWidth(0.5)
    c.setStrokeColor(colors.gray)
    c.setDash(2, 4)
    c.rect(margin_x, margin_y, calib_w, calib_h, stroke=1, fill=0)
    c.setDash([])

    # ---------------------------------------------------------
    # 2. Distortion Grid (Full coverage except Stage)
    # ---------------------------------------------------------
    grid_step = 10 * mm
    stage_center_x = width / 2
    stage_center_y = height / 2 + 10 * mm
    stage_size = 100 * mm  # 100mm x 100mm square
    stage_half = stage_size / 2

    c.setStrokeColor(colors.lightgrey)
    c.setLineWidth(0.5)

    x_start = margin_x
    x_end = margin_x + calib_w
    y_start = margin_y
    y_end = margin_y + calib_h

    # Vertical lines
    x = x_start
    while x <= x_end:
        stage_left = stage_center_x - stage_half
        stage_right = stage_center_x + stage_half

        m_sz = 15 * mm
        in_left_marker_col = abs(x - margin_x) < 0.1 * mm or abs(x - (margin_x + m_sz)) < 0.1 * mm or (margin_x < x < margin_x + m_sz)
        in_right_marker_col = abs(x - (margin_x + calib_w - m_sz)) < 0.1 * mm or abs(x - (margin_x + calib_w)) < 0.1 * mm or (margin_x + calib_w - m_sz < x < margin_x + calib_w)

        segments = [(y_start, y_end)]

        if in_left_marker_col or in_right_marker_col:
            segments = [(margin_y + m_sz + 1 * mm, y_end)]
            segments[0] = (segments[0][0], margin_y + calib_h - m_sz - 1 * mm)

        final_segments = []
        for (seg_y1, seg_y2) in segments:
            if stage_left <= x <= stage_right:
                stage_top = stage_center_y - stage_half
                stage_bottom = stage_center_y + stage_half
                if seg_y1 < stage_top:
                    final_segments.append((seg_y1, min(seg_y2, stage_top)))
                if seg_y2 > stage_bottom:
                    final_segments.append((max(seg_y1, stage_bottom), seg_y2))
            else:
                final_segments.append((seg_y1, seg_y2))

        for (y1, y2) in final_segments:
            if y2 > y1:
                c.line(x, y1, x, y2)

        x += grid_step

    # Horizontal lines
    y = y_start
    while y <= y_end:
        stage_top = stage_center_y - stage_half
        stage_bottom = stage_center_y + stage_half

        m_sz = 15 * mm
        in_bottom_marker_row = margin_y <= y <= margin_y + m_sz
        in_top_marker_row = margin_y + calib_h - m_sz <= y <= margin_y + calib_h

        segments = [(x_start, x_end)]

        if in_bottom_marker_row or in_top_marker_row:
            segments = [(margin_x + m_sz + 1 * mm, margin_x + calib_w - m_sz - 1 * mm)]

        final_segments = []
        for (seg_x1, seg_x2) in segments:
            if stage_top <= y <= stage_bottom:
                stage_left = stage_center_x - stage_half
                stage_right = stage_center_x + stage_half
                if seg_x1 < stage_left:
                    final_segments.append((seg_x1, min(seg_x2, stage_left)))
                if seg_x2 > stage_right:
                    final_segments.append((max(seg_x1, stage_right), seg_x2))
            else:
                final_segments.append((seg_x1, seg_x2))

        for (x1, x2) in final_segments:
            if x2 > x1:
                c.line(x1, y, x2, y)

        y += grid_step

    c.setFillColor(colors.black)
    c.setFont("Helvetica", 6)
    c.drawString(margin_x + 100 * mm, margin_y + 2 * mm, "10mm Distortion Grid")

    # ---------------------------------------------------------
    # 3. 10cm Ruler (Scale Verification)
    # ---------------------------------------------------------
    ruler_len = 100 * mm
    ruler_x = (width - ruler_len) / 2
    ruler_y = margin_y + 20 * mm

    c.setLineWidth(1.5)
    c.setStrokeColor(colors.black)
    c.line(ruler_x, ruler_y, ruler_x + ruler_len, ruler_y)

    c.setLineWidth(1)
    for i in range(11):
        x_pos = ruler_x + (i * 10 * mm)
        height_tick = 5 * mm if i % 5 == 0 else 3 * mm
        c.line(x_pos, ruler_y, x_pos, ruler_y + height_tick)
        c.drawCentredString(x_pos, ruler_y - 4 * mm, f"{i}")

    c.drawCentredString(width / 2, ruler_y - 8 * mm, "10 cm Scale")

    # ---------------------------------------------------------
    # 4. Color & Grayscale Patches (Calibration)
    # ---------------------------------------------------------
    patch_size = 12 * mm
    gap = 2 * mm
    patch_start_x = margin_x + calib_w - (5 * (patch_size + gap)) - 10 * mm
    patch_start_y = margin_y + calib_h - 35 * mm

    # CMYK row
    c.setFillColor(CMYKColor(1, 0, 0, 0))
    c.rect(patch_start_x, patch_start_y, patch_size, patch_size, fill=1, stroke=1)
    c.setFillColor(CMYKColor(0, 1, 0, 0))
    c.rect(patch_start_x + 1 * (patch_size + gap), patch_start_y, patch_size, patch_size, fill=1, stroke=1)
    c.setFillColor(CMYKColor(0, 0, 1, 0))
    c.rect(patch_start_x + 2 * (patch_size + gap), patch_start_y, patch_size, patch_size, fill=1, stroke=1)
    c.setFillColor(CMYKColor(0, 0, 0, 1))
    c.rect(patch_start_x + 3 * (patch_size + gap), patch_start_y, patch_size, patch_size, fill=1, stroke=1)

    # Grayscale ramp (11 steps)
    gray_patch_size = 8 * mm
    gray_gap = 1.5 * mm
    num_steps = 11

    gray_row_width = num_steps * gray_patch_size + (num_steps - 1) * gray_gap
    cmyk_end_x = patch_start_x + 4 * patch_size + 3 * gap
    gray_start_x = cmyk_end_x - gray_row_width
    gray_y = patch_start_y - (gray_patch_size + 6 * mm)

    for i in range(num_steps):
        k_val = i / 10.0
        c.setFillColor(CMYKColor(0, 0, 0, k_val))
        gx = gray_start_x + i * (gray_patch_size + gray_gap)
        c.rect(gx, gray_y, gray_patch_size, gray_patch_size, fill=1, stroke=1)

        if i == 0:
            c.setFillColor(colors.black)
            c.drawCentredString(gx + gray_patch_size / 2, gray_y - 3 * mm, "0")
        elif i == 5:
            c.setFillColor(colors.black)
            c.drawCentredString(gx + gray_patch_size / 2, gray_y - 3 * mm, "50")
        elif i == 10:
            c.setFillColor(colors.black)
            c.drawCentredString(gx + gray_patch_size / 2, gray_y - 3 * mm, "100")

    # ---------------------------------------------------------
    # 5. Central Stage (100mm x 100mm square)
    # ---------------------------------------------------------
    c.setStrokeColor(colors.lightgrey)
    c.setLineWidth(2)
    stage_x = stage_center_x - stage_half
    stage_y = stage_center_y - stage_half
    c.rect(stage_x, stage_y, stage_size, stage_size, fill=0, stroke=1)

    # ---------------------------------------------------------
    # Metadata
    # ---------------------------------------------------------
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8)
    info_text = f"BeanLog Calibration Sheet (A4) | Dimensions: {calib_w/mm:.1f}mm x {calib_h/mm:.1f}mm"
    c.drawString(margin_x, margin_y - 8 * mm, info_text)
    c.drawString(margin_x, margin_y - 12 * mm, "IMPORTANT: Print at 100% Scale (Actual Size). Do not 'Fit to Page'.")

    c.showPage()
    c.save()
    print(f"Success! Generated '{filename}'")


if __name__ == "__main__":
    draw_calibration_sheet_a4()


