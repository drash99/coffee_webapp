    # ---------------------------------------------------------
    # 1. Corner Markers (ArUco 4x4)
    # ---------------------------------------------------------
    # Replacing generic squares with ArUco Markers (DICT_4X4_50)
    # IDs: 0 (TL), 1 (TR), 2 (BR), 3 (BL)
    # Data is 4x4 bits. A marker adds a 1-bit black border -> 6x6 grid.
    # 0 = Black, 255 = White. We want 0->Black, 1->White for logic.
    
    # Hardcoded patterns for DICT_4X4_50 (IDs 0-3)
    # '0' means Black (Ink), '1' means White (Paper)
    ARUCO_PATTERNS = {
        0: [ # ID 0 (Top-Left)
            [1, 0, 1, 1],
            [0, 1, 0, 1],
            [0, 0, 1, 1],
            [0, 0, 1, 0]
        ],
        1: [ # ID 1 (Top-Right)
            [0, 1, 1, 1],
            [0, 0, 0, 1],
            [0, 0, 0, 0],
            [1, 1, 0, 1]
        ],
        2: [ # ID 2 (Bottom-Right)
            [0, 0, 0, 0],
            [0, 0, 1, 1],
            [0, 1, 0, 1],
            [1, 0, 0, 1]
        ],
        3: [ # ID 3 (Bottom-Left)
            [1, 0, 0, 1],
            [0, 1, 1, 0],
            [0, 0, 1, 0],
            [0, 1, 0, 0]
        ]
    }

    marker_size = 15 * mm # Slightly larger for better detection
    
    def draw_aruco(x, y, id_val):
        # Draw 6x6 grid (Border + 4x4 Data)
        cell_size = marker_size / 6.0
        
        # 1. Black Background (Border)
        c.setFillColor(colors.black)
        c.rect(x, y, marker_size, marker_size, fill=1, stroke=0)
        
        # 2. Draw White Data Bits
        pattern = ARUCO_PATTERNS[id_val]
        c.setFillColor(colors.white)
        
        # Grid: row 0 is top. PDF coords: y increases upwards.
        # So row 0 is at y + marker_size - cell_size
        
        for row in range(4):
            for col in range(4):
                if pattern[row][col] == 1: # White
                    # Inner grid starts at offset 1 cell
                    cx = x + (col + 1) * cell_size
                    cy = y + marker_size - (row + 2) * cell_size # +2 because row 0 is 1 cell down from top border
                    c.rect(cx, cy, cell_size, cell_size, fill=1, stroke=0)

    # Bottom-Left (ID 3)
    draw_aruco(margin_x, margin_y, 3)
    # Bottom-Right (ID 2)
    draw_aruco(margin_x + calib_w - marker_size, margin_y, 2)
    # Top-Left (ID 0)
    draw_aruco(margin_x, margin_y + calib_h - marker_size, 0)
    # Top-Right (ID 1)
    draw_aruco(margin_x + calib_w - marker_size, margin_y + calib_h - marker_size, 1)
