import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('serializes SDK status without inventing battery values or tape remaining', () => {
  const source = readFileSync(resolve('ios/App/App/BrotherPrinterPlugin.swift'), 'utf8');
  const start = source.indexOf('    private func printerStatusPayload(');
  const end = source.indexOf('\n    private func ', start + 1);
  expect(start).toBeGreaterThan(0);
  const method = source.slice(start, end).replace('private func', 'func');
  const fixture = `
import Foundation
enum BRLMPrinterStatusErrorCode: CaseIterable {
    case noError, noPaper, coverOpen, busy, paperJam, highVoltageAdapter, batteryEmpty, batteryTrouble
    case tubeNotDetected, motorSlow, unsupportedCharger, incompatibleOptionalEquipment, systemError, anotherError
}
enum BatteryTernary { case yes, no, unknown }
struct BatteryFraction { var max: Int32; var current: Int32 }
struct BatteryStatus {
    var chargeLevel = BatteryFraction(max: 3, current: 2)
    var charging = BatteryTernary.yes
    var batteryMounted = BatteryTernary.yes
}
struct MediaInfo { var width_mm: Int32 = 24 }
struct BRLMPrinterStatus {
    var errorCode = BRLMPrinterStatusErrorCode.noError
    var batteryStatus: BatteryStatus? = BatteryStatus()
    var mediaInfo: MediaInfo? = MediaInfo()
}
struct Harness {
${method}
}
let harness = Harness()
let good = harness.printerStatusPayload(BRLMPrinterStatus())
precondition(good["state"] as? String == "ready")
let battery = good["battery"] as! [String: Any]
precondition(battery["level"] as? Int == 2 && battery["maxLevel"] as? Int == 3)
precondition(battery["charging"] as? Bool == true && battery["mounted"] as? Bool == true)
let media = good["media"] as! [String: Any]
precondition(media["widthMm"] as? Int == 24 && media.count == 1)
for fraction in [BatteryFraction(max: -1, current: -1), .init(max: 0, current: 0), .init(max: 3, current: 4)] {
    let status = BRLMPrinterStatus(batteryStatus: .init(chargeLevel: fraction, charging: .unknown, batteryMounted: .unknown), mediaInfo: .init(width_mm: 0))
    let payload = harness.printerStatusPayload(status)
    precondition((payload["battery"] as! [String: Any]).isEmpty)
    precondition(payload["media"] == nil)
}
let unknown = harness.printerStatusPayload(BRLMPrinterStatus(batteryStatus: nil, mediaInfo: nil))
precondition(unknown["battery"] == nil && unknown["media"] == nil)
let expected = ["ready", "noPaper", "coverOpen", "busy", "paperJam", "highVoltageAdapter", "batteryEmpty", "batteryTrouble", "tubeNotDetected", "motorSlow", "unsupportedCharger", "incompatibleEquipment", "systemError", "otherError"]
for (code, state) in zip(BRLMPrinterStatusErrorCode.allCases, expected) {
    precondition(harness.printerStatusPayload(BRLMPrinterStatus(errorCode: code))["state"] as? String == state)
}
print("PASS: battery, media and every SDK condition")
`;
  const dir = mkdtempSync(join(tmpdir(), 'beanlog-status-test-'));
  try {
    const file = join(dir, 'main.swift');
    writeFileSync(file, fixture);
    const output = execFileSync('xcrun', ['swift', '-module-cache-path', join(dir, 'cache'), file], { encoding: 'utf8', timeout: 30000 });
    expect(output).toContain('PASS: battery, media and every SDK condition');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
