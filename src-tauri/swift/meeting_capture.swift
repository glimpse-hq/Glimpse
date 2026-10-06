import AVFoundation
import AudioToolbox
import CoreAudio
import CoreMedia
import Foundation
import ScreenCaptureKit

public typealias GlimpseMicrophonePermissionCallback = @convention(c) (
    Bool,
    UnsafeMutableRawPointer?
) -> Void

@_cdecl("gm_request_microphone_permission")
public func gmRequestMicrophonePermission(
    _ callback: GlimpseMicrophonePermissionCallback?,
    _ context: UnsafeMutableRawPointer?
) {
    guard let callback else { return }
    switch AVCaptureDevice.authorizationStatus(for: .audio) {
    case .authorized:
        callback(true, context)
    case .notDetermined:
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            callback(granted, context)
        }
    default:
        callback(false, context)
    }
}

private final class ResultBox<T>: @unchecked Sendable {
    var value: T?
}

private func runBlocking<T>(_ operation: @escaping @Sendable () async -> T) -> T {
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox<T>()
    Task.detached {
        box.value = await operation()
        semaphore.signal()
    }
    semaphore.wait()
    return box.value!
}

private func resultString(
    error: String? = nil,
    values: [String: Any] = [:]
) -> UnsafeMutablePointer<CChar> {
    var payload: [String: Any] = error.map { ["error": $0] } ?? ["ok": true]
    values.forEach { payload[$0.key] = $0.value }
    let data = try! JSONSerialization.data(withJSONObject: payload)
    return strdup(String(data: data, encoding: .utf8)!)!
}

private func fileSettings(for format: AVAudioFormat) -> [String: Any] {
    var settings = format.settings
    // Audio files are interleaved on disk even when AVAudioEngine's client
    // buffers are non-interleaved. Keep that client layout in the initializer
    // below, but do not ask the file container itself to be non-interleaved.
    settings.removeValue(forKey: AVLinearPCMIsNonInterleaved)
    return settings
}

private func normalizedAudioLevel(_ buffer: AVAudioPCMBuffer) -> Float {
    let frameCount = Int(buffer.frameLength)
    let channelCount = Int(buffer.format.channelCount)
    guard frameCount > 0, channelCount > 0 else { return 0 }

    var sum: Double = 0
    var sampleCount = 0
    let stride = max(1, frameCount / 2_048)

    if let channels = buffer.floatChannelData {
        if buffer.format.isInterleaved {
            var frame = 0
            while frame < frameCount {
                for channel in 0..<channelCount {
                    let sample = Double(channels[0][frame * channelCount + channel])
                    sum += sample * sample
                    sampleCount += 1
                }
                frame += stride
            }
        } else {
            for channel in 0..<channelCount {
                var frame = 0
                while frame < frameCount {
                    let sample = Double(channels[channel][frame])
                    sum += sample * sample
                    sampleCount += 1
                    frame += stride
                }
            }
        }
    } else if let channels = buffer.int16ChannelData {
        if buffer.format.isInterleaved {
            var frame = 0
            while frame < frameCount {
                for channel in 0..<channelCount {
                    let sample = Double(channels[0][frame * channelCount + channel]) / Double(Int16.max)
                    sum += sample * sample
                    sampleCount += 1
                }
                frame += stride
            }
        } else {
            for channel in 0..<channelCount {
                var frame = 0
                while frame < frameCount {
                    let sample = Double(channels[channel][frame]) / Double(Int16.max)
                    sum += sample * sample
                    sampleCount += 1
                    frame += stride
                }
            }
        }
    }

    guard sampleCount > 0 else { return 0 }
    let rms = sqrt(sum / Double(sampleCount))
    // Speech normally occupies a small fraction of full scale. This curve keeps
    // quiet voices visible while preserving enough headroom for louder audio.
    return Float(min(1, pow(rms * 7.5, 0.72)))
}

private func normalizedDeviceUID(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    return trimmed.hasPrefix("coreaudio:")
        ? String(trimmed.dropFirst("coreaudio:".count))
        : trimmed
}

private func audioDeviceStringProperty(
    _ deviceID: AudioDeviceID,
    selector: AudioObjectPropertySelector
) -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var value: CFString?
    var size = UInt32(MemoryLayout<CFString?>.size)
    let status = withUnsafeMutablePointer(to: &value) { pointer in
        AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, pointer)
    }
    guard status == noErr else { return nil }
    return value as String?
}

private func audioInputDevice(forUID requestedUID: String?) -> (id: AudioDeviceID, name: String)? {
    guard let requestedUID = normalizedDeviceUID(requestedUID) else { return nil }
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        0,
        nil,
        &size
    ) == noErr else { return nil }

    let count = Int(size) / MemoryLayout<AudioDeviceID>.size
    var devices = Array(repeating: AudioDeviceID(0), count: count)
    let devicesStatus = devices.withUnsafeMutableBytes { buffer in
        AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject),
            &address,
            0,
            nil,
            &size,
            buffer.baseAddress!
        )
    }
    guard devicesStatus == noErr else { return nil }

    for deviceID in devices {
        guard audioDeviceStringProperty(deviceID, selector: kAudioDevicePropertyDeviceUID)
            == requestedUID else { continue }
        let name = audioDeviceStringProperty(deviceID, selector: kAudioObjectPropertyName)
            ?? requestedUID
        return (deviceID, name)
    }
    return nil
}

@available(macOS 14.0, *)
private final class MeetingCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    private let systemURL: URL
    private let microphoneURL: URL
    private let requestedMicrophoneUID: String?
    private let requestedApplicationBundleIdentifier: String?
    private let audioQueue = DispatchQueue(label: "cc.tryglimpse.meeting.system-audio")
    private let microphoneLock = NSLock()
    private let levelsLock = NSLock()
    private let statusLock = NSLock()
    private var captureError: String?
    private var startedAtSeconds: Double = 0
    private let engine = AVAudioEngine()
    private var stream: SCStream?
    private var systemFile: AVAudioFile?
    private var microphoneFile: AVAudioFile?
    private var microphoneTapInstalled = false
    private var systemLevel: Float = 0
    private var microphoneLevel: Float = 0
    private var systemLevelUpdatedAt: TimeInterval = 0
    private var microphoneLevelUpdatedAt: TimeInterval = 0
    private(set) var applicationIsolated = false
    private var activeMicrophoneName = ""

    var microphoneName: String {
        activeMicrophoneName.isEmpty
            ? (AVCaptureDevice.default(for: .audio)?.localizedName ?? "")
            : activeMicrophoneName
    }

    init(
        systemURL: URL,
        microphoneURL: URL,
        requestedMicrophoneUID: String?,
        requestedApplicationBundleIdentifier: String?
    ) {
        self.systemURL = systemURL
        self.microphoneURL = microphoneURL
        self.requestedMicrophoneUID = requestedMicrophoneUID
        self.requestedApplicationBundleIdentifier = requestedApplicationBundleIdentifier
    }

    func start() async throws {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: false
            )
            guard let display = content.displays.first else {
                throw NSError(domain: "GlimpseMeeting", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "No display is available for system audio capture."
                ])
            }
            let requestedApplication = requestedApplicationBundleIdentifier.flatMap { requested in
                content.applications.first { application in
                    application.bundleIdentifier == requested
                        || (requested == "com.microsoft.teams2"
                            && application.bundleIdentifier == "com.microsoft.teams")
                }
            }
            if requestedApplicationBundleIdentifier != nil && requestedApplication == nil {
                throw NSError(domain: "GlimpseMeeting", code: 4, userInfo: [
                    NSLocalizedDescriptionKey:
                        "The detected meeting application is no longer available for audio capture."
                ])
            }
            let filter: SCContentFilter
            if let requestedApplication {
                filter = SCContentFilter(
                    display: display,
                    including: [requestedApplication],
                    exceptingWindows: []
                )
                applicationIsolated = true
            } else {
                let excludedApplications = content.applications.filter {
                    $0.bundleIdentifier == Bundle.main.bundleIdentifier
                }
                filter = SCContentFilter(
                    display: display,
                    excludingApplications: excludedApplications,
                    exceptingWindows: []
                )
                applicationIsolated = false
            }
            let configuration = SCStreamConfiguration()
            configuration.capturesAudio = true
            configuration.excludesCurrentProcessAudio = true
            configuration.sampleRate = 48_000
            configuration.channelCount = 2
            configuration.width = 2
            configuration.height = 2
            configuration.showsCursor = false

            let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
            startedAtSeconds = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()))
            try await stream.startCapture()
            self.stream = stream
            try startMicrophone()
        } catch {
            if let stream {
                try? await stream.stopCapture()
                try? stream.removeStreamOutput(self, type: .audio)
            }
            stream = nil
            stopMicrophone()
            throw error
        }
    }

    private func startMicrophone() throws {
        let input = engine.inputNode
        if let requested = normalizedDeviceUID(requestedMicrophoneUID) {
            guard let selected = audioInputDevice(forUID: requested) else {
                throw NSError(domain: "GlimpseMeeting", code: 3, userInfo: [
                    NSLocalizedDescriptionKey: "The selected microphone is no longer available."
                ])
            }
            guard let audioUnit = input.audioUnit else {
                throw NSError(domain: "GlimpseMeeting", code: 4, userInfo: [
                    NSLocalizedDescriptionKey: "The selected microphone could not be opened."
                ])
            }
            var deviceID = selected.id
            let status = AudioUnitSetProperty(
                audioUnit,
                kAudioOutputUnitProperty_CurrentDevice,
                kAudioUnitScope_Global,
                0,
                &deviceID,
                UInt32(MemoryLayout<AudioDeviceID>.size)
            )
            guard status == noErr else {
                throw NSError(domain: "GlimpseMeeting", code: Int(status), userInfo: [
                    NSLocalizedDescriptionKey: "The selected microphone could not be opened."
                ])
            }
            activeMicrophoneName = selected.name
        } else {
            activeMicrophoneName = AVCaptureDevice.default(for: .audio)?.localizedName ?? ""
        }
        let microphoneFormat = input.outputFormat(forBus: 0)
        guard microphoneFormat.sampleRate > 0, microphoneFormat.channelCount > 0 else {
            throw NSError(domain: "GlimpseMeeting", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "No microphone input is available."
            ])
        }

        microphoneFile = try AVAudioFile(
            forWriting: microphoneURL,
            settings: fileSettings(for: microphoneFormat),
            commonFormat: microphoneFormat.commonFormat,
            interleaved: microphoneFormat.isInterleaved
        )
        input.installTap(onBus: 0, bufferSize: 1024, format: microphoneFormat) { [weak self] buffer, time in
            guard let self else { return }
            let level = normalizedAudioLevel(buffer)
            self.levelsLock.withLock {
                self.microphoneLevel = level
                self.microphoneLevelUpdatedAt = ProcessInfo.processInfo.systemUptime
            }
            self.microphoneLock.withLock {
                do {
                    if let file = self.microphoneFile {
                        let seconds = time.isHostTimeValid
                            ? AVAudioTime.seconds(forHostTime: time.hostTime)
                            : ProcessInfo.processInfo.systemUptime
                        try self.writeAligned(buffer, to: file, seconds: seconds)
                    }
                } catch {
                    self.recordFailure("Microphone audio could not be saved.")
                }
            }
        }
        microphoneTapInstalled = true
        engine.prepare()
        try engine.start()
    }

    func stop() async throws {
        var stopError: Error?
        if let stream {
            do {
                try await stream.stopCapture()
            } catch {
                stopError = error
            }
            try? stream.removeStreamOutput(self, type: .audio)
        }
        stream = nil
        stopMicrophone()
        audioQueue.sync { systemFile = nil }
        if let stopError { throw stopError }
    }

    var failure: String? {
        statusLock.withLock { captureError }
    }

    private func recordFailure(_ message: String) {
        statusLock.withLock {
            if captureError == nil { captureError = message }
        }
    }

    private func writeAligned(
        _ buffer: AVAudioPCMBuffer,
        to file: AVAudioFile,
        seconds: Double
    ) throws {
        if seconds.isFinite && startedAtSeconds > 0 {
            let elapsed = max(0, seconds - startedAtSeconds)
            let expectedFrame = AVAudioFramePosition((elapsed * buffer.format.sampleRate).rounded())
            var gap = expectedFrame - file.framePosition
            if file.framePosition == 0 || gap > AVAudioFramePosition(buffer.format.sampleRate * 0.005) {
                while gap > 0 {
                    let frames = AVAudioFrameCount(min(gap, 8_192))
                    guard let silence = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: frames)
                    else { throw NSError(domain: "GlimpseMeeting", code: 5) }
                    silence.frameLength = frames
                    for audio in UnsafeMutableAudioBufferListPointer(silence.mutableAudioBufferList) {
                        audio.mData?.initializeMemory(as: UInt8.self, repeating: 0, count: Int(audio.mDataByteSize))
                    }
                    try file.write(from: silence)
                    gap -= AVAudioFramePosition(frames)
                }
            }
        }
        try file.write(from: buffer)
    }

    private func stopMicrophone() {
        if engine.isRunning {
            engine.stop()
        }
        if microphoneTapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            microphoneTapInstalled = false
        }
        microphoneLock.withLock {
            microphoneFile = nil
        }
        levelsLock.withLock {
            microphoneLevel = 0
            systemLevel = 0
            microphoneLevelUpdatedAt = 0
            systemLevelUpdatedAt = 0
        }
    }

    func currentLevels() -> (microphone: Float, system: Float) {
        levelsLock.withLock {
            let now = ProcessInfo.processInfo.systemUptime
            let microphone = now - microphoneLevelUpdatedAt > 0.35 ? 0 : microphoneLevel
            let system = now - systemLevelUpdatedAt > 0.35 ? 0 : systemLevel
            return (microphone, system)
        }
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .audio, sampleBuffer.isValid else { return }
        writeSystemAudio(sampleBuffer)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        recordFailure("Meeting audio stopped unexpectedly. Stop recording to save the captured audio.")
    }

    private func writeSystemAudio(_ sampleBuffer: CMSampleBuffer) {
        guard let formatDescription = sampleBuffer.formatDescription,
              let description = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
              let format = AVAudioFormat(streamDescription: description)
        else { return }

        var blockBuffer: CMBlockBuffer?
        var requiredSize = 0
        var status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &requiredSize,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr, requiredSize > 0 else { return }

        let memory = UnsafeMutableRawPointer.allocate(
            byteCount: requiredSize,
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { memory.deallocate() }
        let list = memory.bindMemory(to: AudioBufferList.self, capacity: 1)
        status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: list,
            bufferListSize: requiredSize,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
            blockBufferOut: &blockBuffer
        )
        guard status == noErr,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                bufferListNoCopy: list,
                deallocator: nil
              )
        else { return }
        buffer.frameLength = AVAudioFrameCount(CMSampleBufferGetNumSamples(sampleBuffer))
        let level = normalizedAudioLevel(buffer)
        levelsLock.withLock {
            systemLevel = level
            systemLevelUpdatedAt = ProcessInfo.processInfo.systemUptime
        }

        do {
            if systemFile == nil {
                systemFile = try AVAudioFile(
                    forWriting: systemURL,
                    settings: fileSettings(for: format),
                    commonFormat: format.commonFormat,
                    interleaved: format.isInterleaved
                )
            }
            if let file = systemFile {
                try writeAligned(buffer, to: file, seconds: CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)))
            }
        } catch {
            recordFailure("Meeting audio could not be saved. Stop recording to save the captured audio.")
        }
    }
}

private let captureLock = NSLock()
private var activeCapture: AnyObject?

@_cdecl("gm_meeting_start")
public func gmMeetingStart(
    _ systemPath: UnsafePointer<CChar>?,
    _ microphonePath: UnsafePointer<CChar>?,
    _ microphoneDeviceUID: UnsafePointer<CChar>?,
    _ applicationBundleIdentifier: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar> {
    guard let systemPath, let microphonePath else {
        return resultString(error: "Missing meeting recording path.")
    }
    if #available(macOS 14.0, *) {
        let systemURL = URL(fileURLWithPath: String(cString: systemPath))
        let microphoneURL = URL(fileURLWithPath: String(cString: microphonePath))
        let requestedMicrophoneUID = microphoneDeviceUID.map { String(cString: $0) }
        let requestedApplicationBundleIdentifier = applicationBundleIdentifier.map {
            String(cString: $0)
        }
        return runBlocking {
            let capture = MeetingCapture(
                systemURL: systemURL,
                microphoneURL: microphoneURL,
                requestedMicrophoneUID: requestedMicrophoneUID,
                requestedApplicationBundleIdentifier: requestedApplicationBundleIdentifier
            )
            do {
                try await capture.start()
                let accepted = captureLock.withLock { () -> Bool in
                    guard activeCapture == nil else { return false }
                    activeCapture = capture
                    return true
                }
                if !accepted {
                    try? await capture.stop()
                    return resultString(error: "A meeting recording is already in progress.")
                }
                return resultString(values: [
                    "microphone_name": capture.microphoneName,
                    "application_isolated": capture.applicationIsolated,
                ])
            } catch {
                return resultString(error: "\(error)")
            }
        }
    }
    return resultString(error: "Meeting recording requires macOS 14 or later.")
}

@_cdecl("gm_meeting_levels")
public func gmMeetingLevels() -> UnsafeMutablePointer<CChar> {
    if #available(macOS 14.0, *) {
        let capture = captureLock.withLock { activeCapture as? MeetingCapture }
        guard let capture else {
            return resultString(values: ["microphone_level": 0, "system_level": 0])
        }
        let levels = capture.currentLevels()
        var values: [String: Any] = [
            "microphone_level": levels.microphone,
            "system_level": levels.system,
        ]
        if let failure = capture.failure { values["capture_error"] = failure }
        return resultString(values: values)
    }
    return resultString(values: ["microphone_level": 0, "system_level": 0])
}

@_cdecl("gm_meeting_stop")
public func gmMeetingStop() -> UnsafeMutablePointer<CChar> {
    if #available(macOS 14.0, *) {
        let capture = captureLock.withLock { () -> MeetingCapture? in
            let capture = activeCapture as? MeetingCapture
            activeCapture = nil
            return capture
        }
        guard let capture else {
            return resultString(error: "No meeting recording is in progress.")
        }
        return runBlocking {
            do {
                try await capture.stop()
                return resultString()
            } catch {
                return resultString(error: "\(error)")
            }
        }
    }
    return resultString(error: "Meeting recording requires macOS 14 or later.")
}

@_cdecl("gm_meeting_string_free")
public func gmMeetingStringFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}
