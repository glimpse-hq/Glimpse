import AppKit
import CoreGraphics

public typealias GlimpseDictationKeyCallback = @convention(c) (
    Int32,
    UnsafeMutableRawPointer?
) -> Void

private let nxSystemDefinedEventType = CGEventType(rawValue: 14)!
private let nxSubtypeAuxControlButtons: Int16 = 8
private let hidConsumerVoiceCommand: Int = 0xCF
private let nxKeyStateDown: Int = 0x0A
private let nxKeyStateUp: Int = 0x0B

private final class DictationKeyTap {
    let callback: GlimpseDictationKeyCallback
    let context: UnsafeMutableRawPointer?
    let blocksSystemDictation: Bool
    var port: CFMachPort?
    var source: CFRunLoopSource?

    init(
        callback: @escaping GlimpseDictationKeyCallback,
        context: UnsafeMutableRawPointer?,
        blocksSystemDictation: Bool
    ) {
        self.callback = callback
        self.context = context
        self.blocksSystemDictation = blocksSystemDictation
    }

    func start() -> Bool {
        let mask = CGEventMask(1) << nxSystemDefinedEventType.rawValue
        let opaqueSelf = Unmanaged.passUnretained(self).toOpaque()
        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: blocksSystemDictation ? .defaultTap : .listenOnly,
            eventsOfInterest: mask,
            callback: { _, type, event, context in
                guard let context else { return Unmanaged.passUnretained(event) }
                let owner = Unmanaged<DictationKeyTap>.fromOpaque(context).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    if let port = owner.port { CGEvent.tapEnable(tap: port, enable: true) }
                    return Unmanaged.passUnretained(event)
                }
                guard
                    let appKitEvent = NSEvent(cgEvent: event),
                    appKitEvent.type == .systemDefined,
                    appKitEvent.subtype.rawValue == nxSubtypeAuxControlButtons
                else {
                    return Unmanaged.passUnretained(event)
                }

                let data = appKitEvent.data1
                let key = (data & 0xFFFF_0000) >> 16
                guard key == hidConsumerVoiceCommand else {
                    return Unmanaged.passUnretained(event)
                }

                let state = (data & 0x0000_FF00) >> 8
                if state == nxKeyStateDown {
                    owner.callback(1, owner.context)
                } else if state == nxKeyStateUp {
                    owner.callback(0, owner.context)
                } else {
                    return Unmanaged.passUnretained(event)
                }
                return owner.blocksSystemDictation ? nil : Unmanaged.passUnretained(event)
            },
            userInfo: opaqueSelf
        ) else {
            return false
        }

        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .defaultMode)
        CGEvent.tapEnable(tap: port, enable: true)
        self.port = port
        self.source = source
        return true
    }

    deinit {
        if let port { CGEvent.tapEnable(tap: port, enable: false) }
        if let source { CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .defaultMode) }
    }
}

@_cdecl("gm_dictation_key_listener_start")
public func gmDictationKeyListenerStart(
    _ callback: GlimpseDictationKeyCallback?,
    _ context: UnsafeMutableRawPointer?,
    _ blocksSystemDictation: Bool
) -> UnsafeMutableRawPointer? {
    guard let callback else { return nil }
    let listener = DictationKeyTap(
        callback: callback,
        context: context,
        blocksSystemDictation: blocksSystemDictation
    )
    guard listener.start() else { return nil }
    return Unmanaged.passRetained(listener).toOpaque()
}

@_cdecl("gm_dictation_key_listener_stop")
public func gmDictationKeyListenerStop(_ listener: UnsafeMutableRawPointer?) {
    guard let listener else { return }
    Unmanaged<DictationKeyTap>.fromOpaque(listener).release()
}
