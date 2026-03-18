//
//  BROTHERSDK.h
//  BROTHERSDK
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <CoreBluetooth/CoreBluetooth.h> //BLE
@interface BROTHERSDK : NSObject{
}
- (NSInteger) openport: (NSString*) destination;
- (NSInteger) openportMFI: (NSString*) MFIdestination;
- (NSMutableArray*)searchBLEDevice:(NSInteger)Seconds;
- (NSInteger) openport_ble:(CBPeripheral *)peripheral;
- (NSInteger) openport_ble:(CBPeripheral *)peripheral
                    delay:(double)delay;
- (NSInteger) closeport;
- (NSInteger) closeport:(double)delay;
- (NSInteger) setup: (NSString*) width
                height: (NSString*) height
                 speed: (NSString*) speed
               density: (NSString*) density
                sensor: (NSString*) sensor
              vertical: (NSString*) vertical
                offset: (NSString*) offset;
- (NSInteger) clearbuffer;
- (NSInteger) barcode:(NSString*) x
                    y: (NSString*) y
          barcodeType: (NSString*) type
               height: (NSString*) height
             readable: (NSString*) readable
             rotation: (NSString*) rotation
               narrow: (NSString*) narrow
                 wide: (NSString*) wide
                 code: (NSString*) code;
- (NSInteger) printerfont:(NSString*) x
                        y: (NSString*) y
                 fontName: (NSString*) fontName
                 rotation: (NSString*) rotation
       magnificationRateX: (NSString*) xmul
       magnificationRateY: (NSString*) ymul
                  content: (NSString*) content;
- (NSInteger) sendcommand: (NSString*) commandText;
- (NSInteger) printlabel: (NSString*) sets
                                  copies: (NSString*) copies;
- (NSInteger) windowsfont: (int) x
                        y: (int) y
                   height: (int) height
                 rotation: (int) rotation
                    style: (int) style
            withUnderline: (int) withUnderline
                 fontName: (NSString*) fontName
                  content: (NSString*) content;
- (NSInteger) downloadpcx: (NSString*) srcPath
              asName: (NSString*) name;
- (NSInteger) downloadbmp: (NSString*) srcPath
                   asName: (NSString*) name;
- (NSInteger) downloadttf: (NSString*) srcPath
                   asName: (NSString*) name;
- (NSInteger) formfeed;
- (NSInteger) nobackfeed;
- (NSInteger) sendfile: (NSString*) srcPath
                asName: (NSString*) name;
- (NSData *) printerstatus;
- (NSString *) rfidGetReadData;
- (NSInteger) rfidRead: (NSString*) unlock
                format: (NSString*) format
            startBlock: (NSString*) startBlock
          readDataSize: (NSString*) readDataSize
            memoryBank: (NSString*) memoryBank;
- (NSInteger) rfidWrite: (NSString*) lock
                 format: (NSString*) format
             startBlock: (NSString*) startBlock
           readDataSize: (NSString*) readDataSize
             memoryBank: (NSString*) memoryBank
                   data: (NSString*) data;
- (NSInteger) printPDFbyPath:  (NSString*) srcPath
                         x: (int) x
                         y: (int) y
               printer_dpi: (int) printer_dpi;
- (NSInteger) printPDFbyPath_Resize:  (NSString*) srcPath
                          x: (int) x
                          y: (int) y
                      width: (int) width
                     height: (int) height
                    printer_dpi: (int) printer_dpi;
- (NSInteger) printPDFbyPath:  (NSString*) srcPath
                         x: (int) x
                         y: (int) y
               printer_dpi: (int) printer_dpi
                page_index: (int) page_index;
- (NSInteger) printPDFbyPath_Resize:  (NSString*) srcPath
                          x: (int) x
                          y: (int) y
                      width: (int) width
                     height: (int) height
                printer_dpi: (int) printer_dpi
                page_index: (int) page_index;
- (NSInteger) getPDFPageCountbyPath:  (NSString*) srcPath;
- (NSInteger) printPDFbyFile:  (CGPDFDocumentRef) pdfDocument
                          x: (int) x
                          y: (int) y
                printer_dpi: (int) printer_dpi;
- (NSInteger) printPDFbyFile_Resize: (CGPDFDocumentRef) pdfDocument
                          x: (int) x
                          y: (int) y
                       width: (int) width
                      height: (int) height
                    printer_dpi: (int) printer_dpi;
- (NSInteger) printPDFbyFile:  (CGPDFDocumentRef) pdfDocument
                          x: (int) x
                          y: (int) y
                printer_dpi: (int) printer_dpi
                 page_index: (int) page_index;
- (NSInteger) printPDFbyFile_Resize:  (CGPDFDocumentRef) pdfDocument
                          x: (int) x
                          y: (int) y
                      width: (int) width
                     height: (int) height
                printer_dpi: (int) printer_dpi
                page_index: (int) page_index;
- (NSInteger) getPDFPageCountbyFile:  (CGPDFDocumentRef) pdfDocument;
- (NSInteger) sendImagebyPath: (NSString*) srcPath
                            x: (int) x
                            y: (int) y
                        width: (int) width
                       height: (int) height
                    threshold: (int) threshold;
- (NSInteger) sendImagebyFile: (UIImage*) img
                            x: (int) x
                            y: (int) y
                        width: (int) width
                       height: (int) height
                    threshold: (int) threshold;

// New 
- (NSInteger) openportMFI_withname:(NSString *)MFIname;

@end
