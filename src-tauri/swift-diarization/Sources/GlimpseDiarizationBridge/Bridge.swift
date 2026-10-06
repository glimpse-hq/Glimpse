import Dispatch
import FluidAudio
import Foundation

private struct BridgeSegment: Codable {
    let start: Double
    let end: Double
    let speaker: String
}

private struct BridgeResponse: Codable {
    let segments: [BridgeSegment]
    let error: String?
}

private final class ResponseBox: @unchecked Sendable {
    private let lock = NSLock()
    private var response = BridgeResponse(
        segments: [],
        error: "Diarization did not finish"
    )

    func store(_ nextResponse: BridgeResponse) {
        lock.lock()
        response = nextResponse
        lock.unlock()
    }

    func load() -> BridgeResponse {
        lock.lock()
        defer { lock.unlock() }
        return response
    }
}

@_cdecl("glimpse_diarize_local")
public func glimpseDiarizeLocal(
    _ modelDirectory: UnsafePointer<CChar>?,
    _ samples: UnsafePointer<Int16>?,
    _ sampleCount: Int,
    _ sampleRate: Int32
) -> UnsafeMutablePointer<CChar>? {
    guard let modelDirectory, let samples, sampleCount > 0, sampleRate > 0 else {
        return encodeResponse(
            BridgeResponse(segments: [], error: "Invalid diarization input")
        )
    }

    let directory = URL(fileURLWithPath: String(cString: modelDirectory), isDirectory: true)
    let floatSamples = UnsafeBufferPointer(start: samples, count: sampleCount).map {
        Float($0) / Float(Int16.max)
    }
    let semaphore = DispatchSemaphore(value: 0)
    let responseBox = ResponseBox()

    Task.detached(priority: .userInitiated) {
        let nextResponse: BridgeResponse
        do {
            let models = try await DiarizerModels.load(
                localSegmentationModel: directory.appendingPathComponent(
                    "pyannote_segmentation.mlmodelc",
                    isDirectory: true
                ),
                localEmbeddingModel: directory.appendingPathComponent(
                    "wespeaker_v2.mlmodelc",
                    isDirectory: true
                )
            )
            let diarizer = DiarizerManager()
            diarizer.initialize(models: models)
            let result = try diarizer.performCompleteDiarization(
                floatSamples,
                sampleRate: Int(sampleRate)
            )
            let segments = result.segments.map {
                BridgeSegment(
                    start: Double($0.startTimeSeconds),
                    end: Double($0.endTimeSeconds),
                    speaker: $0.speakerId
                )
            }
            nextResponse = BridgeResponse(segments: segments, error: nil)
            diarizer.cleanup()
        } catch {
            nextResponse = BridgeResponse(
                segments: [],
                error: String(describing: error)
            )
        }
        responseBox.store(nextResponse)
        semaphore.signal()
    }

    semaphore.wait()
    return encodeResponse(responseBox.load())
}

@_cdecl("glimpse_diarize_string_free")
public func glimpseDiarizeStringFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    free(pointer)
}

private func encodeResponse(_ response: BridgeResponse) -> UnsafeMutablePointer<CChar>? {
    guard
        let data = try? JSONEncoder().encode(response),
        let json = String(data: data, encoding: .utf8)
    else {
        return strdup("{\"segments\":[],\"error\":\"Unable to encode diarization result\"}")
    }
    return strdup(json)
}
