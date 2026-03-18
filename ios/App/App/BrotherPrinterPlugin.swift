import Foundation
import Capacitor
import UIKit
import BrotherObjCFramework

private struct BrotherPrintRequest: Decodable {
    let printerName: String?
    let labels: [BrotherPrintLabelRequest]
}

private struct BrotherPrintLabelRequest: Decodable {
    let pngDataUrl: String
}

@objc(BrotherPrinterPlugin)
public class BrotherPrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BrotherPrinterPlugin"
    public let jsName = "BrotherPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printLabels", returnType: CAPPluginReturnPromise)
    ]

    private let sdk = BROTHERSDK()

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
        let printerName = request.printerName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let openResult = printerName.isEmpty
            ? sdk.openportMFI("com.issc.datapath")
            : sdk.openportMFI_withname(printerName)

        guard openResult == 1 else {
            throw BrotherPrinterError(message: printerName.isEmpty
                ? "Could not open the Brother printer connection."
                : "Could not connect to Brother printer \"\(printerName)\".")
        }

        defer {
            _ = sdk.closeport(2)
        }

        for label in request.labels {
            let image = try decodeImage(from: label.pngDataUrl)
            let width = Int32(image.cgImage?.width ?? Int(image.size.width))
            let height = Int32(image.cgImage?.height ?? Int(image.size.height))

            _ = sdk.clearbuffer()
            let sendResult = sdk.sendImagebyFile(image, x: 0, y: 0, width: width, height: height, threshold: 128)
            guard sendResult == 1 else {
                throw BrotherPrinterError(message: "Brother printer failed while sending a label image.")
            }

            let printResult = sdk.printlabel("1", copies: "1")
            guard printResult == 1 else {
                throw BrotherPrinterError(message: "Brother printer failed while printing a label.")
            }
        }
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
            throw BrotherPrinterError(message: "Could not decode a generated label image.")
        }
        return image
    }
}

private struct BrotherPrinterError: LocalizedError {
    let message: String

    var errorDescription: String? {
        message
    }
}
