// Live dictation for omarchy-voice: listens to the default microphone and writes down what is being
// said as it is said, with Apple's on-device dictation model (SpeechAnalyzer, macOS 26+).
//   live <out file>     the language is macOS dictation's
// <out file> always holds the text so far (settled words, then the words still changing); it is
// replaced whole each time. SIGTERM ends it: it writes its last words, then exits.

import AVFAudio
import Foundation
import Speech

@main
struct Live {
  static func main() async {
    let args = CommandLine.arguments
    guard args.count == 2 else { quit("usage: live <out file>", 2) }
    let out = URL(fileURLWithPath: args[1])
    // The language macOS dictation is set to (System Settings › Keyboard › Dictation), else the system's first.
    let dictation = UserDefaults(suiteName: "com.apple.speech.recognition.AppleSpeechRecognition.prefs")?
      .stringArray(forKey: "DictationIMPreferredLanguageIdentifiers")?.first
    let language = dictation ?? Locale.preferredLanguages.first ?? "en-US"
    guard let locale = await DictationTranscriber.supportedLocale(equivalentTo: Locale(identifier: language)),
          await DictationTranscriber.installedLocales.contains(locale) else {
      quit("no installed dictation model for \(language)", 3)
    }
    let transcriber = DictationTranscriber(locale: locale, preset: .progressiveLongDictation)
    let modules: [any SpeechModule] = [transcriber]
    let engine = AVAudioEngine()
    let source = engine.inputNode.outputFormat(forBus: 0)
    guard source.sampleRate > 0,
          let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules, considering: source),
          let converter = AVAudioConverter(from: source, to: format) else {
      quit("no microphone, or no audio format the dictation model takes", 4)
    }

    let (inputs, feed) = AsyncStream<AnalyzerInput>.makeStream()
    engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: source) { pcm, _ in
      let capacity = AVAudioFrameCount(Double(pcm.frameLength) * format.sampleRate / source.sampleRate) + 64
      let converted = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity)!
      var given = false
      converter.convert(to: converted, error: nil) { _, status in
        if given { status.pointee = .noDataNow; return nil }
        given = true
        status.pointee = .haveData
        return pcm
      }
      if converted.frameLength > 0 { feed.yield(AnalyzerInput(buffer: converted)) }
    }
    do { try engine.start() } catch { quit("microphone: \(error.localizedDescription)", 5) }

    signal(SIGTERM, SIG_IGN)
    let stop = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    stop.setEventHandler {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      feed.finish()
    }
    stop.resume()

    let writer = Task {
      var settled = ""
      for try await result in transcriber.results {
        let text = String(result.text.characters)
        if result.isFinal { settled += text }
        try? (result.isFinal ? settled : settled + text).write(to: out, atomically: true, encoding: .utf8)
      }
    }
    do {
      let analyzer = SpeechAnalyzer(modules: modules)
      _ = try await analyzer.analyzeSequence(inputs)
      try await analyzer.finalizeAndFinishThroughEndOfInput()
      try await writer.value
    } catch {
      quit("\(error)", 1)
    }
  }

  static func quit(_ why: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data((why + "\n").utf8))
    exit(code)
  }
}
