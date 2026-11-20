import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('sends ordered label images as one SDK job and preserves its result', () => {
  const source = readFileSync(resolve('ios/App/App/BrotherPrinterPlugin.swift'), 'utf8');
  const start = source.indexOf('    private func printImages(');
  const end = source.indexOf('\n    private func ', start + 1);
  expect(start).toBeGreaterThan(0);
  const method = source.slice(start, end).replace('private func', 'func');
  const fixture = `
import Foundation
final class CGImage {
    let id: Int
    init(_ id: Int) { self.id = id }
}
enum BRLMPrintErrorCode { case noError, failed }
final class BRLMPrintError {
    let code: BRLMPrintErrorCode
    init(_ code: BRLMPrintErrorCode) { self.code = code }
}
final class BRLMPTPrintSettings {}
final class BRLMPrinterDriver {
    typealias PrintImageClosure = () -> Unmanaged<CGImage>?
    var jobs: [[Int]] = []
    let result: BRLMPrintError
    init(_ code: BRLMPrintErrorCode) { result = BRLMPrintError(code) }
    func printImage(withClosures pages: [PrintImageClosure], settings: BRLMPTPrintSettings) -> BRLMPrintError {
        jobs.append(pages.map { $0()!.takeUnretainedValue().id })
        return result
    }
    func printImage(with image: CGImage, settings: BRLMPTPrintSettings) -> BRLMPrintError {
        jobs.append([image.id])
        return result
    }
}
struct PrintHarness {
${method}
}
for count in [1, 4, 200] {
    for code in [BRLMPrintErrorCode.noError, .failed] {
        let driver = BRLMPrinterDriver(code)
        let ids = Array(0..<count)
        let images = ids.map(CGImage.init)
        let result = PrintHarness().printImages(images, driver: driver, settings: BRLMPTPrintSettings())
        precondition(driver.jobs == [ids], "Each batch must share one job in label order")
        precondition(result === driver.result, "Keep the SDK error instead of reporting success")
    }
}
print("PASS: one job for 1/4/200 labels, preserving order and SDK errors")
`;
  const dir = mkdtempSync(join(tmpdir(), 'beanlog-batch-test-'));
  try {
    const file = join(dir, 'main.swift');
    writeFileSync(file, fixture);
    const output = execFileSync('xcrun', ['swift', '-module-cache-path', join(dir, 'cache'), file], {
      encoding: 'utf8', timeout: 30000,
    });
    expect(output).toContain('PASS: one job');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
