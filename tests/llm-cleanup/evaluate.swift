import Foundation
import FoundationModels

struct Case: Decodable {
    let id: String
    let input: String
    let expected: [String]
}

struct Result: Encodable {
    let id: String
    let expected: [String]
    let output: String?
    let error: String?
    let milliseconds: Int
}

@main struct Evaluate {
    static func main() async throws {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments.first == "--help" {
            print("Usage: evaluate [repository-root] [case-id ...]\nOutputs raw Apple-model results as JSONL; no files are written.")
            return
        }
        let root = URL(fileURLWithPath: arguments.first ?? ".", isDirectory: true)
        let source = try String(contentsOf: root.appendingPathComponent("src-tauri/src/llm_cleanup.rs"), encoding: .utf8)
        guard let start = source.range(of: "const CLEANUP_PROMPT: &str = r#\""),
              let end = source.range(of: "\"#;", range: start.upperBound..<source.endIndex) else {
            throw NSError(domain: "CleanupEvaluation", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not locate CLEANUP_PROMPT in llm_cleanup.rs"])
        }
        let instructions = String(source[start.upperBound..<end.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: root.appendingPathComponent("tests/llm-cleanup/cases.json")))
        let selectedIDs = Set(arguments.dropFirst())
        let unknownIDs = selectedIDs.subtracting(cases.map(\.id))
        guard unknownIDs.isEmpty else {
            throw NSError(domain: "CleanupEvaluation", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unknown case IDs: \(unknownIDs.sorted().joined(separator: ", "))"])
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        for test in cases where selectedIDs.isEmpty || selectedIDs.contains(test.id) {
            let escaped = test.input.replacingOccurrences(of: "&", with: "&amp;")
                .replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;")
            // Mirrors build_user_content for generic cleanup; keep in sync with that owner.
            let prompt = "<transcript>\n\(escaped)\n</transcript>\n\nClean only the text inside the <transcript> tags.\nIf the transcript is empty, return nothing.\nIf the transcript is a question, clean the question instead of answering it.\nReturn only the cleaned transcript."
            let session = LanguageModelSession(instructions: instructions)
            let start = Date()
            let result: Result
            do {
                let response = try await session.respond(to: prompt, options: GenerationOptions(temperature: 0, maximumResponseTokens: 4096))
                result = Result(id: test.id, expected: test.expected, output: response.content, error: nil, milliseconds: Int(Date().timeIntervalSince(start) * 1000))
            } catch {
                result = Result(id: test.id, expected: test.expected, output: nil, error: String(describing: error), milliseconds: Int(Date().timeIntervalSince(start) * 1000))
            }
            FileHandle.standardOutput.write(try encoder.encode(result))
            FileHandle.standardOutput.write(Data([10]))
        }
    }
}
