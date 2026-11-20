const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  loadCvWorker, withOverride, identityLuts, whiteImage, calibrationSheet,
} = require('./cv-test-helper.cjs');

test('CV regressions with the bundled OpenCV runtime', async t => {
  const worker = await loadCvWorker();
  const { cv } = worker;
  const sheet = calibrationSheet(cv);
  const luts = identityLuts();
  const wb = { r: 1, g: 1, b: 1 };
  t.after(() => { sheet.delete(); worker.restore(); });

  function analyze(stage, mode) {
    return worker.checked(() => mode === 'grind'
      ? worker.invoke('analyzeGrind', stage, luts, 1)
      : worker.invoke('analyzeBeans', stage, luts, wb, 1));
  }
  function validPreview(result, key = 'stageImageData') {
    const preview = result[key];
    assert.ok(preview.width > 0 && preview.height > 0);
    assert.equal(preview.data.length, preview.width * preview.height * 4);
    assert.ok(preview.data.some(value => value > 0));
  }
  function acceptedQuad() {
    assert.ok(worker.logs.some(([label]) => label.includes('quad accepted')));
    assert.ok(!worker.logs.some(([label]) => label.includes('Fallback')));
  }
  function close(actual, expected, tolerance, label) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
      `${label}: ${actual} vs ${expected} (tolerance ${tolerance})`);
  }

  let reference;
  await t.test('normal exposure calibrates one bean and releases every handle', () => {
    const result = worker.process(sheet);
    acceptedQuad();
    assert.equal(result.beans.length, 1);
    reference = result.beans[0];
    assert.ok(reference.majorMm > 8 && reference.majorMm < 10);
    assert.ok(reference.luma > 50 && reference.luma < 100);
    validPreview(result);
    validPreview(result, 'warpedImageData');
    for (const key of ['Mat', 'MatVector', 'clone', 'roi', 'get', 'getStructuringElement',
      'getPerspectiveTransform', 'getPredefinedDictionary', 'aruco_ArucoDetector',
      'aruco_DetectorParameters', 'aruco_RefineParameters']) {
      assert.ok(worker.handleCounts()[key] > 0, `tracker did not observe ${key}`);
    }
  });

  await t.test('half exposure uses WB measured after LUT correction', () => {
    const dark = sheet.clone();
    try {
      for (let i = 0; i < dark.data.length; i += 4) {
        for (let channel = 0; channel < 3; channel++) {
          dark.data[i + channel] = Math.round(dark.data[i + channel] / 2);
        }
      }
      for (let repeat = 0; repeat < 3; repeat++) {
        const normal = worker.process(sheet).beans[0];
        const result = worker.process(dark);
        acceptedQuad();
        assert.equal(result.beans.length, 1);
        const bean = result.beans[0];
        for (const channel of ['r', 'g', 'b', 'luma']) close(bean[channel], normal[channel], 2, channel);
        close(bean.majorMm, normal.majorMm, 0.1, 'majorMm');
        assert.ok(bean.luma < 100, 'the same dark roast must not become medium');
      }
    } finally { dark.delete(); }
  });

  for (const [degrees, rotation] of [
    [90, cv.ROTATE_90_CLOCKWISE], [180, cv.ROTATE_180], [270, cv.ROTATE_90_COUNTERCLOCKWISE],
  ]) {
    await t.test(`${degrees}-degree rotation retains ID-based calibration and measurements`, () => {
      const rotated = new cv.Mat();
      try {
        cv.rotate(sheet, rotated, rotation);
        const result = worker.process(rotated);
        acceptedQuad();
        assert.equal(result.beans.length, 1);
        const bean = result.beans[0];
        close(bean.majorMm, reference.majorMm, 0.1, 'majorMm');
        close(bean.minorMm, reference.minorMm, 0.1, 'minorMm');
        close(bean.luma, reference.luma, 2, 'luma');
      } finally { rotated.delete(); }
    });
  }

  await t.test('perspective foreshortening preserves the ID-ordered marker quad', () => {
    const from = new cv.Mat(4, 1, cv.CV_32FC2);
    const to = new cv.Mat(4, 1, cv.CV_32FC2);
    from.data32F.set([0, 0, 800, 0, 800, 1080, 0, 1080]);
    to.data32F.set([180, 30, 450, 80, 480, 1070, 120, 1040]);
    const transform = cv.getPerspectiveTransform(from, to);
    const projected = new cv.Mat();
    try {
      cv.warpPerspective(sheet, projected, transform, new cv.Size(600, 1100),
        cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
      const result = worker.process(projected);
      acceptedQuad();
      assert.equal(result.beans.length, 1);
      close(result.beans[0].majorMm, reference.majorMm, 0.5, 'majorMm');
    } finally {
      projected.delete(); transform.delete(); to.delete(); from.delete();
    }
  });

  await t.test('marker validation uses resized input coordinates', () => {
    const large = new cv.Mat();
    try {
      cv.resize(sheet, large, new cv.Size(2400, 3240), 0, 0, cv.INTER_NEAREST);
      const result = worker.process(large);
      acceptedQuad();
      assert.ok(worker.logs.some(([label]) => label.includes('Resized input')));
      assert.equal(result.beans.length, 1);
      close(result.beans[0].majorMm, reference.majorMm, 0.15, 'majorMm');
    } finally { large.delete(); }
  });

  for (const mode of ['grind', 'bean']) {
    await t.test(`${mode} exclusion mask removes outside objects from analysis and outlines`, () => {
      const stage = whiteImage(cv);
      try {
        const color = new cv.Scalar(50, 30, 20, 255);
        if (mode === 'grind') {
          cv.circle(stage, new cv.Point(120, 120), 5, color, -1);
          cv.circle(stage, new cv.Point(12, 12), 5, color, -1);
        } else {
          cv.ellipse(stage, new cv.Point(120, 120), new cv.Size(12, 8), 0, 0, 360, color, -1);
          cv.ellipse(stage, new cv.Point(16, 16), new cv.Size(12, 8), 0, 0, 360, color, -1);
        }
        const originalPixels = new Uint8Array(stage.data);
        let previous;
        for (let repeat = 0; repeat < 3; repeat++) {
          const result = analyze(stage, mode);
          const objects = mode === 'grind' ? result.particles : result.beans;
          assert.equal(objects.length, 1);
          assert.ok(worker.handleCounts().get > 0);
          if (previous) assert.deepEqual(objects, previous);
          previous = objects;
          validPreview(result);
          // The outside object is still visible but must not acquire a green outline.
          const { data, width } = result.stageImageData;
          for (let y = 0; y < 18; y++) {
            for (let x = 0; x < 18; x++) {
              const pixel = (y * width + x) * 4;
              assert.ok(!(data[pixel + 1] > data[pixel] + 20 && data[pixel + 1] > data[pixel + 2] + 20));
            }
          }
        }
        assert.deepEqual(stage.data, originalPixels, 'analysis must not mutate its borrowed stage ROI');
      } finally { stage.delete(); }
    });

    await t.test(`${mode} blank stage returns empty results and a preview`, () => {
      const stage = whiteImage(cv);
      try {
        for (let repeat = 0; repeat < 3; repeat++) {
          const result = analyze(stage, mode);
          assert.equal((mode === 'grind' ? result.particles : result.beans).length, 0);
          validPreview(result);
        }
      } finally { stage.delete(); }
    });
  }

  await t.test('all grind candidates can be filtered without a RangeError or leaks', () => {
    const stage = whiteImage(cv);
    try {
      cv.circle(stage, new cv.Point(120, 120), 35, new cv.Scalar(50, 30, 20, 255), -1);
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = analyze(stage, 'grind');
        assert.ok(worker.handleCounts().get > 0, 'must exercise the filtered contour branch');
        assert.equal(result.particles.length, 0);
        validPreview(result);
      }
    } finally { stage.delete(); }
  });

  await t.test('tiny, oversized, and polygonal contours release handles when skipped', () => {
    const cases = [
      { mode: 'grind', radius: 1, skipped: (area) => area < 10 },
      { mode: 'grind', radius: 65, skipped: (area) => area > 240 * 240 * 0.2 },
      { mode: 'grind', rectangle: true, skipped: (area, rows) => area >= 10 && rows < 5 },
      { mode: 'bean', radius: 3, skipped: (area) => area < 50 },
    ];
    for (const fixture of cases) {
      const stage = whiteImage(cv);
      const observed = [];
      try {
        const color = new cv.Scalar(50, 30, 20, 255);
        if (fixture.rectangle) {
          cv.rectangle(stage, new cv.Point(110, 110), new cv.Point(130, 130), color, -1);
        } else {
          cv.circle(stage, new cv.Point(120, 120), fixture.radius, color, -1);
        }
        const original = cv.contourArea;
        withOverride(cv, 'contourArea', function (contour, ...args) {
          const area = original.call(this, contour, ...args);
          observed.push({ area, rows: contour.rows });
          return area;
        }, () => {
          const result = analyze(stage, fixture.mode);
          assert.equal((fixture.mode === 'grind' ? result.particles : result.beans).length, 0);
        });
        assert.ok(observed.some(({ area, rows }) => fixture.skipped(area, rows)),
          `did not reach the intended ${fixture.mode} filter: ${JSON.stringify(observed)}`);
      } finally { stage.delete(); }
    }
  });

  await t.test('bean shape filtering and preview contours release borrowed handles', () => {
    const stage = whiteImage(cv);
    try {
      cv.ellipse(stage, new cv.Point(120, 120), new cv.Size(45, 5), 0, 0, 360,
        new cv.Scalar(50, 30, 20, 255), -1);
      const result = analyze(stage, 'bean');
      assert.equal(result.beans.length, 0);
      assert.ok(worker.logs.some(([label]) => label.includes('filtered contour with aspect ratio')));
      assert.ok(worker.handleCounts().get >= 2);
    } finally { stage.delete(); }
  });

  await t.test('full grind pipeline succeeds repeatedly and releases calibration resources', () => {
    const particles = calibrationSheet(cv, { particle: true });
    try {
      for (let repeat = 0; repeat < 3; repeat++) {
        const result = worker.process(particles, 'grind');
        acceptedQuad();
        assert.equal(result.particles.length, 1);
        validPreview(result);
      }
    } finally { particles.delete(); }
  });

  await t.test('ArUco unavailable and detector failures both clean up successful fallbacks', () => {
    const detectMarkers = cv.aruco_ArucoDetector.prototype.detectMarkers;
    for (let repeat = 0; repeat < 2; repeat++) {
      withOverride(cv, 'getPredefinedDictionary', undefined, () => {
        const result = worker.process(sheet);
        assert.ok(worker.logs.some(([label]) => label.includes('Fallback: markers found')));
        validPreview(result);
      });
      withOverride(cv.aruco_ArucoDetector.prototype, 'detectMarkers', function (...args) {
        detectMarkers.apply(this, args);
        throw new Error('injected detector failure');
      }, () => {
        const result = worker.process(sheet);
        assert.ok(worker.logs.some(([label]) => label.includes('ArUco detection failed')));
        assert.ok(worker.logs.some(([label]) => label.includes('Fallback: markers found')));
        validPreview(result);
      });
    }
  });

  await t.test('missing and unexpected marker IDs clean up before fallback', () => {
    for (const ids of [[0, 1, 2, null], [0, 1, 2, 4]]) {
      const incomplete = calibrationSheet(cv, { ids });
      try {
        worker.process(incomplete);
        assert.ok(worker.logs.some(([label]) => label.includes('Fallback: markers found')));
        assert.ok(worker.logs.some(([label]) => label.includes(ids[3] == null ? 'fewer than 4' : 'need ids')));
      } finally { incomplete.delete(); }
    }
  });

  await t.test('crossed ID-ordered marker quad is rejected and its handles released', () => {
    const crossed = calibrationSheet(cv, { ids: [0, 2, 1, 3] });
    try {
      worker.process(crossed);
      assert.ok(worker.logs.some(([label, detail]) => label.includes('quad rejected') && !detail.validQuad));
      assert.ok(worker.logs.some(([label]) => label.includes('Fallback: markers found')));
    } finally { crossed.delete(); }
  });

  await t.test('repeated no-marker errors release ArUco and fallback resources', () => {
    const blank = whiteImage(cv);
    try {
      for (let repeat = 0; repeat < 3; repeat++) {
        assert.throws(() => worker.process(blank), /Found only 0 markers/);
        assert.ok(worker.handleCounts().aruco_ArucoDetector > 0);
      }
    } finally { blank.delete(); }
  });

  await t.test('full pipeline failures at warp, gray/WB ROIs, analysis, and preview clean up', () => {
    for (const [key, failAt] of [
      ['warpPerspective', 1], ['mean', 1], ['mean', 12], ['mean', 16], ['resize', 2],
    ]) {
      for (let repeat = 0; repeat < 2; repeat++) {
        const original = cv[key];
        let calls = 0;
        withOverride(cv, key, function (...args) {
          if (++calls === failAt) throw new Error(`injected ${key} ${failAt}`);
          return original.apply(this, args);
        }, () => assert.throws(() => worker.process(sheet), /injected/));
        assert.equal(calls, failAt);
      }
    }
  });

  await t.test('fallback approximation failures release the contour, approximation, and input', () => {
    withOverride(cv, 'getPredefinedDictionary', undefined, () => {
      withOverride(cv, 'approxPolyDP', () => { throw new Error('injected approximation failure'); }, () => {
        for (let repeat = 0; repeat < 3; repeat++) {
          assert.throws(() => worker.process(sheet), /injected approximation/);
          assert.ok(worker.handleCounts().get > 0);
        }
      });
    });
  });

  await t.test('filter, bean mask, and outline failures release all analysis handles', () => {
    const stage = whiteImage(cv);
    try {
      cv.circle(stage, new cv.Point(120, 120), 8, new cv.Scalar(50, 30, 20, 255), -1);
      for (const mode of ['grind', 'bean']) {
        for (const key of ['contourArea', 'fitEllipse', 'drawContours', 'resize', 'setTo']) {
          const owner = key === 'setTo' ? cv.Mat.prototype : cv;
          withOverride(owner, key, () => { throw new Error(`injected ${key}`); }, () => {
            for (let repeat = 0; repeat < 2; repeat++) {
              assert.throws(() => analyze(stage, mode), /injected/);
            }
          });
        }
      }
      const original = cv.drawContours;
      let calls = 0;
      withOverride(cv, 'drawContours', function (...args) {
        if (++calls === 2) throw new Error('injected outline failure');
        return original.apply(this, args);
      }, () => assert.throws(() => analyze(stage, 'bean'), /injected outline/));
      assert.equal(calls, 2);
    } finally { stage.delete(); }
  });

  await t.test('resizing errors release both original and resized input handles', () => {
    const large = whiteImage(cv, 2050, 200);
    try {
      withOverride(cv, 'resize', () => { throw new Error('injected resize failure'); }, () => {
        assert.throws(() => worker.process(large), /injected resize/);
      });
      withOverride(cv, 'cvtColor', () => { throw new Error('injected grayscale failure'); }, () => {
        assert.throws(() => worker.process(large), /injected grayscale/);
      });
    } finally { large.delete(); }
  });

  await t.test('invalid image data releases a Mat even when initialization throws', () => {
    const input = {
      imageData: { width: 1, height: 1, data: new Uint8Array(8) },
      width: 1, height: 1, rulerLengthMm: 100, mode: 'grind',
    };
    assert.throws(() => worker.checked(() => worker.invoke('processImage', input)), /out of bounds/i);
  });
});
