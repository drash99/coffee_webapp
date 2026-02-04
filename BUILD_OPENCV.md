# Building OpenCV.js with ArUco Support

## Option 1: Use Pre-built OpenCV.js (Easier)

You can download a pre-built OpenCV.js with ArUco from:
- https://docs.opencv.org/4.8.0/opencv.js (standard build, may not have ArUco)
- Or use a community build that includes contrib modules

**Quick Start:**
1. Download `opencv.js` and `opencv.wasm` 
2. Place them in the `public/` directory
3. The worker will automatically load from `/opencv.js`

## Option 2: Build from Source (Advanced)

If you need to build OpenCV.js with ArUco support yourself:

### Prerequisites
- Emscripten SDK
- Python 3
- Git

### Steps

1. **Install Emscripten:**
```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

2. **Run the build script:**
```bash
chmod +x build_opencv.sh
./build_opencv.sh
```

This will:
- Clone OpenCV and opencv_contrib repositories
- Configure build with ArUco module
- Compile to WebAssembly
- Copy `opencv.js` and `opencv.wasm` to `public/`

**Note:** The build process can take 30-60 minutes and requires significant disk space (~5GB).

### Alternative: Use js-aruco Library

If building OpenCV.js is too complex, you can use a pure JavaScript ArUco library:
- https://github.com/jcmellado/js-aruco
- This is lighter weight but requires separate integration

The current worker code includes a fallback to square marker detection if ArUco is not available.

