import Foundation
import Capacitor
import UIKit
import BRLMPrinterKit

private struct BrotherPrintRequest: Decodable {
    let printerName: String?
    let labels: [BrotherPrintLabelRequest]
}

private struct BrotherPrintLabelRequest: Decodable {
    let pngDataUrl: String
}

private struct PrinterCandidate {
    let source: String
    let channel: BRLMChannel
    let channelType: BRLMChannelType
    let displayName: String
    let modelName: String
    let channelInfo: String
    let matchFields: [String]
}

private struct DiscoverySnapshot {
    let pairedCandidates: [PrinterCandidate]
    let bluetoothCandidates: [PrinterCandidate]
    let bleCandidates: [PrinterCandidate]
    let bluetoothSearchError: BRLMPrinterSearchErrorCode
    let bleSearchError: BRLMPrinterSearchErrorCode

    var allCandidates: [PrinterCandidate] {
        deduplicatedCandidates(pairedCandidates + bluetoothCandidates + bleCandidates)
    }

    private func deduplicatedCandidates(_ candidates: [PrinterCandidate]) -> [PrinterCandidate] {
        var seen = Set<String>()
        var result: [PrinterCandidate] = []
        for candidate in candidates {
            let key = "\(candidate.source)|\(candidate.channelType.rawValue)|\(candidate.channelInfo)|\(candidate.displayName)"
            if seen.insert(key).inserted {
                result.append(candidate)
            }
        }
        return result
    }
}

@objc(BrotherPrinterPlugin)
public class BrotherPrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BrotherPrinterPlugin"
    public let jsName = "BrotherPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printLabels", returnType: CAPPluginReturnPromise)
    ]

    private let bleSearchSeconds: TimeInterval = 6
    private let maxDiagnosticCandidates = 6

    override public func load() {
        super.load()
        DispatchQueue.main.async {
            BRPtouchBluetoothManager.shared().registerForBRDeviceNotifications()
        }
    }

    @objc func printLabels(_ call: CAPPluginCall) {
        let request: BrotherPrintRequest
        do {
            request = try call.decode(BrotherPrintRequest.self)
        } catch {
            call.reject("Invalid Brother print request.", nil, error)
            return
        }

        if request.labels.isEmpty {
            call.reject("At least one label is required.")
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try self.performPrint(request: request)
                DispatchQueue.main.async {
                    call.resolve(["printed": request.labels.count])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject(error.localizedDescription, nil, error)
                }
            }
        }
    }

    private func performPrint(request: BrotherPrintRequest) throws {
        let printerName = trimmed(request.printerName)
        let discovery = runOnMain {
            discoverPrinters()
        }

        guard let selectedCandidate = selectCandidate(from: discovery, requestedPrinterName: printerName) else {
            throw BrotherPrinterError(lines: buildDiscoveryFailureLines(discovery: discovery, requestedPrinterName: printerName))
        }

        let printerModel = detectPrinterModel(candidate: selectedCandidate, requestedPrinterName: printerName)
        let openResult = BRLMPrinterDriverGenerator.open(selectedCandidate.channel)
        guard openResult.error.code == BRLMOpenChannelErrorCode.noError, let driver = openResult.driver else {
            throw BrotherPrinterError(lines: buildOpenFailureLines(
                discovery: discovery,
                candidate: selectedCandidate,
                requestedPrinterName: printerName,
                error: openResult.error
            ))
        }

        defer {
            driver.closeChannel()
        }

        let settings = try buildPrintSettings(printerModel: printerModel)
        let images = try request.labels.map { try decodeCGImage(from: $0.pngDataUrl) }
        if let printError = printImages(images, driver: driver, settings: settings),
           printError.code != BRLMPrintErrorCode.noError {
            throw BrotherPrinterError(lines: buildPrintFailureLines(
                discovery: discovery,
                candidate: selectedCandidate,
                requestedPrinterName: printerName,
                error: printError
            ))
        }
    }

    private func discoverPrinters() -> DiscoverySnapshot {
        BRPtouchBluetoothManager.shared().registerForBRDeviceNotifications()
        let pairedCandidates = fetchPairedCandidates()

        let bluetoothResult = BRLMPrinterSearcher.startBluetoothSearch()
        let bluetoothCandidates = bluetoothResult.channels.map {
            makeSearchCandidate(channel: $0, source: "paired Bluetooth search")
        }

        let bleOption = BRLMBLESearchOption()
        bleOption.searchDuration = bleSearchSeconds
        var bleDiscoveredChannels: [BRLMChannel] = []
        let bleResult = BRLMPrinterSearcher.startBLESearch(bleOption) { channel in
            bleDiscoveredChannels.append(channel)
        }
        let bleChannels = bleDiscoveredChannels + bleResult.channels
        let bleCandidates = bleChannels.map {
            makeSearchCandidate(channel: $0, source: "BLE search")
        }

        return DiscoverySnapshot(
            pairedCandidates: pairedCandidates,
            bluetoothCandidates: bluetoothCandidates,
            bleCandidates: bleCandidates,
            bluetoothSearchError: bluetoothResult.error.code,
            bleSearchError: bleResult.error.code
        )
    }

    private func fetchPairedCandidates() -> [PrinterCandidate] {
        let devices = BRPtouchBluetoothManager.shared().pairedDevices() as? [BRPtouchDeviceInfo] ?? []
        return devices.compactMap { device in
            guard let channel = pairedChannel(for: device) else { return nil }
            let displayName = firstNonEmpty([
                trimmed(device.strBLEAdvertiseLocalName),
                trimmed(device.strPrinterName),
                trimmed(device.strModelName),
                trimmed(device.strNodeName),
            ]) ?? "Unnamed paired device"
            let modelName = trimmed(device.strModelName)
            let channelInfo = channel.channelInfo
            return PrinterCandidate(
                source: "iOS paired devices",
                channel: channel,
                channelType: channel.channelType,
                displayName: displayName,
                modelName: modelName,
                channelInfo: channelInfo,
                matchFields: [
                    displayName,
                    modelName,
                    trimmed(device.strPrinterName),
                    trimmed(device.strBLEAdvertiseLocalName),
                    trimmed(device.strSerialNumber),
                    channelInfo,
                ]
            )
        }
    }

    private func pairedChannel(for device: BRPtouchDeviceInfo) -> BRLMChannel? {
        let serial = trimmed(device.strSerialNumber)
        if !serial.isEmpty {
            return BRLMChannel(bluetoothSerialNumber: serial)
        }

        let bleLocalName = trimmed(device.strBLEAdvertiseLocalName)
        if !bleLocalName.isEmpty {
            return BRLMChannel(bleLocalName: bleLocalName)
        }

        return nil
    }

    private func makeSearchCandidate(channel: BRLMChannel, source: String) -> PrinterCandidate {
        let advertiseLocalName = channelExtraInfo(channel, key: BRLMChannelExtraInfoKeyAdvertiseLocalName)
        let modelName = channelExtraInfo(channel, key: BRLMChannelExtraInfoKeyModelName)
        let serialNumber = channelExtraInfo(channel, key: BRLMChannelExtraInfoKeySerialNumber)
        let displayName = firstNonEmpty([advertiseLocalName, modelName, channel.channelInfo]) ?? channel.channelInfo

        return PrinterCandidate(
            source: source,
            channel: channel,
            channelType: channel.channelType,
            displayName: displayName,
            modelName: modelName,
            channelInfo: channel.channelInfo,
            matchFields: [
                displayName,
                modelName,
                channel.channelInfo,
                advertiseLocalName,
                serialNumber,
            ]
        )
    }

    private func selectCandidate(from discovery: DiscoverySnapshot, requestedPrinterName: String) -> PrinterCandidate? {
        let candidates = discovery.allCandidates
        guard !candidates.isEmpty else { return nil }

        let preferredCandidates = filterPreferredCandidates(from: candidates, requestedPrinterName: requestedPrinterName)
        if let matched = bestMatch(from: preferredCandidates, requestedPrinterName: requestedPrinterName) {
            return matched
        }
        if let matched = bestMatch(from: candidates, requestedPrinterName: requestedPrinterName) {
            return matched
        }
        if requestedPrinterName.isEmpty, preferredCandidates.count == 1 {
            return preferredCandidates[0]
        }
        if requestedPrinterName.isEmpty, candidates.count == 1 {
            return candidates[0]
        }
        return nil
    }

    private func filterPreferredCandidates(from candidates: [PrinterCandidate], requestedPrinterName: String) -> [PrinterCandidate] {
        let aliases = printerAliases(for: requestedPrinterName)
        let aliasMatches = candidates.filter { candidate in
            candidate.matchFields.contains { field in
                let normalizedField = normalizedPrinterName(field)
                return aliases.contains(where: { alias in
                    !alias.isEmpty && (normalizedField.contains(alias) || alias.contains(normalizedField))
                })
            }
        }
        if !aliasMatches.isEmpty {
            return aliasMatches
        }

        let likelyBrother = candidates.filter { isLikelyBrotherPrinter($0) }
        if !likelyBrother.isEmpty {
            return likelyBrother
        }

        return []
    }

    private func bestMatch(from candidates: [PrinterCandidate], requestedPrinterName: String) -> PrinterCandidate? {
        guard !candidates.isEmpty else { return nil }
        if requestedPrinterName.isEmpty {
            return candidates.first
        }

        let aliases = printerAliases(for: requestedPrinterName)
        for candidate in candidates {
            for field in candidate.matchFields {
                let normalizedField = normalizedPrinterName(field)
                if aliases.contains(normalizedField) {
                    return candidate
                }
            }
        }

        return candidates.first(where: { candidate in
            candidate.matchFields.contains { field in
                let normalizedField = normalizedPrinterName(field)
                return aliases.contains(where: { alias in
                    !alias.isEmpty && (normalizedField.contains(alias) || alias.contains(normalizedField))
                })
            }
        })
    }

    private func detectPrinterModel(candidate: PrinterCandidate, requestedPrinterName: String) -> BRLMPrinterModel {
        let joined = ([candidate.displayName, candidate.modelName, candidate.channelInfo, requestedPrinterName])
            .joined(separator: " ")
        let normalized = normalizedPrinterName(joined)

        if normalized.contains("p910bt") {
            return BRLMPrinterModel.PT_P910BT
        }
        if normalized.contains("p300bt") {
            return BRLMPrinterModel.PT_P300BT
        }
        if normalized.contains("p710bt") {
            return BRLMPrinterModel.PT_P710BT
        }

        return BRLMPrinterModel.PT_P710BT
    }

    private func buildPrintSettings(printerModel: BRLMPrinterModel) throws -> BRLMPTPrintSettings {
        guard let settings = BRLMPTPrintSettings(defaultPrintSettingsWith: printerModel) else {
            throw BrotherPrinterError(lines: [
                "Brother SDK could not build PT label print settings for this printer model.",
            ])
        }

        settings.labelSize = preferredLabelSize(for: printerModel)
        settings.autoCut = true
        settings.cutPause = false
        settings.chainPrint = false
        settings.halfCut = false
        settings.autoCutForEachPageCount = 1
        settings.forceVanishingMargin = true
        settings.feedDirectionMargins = 0
        settings.numCopies = 1
        settings.trimTrailingBlankData = false
        settings.scaleMode = .actualSize
        settings.printOrientation = .portrait
        settings.imageRotation = .rotate0
        settings.hAlignment = .left
        settings.vAlignment = .top
        settings.halftone = .threshold
        settings.compress = .none
        settings.printQuality = .best
        settings.resolution = .normal
        return settings
    }

    private func preferredLabelSize(for printerModel: BRLMPrinterModel) -> BRLMPTPrintSettingsLabelSize {
        let preferred = BRLMPTPrintSettingsLabelSize.width24mm
        let supportedNumbers = BRLMPrinterModelSpec(printerModel: printerModel).supportedPTLabels
        let supported = supportedNumbers.compactMap { BRLMPTPrintSettingsLabelSize(rawValue: $0.intValue) }
        if supported.contains(preferred) {
            return preferred
        }
        return supported.first ?? preferred
    }

    private func buildDiscoveryFailureLines(discovery: DiscoverySnapshot, requestedPrinterName: String) -> [String] {
        let requestedPrinter = requestedPrinterName.isEmpty ? "not set" : "\"\(requestedPrinterName)\""
        let visibleCandidates = filterPreferredCandidates(from: discovery.allCandidates, requestedPrinterName: requestedPrinterName)

        return [
            "Could not find a Brother printer matching \(requestedPrinter).",
            "Paired Bluetooth search result: \(describeSearchError(discovery.bluetoothSearchError)).",
            "BLE search result: \(describeSearchError(discovery.bleSearchError)).",
            candidateCountsLine(discovery),
            pairedDevicesLine(discovery.pairedCandidates),
            supportedAccessoryProtocolsLine(),
            candidateListLine(candidates: visibleCandidates, fallbackCandidates: discovery.allCandidates),
            requestedPrinterName.isEmpty
                ? "No printer name is saved in Settings, so the app could not choose one automatically."
                : "No paired/Bluetooth/BLE device matched the requested printer name \(requestedPrinter).",
            "Tip: PT-P710BT can appear as PT-P710BT plus the last four digits of the serial number.",
            "Tip: If the official Brother app can see PT-P710BT but BeanLog cannot, rebuild and reinstall this app so it uses the latest Brother SDK and plist entries.",
        ]
    }

    private func buildOpenFailureLines(
        discovery: DiscoverySnapshot,
        candidate: PrinterCandidate,
        requestedPrinterName: String,
        error: BRLMOpenChannelError
    ) -> [String] {
        [
            "Found printer candidate but could not open a channel.",
            "Requested printer: \(requestedPrinterName.isEmpty ? "not set" : requestedPrinterName).",
            "Selected candidate: \(describeCandidate(candidate)).",
            "Open channel error: \(describeOpenChannelError(error)).",
            pairedDevicesLine(discovery.pairedCandidates),
            candidateListLine(candidates: filterPreferredCandidates(from: discovery.allCandidates, requestedPrinterName: requestedPrinterName), fallbackCandidates: discovery.allCandidates),
        ]
    }

    private func buildPrintFailureLines(
        discovery: DiscoverySnapshot,
        candidate: PrinterCandidate,
        requestedPrinterName: String,
        error: BRLMPrintError
    ) -> [String] {
        var lines = [
            "Brother printer failed while printing a label.",
            "Requested printer: \(requestedPrinterName.isEmpty ? "not set" : requestedPrinterName).",
            "Selected candidate: \(describeCandidate(candidate)).",
            "Print error: \(describePrintError(error)).",
        ]

        let logs = error.allLogs.prefix(8).map { log in
            "[\(describeLogLevel(log.level))] \(log.errorDescription)"
        }
        if !logs.isEmpty {
            lines.append("SDK logs:")
            lines.append(contentsOf: logs)
        }

        lines.append(pairedDevicesLine(discovery.pairedCandidates))
        return lines
    }

    private func decodeImage(from pngDataUrl: String) throws -> UIImage {
        let payload: String
        if let commaIndex = pngDataUrl.firstIndex(of: ",") {
            payload = String(pngDataUrl[pngDataUrl.index(after: commaIndex)...])
        } else {
            payload = pngDataUrl
        }

        guard let data = Data(base64Encoded: payload, options: [.ignoreUnknownCharacters]),
              let image = UIImage(data: data) else {
            throw BrotherPrinterError(lines: ["Could not decode a generated label image."])
        }
        return image
    }

    private func decodeCGImage(from pngDataUrl: String) throws -> CGImage {
        let image = try decodeImage(from: pngDataUrl)
        guard let cgImage = image.cgImage else {
            throw BrotherPrinterError(lines: ["Could not decode a generated label image."])
        }
        return cgImage
    }

    private func printImages(
        _ images: [CGImage],
        driver: BRLMPrinterDriver,
        settings: BRLMPTPrintSettings
    ) -> BRLMPrintError? {
        for cgImage in images {
            let printError = driver.printImage(with: cgImage, settings: settings)
            if printError.code != BRLMPrintErrorCode.noError {
                return printError
            }
        }
        return nil
    }

    private func describeCandidate(_ candidate: PrinterCandidate) -> String {
        "\(candidate.displayName) · \(candidate.modelName.isEmpty ? "unknown model" : candidate.modelName) · \(describeChannelType(candidate.channelType)) · \(candidate.source)"
    }

    private func pairedDevicesLine(_ candidates: [PrinterCandidate]) -> String {
        if candidates.isEmpty {
            return "iOS paired Brother devices: none"
        }
        let names = candidates.prefix(maxDiagnosticCandidates).map { describeCandidate($0) }
        let suffix = candidates.count > names.count ? ", …" : ""
        return "iOS paired Brother devices: \(names.joined(separator: ", "))\(suffix)"
    }

    private func candidateCountsLine(_ discovery: DiscoverySnapshot) -> String {
        "Candidate counts: paired=\(discovery.pairedCandidates.count), bluetooth=\(discovery.bluetoothCandidates.count), ble=\(discovery.bleCandidates.count)"
    }

    private func supportedAccessoryProtocolsLine() -> String {
        let protocols = Bundle.main.object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as? [String] ?? []
        if protocols.isEmpty {
            return "App external accessory protocols: none"
        }
        return "App external accessory protocols: \(protocols.joined(separator: ", "))"
    }

    private func candidateListLine(candidates: [PrinterCandidate], fallbackCandidates: [PrinterCandidate]) -> String {
        let displayCandidates = candidates.isEmpty ? fallbackCandidates : candidates
        if displayCandidates.isEmpty {
            return "Discovered printer candidates: none"
        }

        let names = displayCandidates.prefix(maxDiagnosticCandidates).map { describeCandidate($0) }
        let hidden = max(0, fallbackCandidates.count - displayCandidates.prefix(maxDiagnosticCandidates).count)
        let suffix = hidden > 0 ? " (\(hidden) other devices hidden)" : ""
        return "Discovered printer candidates: \(names.joined(separator: ", "))\(suffix)"
    }

    private func describeSearchError(_ error: BRLMPrinterSearchErrorCode) -> String {
        switch error {
        case BRLMPrinterSearchErrorCode.noError:
            return "no error"
        case BRLMPrinterSearchErrorCode.canceled:
            return "canceled"
        case BRLMPrinterSearchErrorCode.alreadySearching:
            return "already searching"
        case BRLMPrinterSearchErrorCode.unsupported:
            return "unsupported"
        case BRLMPrinterSearchErrorCode.unknownError:
            return "unknown error"
        @unknown default:
            return "unknown error (\(error.rawValue))"
        }
    }

    private func describeOpenChannelError(_ error: BRLMOpenChannelError) -> String {
        switch error.code {
        case BRLMOpenChannelErrorCode.noError:
            return "no error"
        case BRLMOpenChannelErrorCode.openStreamFailure:
            return "open stream failure"
        case BRLMOpenChannelErrorCode.timeout:
            return "timeout"
        @unknown default:
            return error.description
        }
    }

    private func describePrintError(_ error: BRLMPrintError) -> String {
        "\(error.errorDescription) (code: \(error.code.rawValue))"
    }

    private func describeChannelType(_ channelType: BRLMChannelType) -> String {
        switch channelType {
        case BRLMChannelType.bluetoothMFi:
            return "Bluetooth"
        case BRLMChannelType.wiFi:
            return "Wi-Fi"
        case BRLMChannelType.bluetoothLowEnergy:
            return "BLE"
        @unknown default:
            return "Unknown"
        }
    }

    private func describeLogLevel(_ level: BRLMLogLevel) -> String {
        switch level {
        case BRLMLogLevel.notice:
            return "notice"
        case BRLMLogLevel.warning:
            return "warning"
        case BRLMLogLevel.error:
            return "error"
        @unknown default:
            return "log"
        }
    }

    private func channelExtraInfo(_ channel: BRLMChannel, key: String) -> String {
        (channel.extraInfo?[key] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func firstNonEmpty(_ values: [String]) -> String? {
        values.first(where: { !$0.isEmpty })
    }

    private func printerAliases(for printerName: String) -> [String] {
        let normalized = normalizedPrinterName(printerName)
        guard !normalized.isEmpty else { return [] }

        var aliases = Set<String>()
        aliases.insert(normalized)
        aliases.insert(normalized.replacingOccurrences(of: "brother", with: ""))

        if normalized.hasPrefix("pt"), normalized.count > 2 {
            aliases.insert(String(normalized.dropFirst(2)))
        }
        if let pIndex = normalized.range(of: "p710bt") {
            aliases.insert(String(normalized[pIndex.lowerBound...]))
        }

        return Array(aliases).filter { !$0.isEmpty }.sorted { $0.count > $1.count }
    }

    private func isLikelyBrotherPrinter(_ candidate: PrinterCandidate) -> Bool {
        candidate.matchFields.contains { field in
            let normalized = normalizedPrinterName(field)
            return normalized.contains("brother")
                || normalized.contains("p710bt")
                || normalized.contains("ptp710bt")
                || normalized.contains("p300bt")
                || normalized.contains("p910bt")
        }
    }

    private func normalizedPrinterName(_ printerName: String) -> String {
        printerName
            .lowercased()
            .unicodeScalars
            .filter { CharacterSet.alphanumerics.contains($0) }
            .map(String.init)
            .joined()
    }

    private func trimmed(_ value: String?) -> String {
        value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func runOnMain<T>(_ work: () -> T) -> T {
        if Thread.isMainThread {
            return work()
        }

        var result: T?
        DispatchQueue.main.sync {
            result = work()
        }
        return result!
    }
}

private struct BrotherPrinterError: LocalizedError {
    let lines: [String]

    var errorDescription: String? {
        lines
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .joined(separator: "\n")
    }
}
