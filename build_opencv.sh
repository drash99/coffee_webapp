#!/bin/bash
# Build OpenCV.js with ArUco module support
# This script compiles OpenCV.js from source with contrib modules

set -e

echo "Building OpenCV.js with ArUco support..."

# Check if emscripten is installed
if ! command -v emcc &> /dev/null; then
    echo "Error: Emscripten not found. Please install it first:"
    echo "  git clone https://github.com/emscripten-core/emsdk.git"
    echo "  cd emsdk"
    echo "  ./emsdk install latest"
    echo "  ./emsdk activate latest"
    echo "  source ./emsdk_env.sh"
    exit 1
fi

# Ensure EMSCRIPTEN env var is set (OpenCV's build_js.py expects it)
if [ -z "$EMSCRIPTEN" ]; then
  if [ -n "$EMSDK" ] && [ -d "$EMSDK/upstream/emscripten" ]; then
    export EMSCRIPTEN="$EMSDK/upstream/emscripten"
  else
    # Fallback: infer from emcc path
    export EMSCRIPTEN="$(dirname "$(command -v emcc)")"
  fi
fi

echo "EMSCRIPTEN=$EMSCRIPTEN"


# Create build directory
BUILD_DIR="opencv_build"
mkdir -p $BUILD_DIR
cd $BUILD_DIR

# Clone OpenCV if not exists
if [ ! -d "opencv" ]; then
    echo "Cloning OpenCV repository..."
    git clone https://github.com/opencv/opencv.git --depth 1 --branch 4.8.0
fi

if [ ! -d "opencv_contrib" ]; then
    echo "Cloning OpenCV contrib repository..."
    git clone https://github.com/opencv/opencv_contrib.git --depth 1 --branch 4.8.0
fi

cd opencv
# inside opencv repo root (after: cd opencv)
CONTRIB_MODULES="$(realpath ../opencv_contrib/modules)"

python3 platforms/js/build_js.py build_wasm \
  --build_wasm \
  --cmake_option="-DOPENCV_EXTRA_MODULES_PATH=${CONTRIB_MODULES}" \
  --cmake_option="-DBUILD_LIST=core,imgproc,calib3d,photo,aruco" \
  --cmake_option="-DBUILD_opencv_js=ON" \
  --cmake_option="-DBUILD_SHARED_LIBS=OFF" \
  --cmake_option="-DBUILD_TESTS=OFF" \
  --cmake_option="-DBUILD_PERF_TESTS=OFF" \
  --cmake_option="-DBUILD_DOCS=OFF" \
  --cmake_option="-DBUILD_EXAMPLES=OFF" \
  --cmake_option="-DWITH_IPP=OFF" \
  --cmake_option="-DWITH_TBB=OFF" \
  --cmake_option="-DWITH_OPENCL=OFF" \
  --cmake_option="-DWITH_OPENMP=OFF" \
  --cmake_option="-DWITH_PTHREADS=OFF"
  --build_flags="-Oz -s WASM=1 -s ALLOW_MEMORY_GROWTH=1"



echo "Build complete! Copying opencv.js to public directory..."
cp build_wasm/bin/opencv.js ../../public/
cp build_wasm/bin/opencv.wasm ../../public/

echo "Done! opencv.js and opencv.wasm are in the public/ directory."

