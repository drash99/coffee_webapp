const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const repo = path.resolve(__dirname, '..');

async function loadCvWorker() {
  // Use the same bundled WASM and worker source as the app, without a browser mock.
  const moduleShim = { exports: {} };
  new Function('module', 'exports', fs.readFileSync(path.join(repo, 'public/opencv.js'), 'utf8'))(
    moduleShim, moduleShim.exports,
  );
  const cv = await moduleShim.exports;
  const logs = [];
  const messages = [];
  const logger = Object.fromEntries(['log', 'warn', 'error'].map(level => [
    level, (...args) => logs.push(args),
  ]));
  const context = vm.createContext({
    self: {}, exports: {}, console: logger, Uint8Array, Float32Array,
    postMessage: message => messages.push(message), __cv: cv,
  });
  const source = fs.readFileSync(path.join(repo, 'src/workers/cv.worker.ts'), 'utf8');
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  vm.runInContext('cv = __cv', context);

  let activeHandles = null;
  let lastHandleCounts = {};
  const restorers = [];
  function record(handle, label) {
    if (activeHandles) activeHandles.set(handle, label);
    return handle;
  }
  function replace(owner, key, value) {
    const original = owner[key];
    owner[key] = value;
    restorers.push(() => { owner[key] = original; });
  }
  for (const name of ['Mat', 'MatVector', 'aruco_DetectorParameters', 'aruco_RefineParameters', 'aruco_ArucoDetector']) {
    const ctor = cv[name];
    assert.equal(typeof ctor, 'function', `bundled OpenCV is missing ${name}`);
    replace(cv, name, new Proxy(ctor, {
      construct(target, args) { return record(Reflect.construct(target, args), name); },
    }));
  }
  for (const [owner, key] of [
    [cv.Mat.prototype, 'clone'], [cv.Mat.prototype, 'roi'],
    [cv.MatVector.prototype, 'get'],
    [cv, 'getStructuringElement'], [cv, 'getPerspectiveTransform'],
    [cv, 'getPredefinedDictionary'],
  ]) {
    const original = owner[key];
    // Embind dispatchers read overload metadata from the installed function.
    replace(owner, key, new Proxy(original, {
      apply(target, receiver, args) { return record(Reflect.apply(target, receiver, args), key); },
    }));
  }

  function checked(run) {
    assert.equal(activeHandles, null, 'handle checks must not overlap');
    activeHandles = new Map();
    try {
      return run();
    } finally {
      const leaked = [...activeHandles].filter(([handle]) => !handle.isDeleted());
      lastHandleCounts = {};
      for (const label of activeHandles.values()) {
        lastHandleCounts[label] = (lastHandleCounts[label] || 0) + 1;
      }
      activeHandles = null;
      // Clean a failed test's leaks only after recording them, so later tests can run.
      for (const [handle] of leaked.reverse()) handle.delete();
      assert.deepEqual(leaked.map(([, label]) => label), [], 'worker leaked native OpenCV handles');
    }
  }

  function invoke(name, ...args) {
    context.args = args;
    try {
      return vm.runInContext(`${name}(...args)`, context);
    } finally {
      delete context.args;
    }
  }
  function input(mat, mode = 'bean') {
    return {
      imageData: { width: mat.cols, height: mat.rows, data: new Uint8Array(mat.data) },
      width: mat.cols, height: mat.rows, rulerLengthMm: 100, mode,
    };
  }
  function process(mat, mode = 'bean') {
    logs.length = 0;
    messages.length = 0;
    return checked(() => invoke('processImage', input(mat, mode)));
  }
  return {
    cv, context, logs, messages, checked, invoke, input, process,
    handleCounts: () => lastHandleCounts,
    restore: () => restorers.reverse().forEach(restore => restore()),
  };
}

function withOverride(owner, key, replacement, run) {
  const original = owner[key];
  owner[key] = typeof original === 'function' && typeof replacement === 'function'
    ? new Proxy(original, { apply: (_target, receiver, args) => Reflect.apply(replacement, receiver, args) })
    : replacement;
  try { return run(original); } finally { owner[key] = original; }
}

function identityLuts() {
  return Object.fromEntries(['r', 'g', 'b'].map(channel => [
    channel, Uint8Array.from({ length: 256 }, (_, value) => value),
  ]));
}

function whiteImage(cv, width = 240, height = width) {
  const mat = new cv.Mat(height, width, cv.CV_8UC4);
  mat.setTo(new cv.Scalar(255, 255, 255, 255));
  return mat;
}

function calibrationSheet(cv, { ids = [0, 1, 2, 3], particle = false } = {}) {
  // The worker's 180 x 250 mm calibration rectangle at 4 px/mm, with 40 px margins.
  const scale = 4;
  const pad = 40;
  const sheet = whiteImage(cv, 800, 1080);
  const dictionary = cv.getPredefinedDictionary(cv.DICT_4X4_50);
  try {
    for (const [index, [x, y]] of [[0, 0], [165, 0], [165, 235], [0, 235]].entries()) {
      if (ids[index] == null) continue;
      const marker = new cv.Mat();
      const rgba = new cv.Mat();
      const roi = sheet.roi(new cv.Rect(pad + x * scale, pad + y * scale, 60, 60));
      try {
        cv.generateImageMarker(dictionary, ids[index], 60, marker, 1);
        cv.cvtColor(marker, rgba, cv.COLOR_GRAY2RGBA);
        rgba.copyTo(roi);
      } finally {
        roi.delete();
        rgba.delete();
        marker.delete();
      }
    }
    function rect(x, y, width, height, rgb) {
      cv.rectangle(sheet,
        new cv.Point(pad + x * scale, pad + y * scale),
        new cv.Point(pad + (x + width) * scale, pad + (y + height) * scale),
        new cv.Scalar(...rgb, 255), -1);
    }
    for (let i = 0; i < 11; i++) {
      const level = Math.round(255 - i * 23.5);
      rect(51 + 9.5 * i, 41, 8, 8, [level, level, level]);
    }
    [[0, 255, 255], [255, 0, 255], [255, 255, 0], [0, 0, 0]].forEach((rgb, i) => {
      rect(100 + 14 * i, 23, 12, 12, rgb);
    });
    cv.ellipse(sheet, new cv.Point(pad + 90 * scale, pad + 115 * scale),
      new cv.Size(particle ? 3 : 18, particle ? 2 : 12), 0, 0, 360,
      new cv.Scalar(120, 80, 40, 255), -1);
    return sheet;
  } catch (error) {
    sheet.delete();
    throw error;
  } finally {
    dictionary.delete();
  }
}

module.exports = { loadCvWorker, withOverride, identityLuts, whiteImage, calibrationSheet };
