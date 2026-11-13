// Live dictation for omarchy-voice (macOS 26+): listens to the default microphone and types what is
// being said into a terminal as it is said, then lets whisper.cpp correct it.
//   live <terminal> <cols> <rows> <wav> <words file> [<whisper-cli> <model>]
// With "-" for the terminal, the text goes to <wav>.txt instead (replaced whole each time), for a
// box that isn't a terminal (a chat's): omarchy-voice moves it from there.
// While it runs, Apple's on-device dictation model (SpeechAnalyzer) writes the words down, in the
// language macOS dictation is set to; each change is typed at once, taking back the letters that
// changed. SIGTERM ends it: the last words go in, then, with whisper given, whisper.cpp writes the
// whole recording (<wav>) down and that replaces what was typed. whisper is slower but hears words of
// other languages inside the speech, which Apple's model does not.
// <words file>: terms to expect, one per line (names, English words), read when whisper starts; it
// may be missing. The microphone opens first, so what is said while the rest starts is not lost.
// Typing goes through `hc attach` in a pty of the terminal's own size, so nothing is resized.

import AVFAudio
import Foundation
import Speech

// The text with its control characters as spaces: a line end or an escape from a model would reach a
// program as Enter or a key, and could send the words off.
func clean(_ text: String) -> String {
  String(String.UnicodeScalarView(text.unicodeScalars.map { $0.value < 0x20 || (0x7f...0x9f).contains($0.value) ? " " : $0 }))
}

// Where the words go: `set` makes the text so far what's there, `close` ends it.
protocol Sink: AnyObject, Sendable {
  func set(_ text: String)
  func close()
}

// A file that always holds the text so far.
final class TextFile: Sink, @unchecked Sendable {
  private let url: URL
  private let lock = NSLock()

  init(_ path: String) { url = URL(fileURLWithPath: path) }

  func set(_ text: String) {
    lock.lock()
    defer { lock.unlock() }
    try? clean(text).write(to: url, atomically: true, encoding: .utf8)
  }

  func close() {}
}

// The terminal's keyboard, and what has been typed into it so far.
final class Typist: Sink, @unchecked Sendable {
  private let master: Int32
  private let attach = Process()
  private var typed: [Character] = []
  private let lock = NSLock()

  init(terminal: String, cols: UInt16, rows: UInt16) throws {
    master = posix_openpt(O_RDWR | O_NOCTTY)
    guard master >= 0, grantpt(master) == 0, unlockpt(master) == 0, let name = ptsname(master) else {
      throw NSError(domain: "live", code: 1, userInfo: [NSLocalizedDescriptionKey: "no pty"])
    }
    let slave = open(name, O_RDWR | O_NOCTTY)
    // Raw before hc starts, so letters sent early aren't held for a line end or echoed.
    var mode = termios()
    tcgetattr(slave, &mode)
    cfmakeraw(&mode)
    tcsetattr(slave, TCSANOW, &mode)
    var size = winsize(ws_row: rows, ws_col: cols, ws_xpixel: 0, ws_ypixel: 0)
    _ = ioctl(slave, TIOCSWINSZ, &size)
    let tty = FileHandle(fileDescriptor: slave, closeOnDealloc: true)
    attach.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    attach.arguments = ["hc", "attach", terminal]
    attach.standardInput = tty
    attach.standardOutput = tty
    attach.standardError = tty
    try attach.run()
    // The screen hc paints goes nowhere.
    let fd = master
    Thread {
      var buffer = [UInt8](repeating: 0, count: 65536)
      while read(fd, &buffer, buffer.count) > 0 {}
    }.start()
  }

  // Makes the typed text `text` (clean): backspaces over what differs, then the new end. Keys written
  // before hc is attached wait in the pty.
  func set(_ text: String) {
    lock.lock()
    defer { lock.unlock() }
    let new = Array(clean(text))
    var same = 0
    while same < typed.count, same < new.count, typed[same] == new[same] { same += 1 }
    let keys = String(repeating: "\u{7f}", count: typed.count - same) + String(new[same...])
    typed = new
    var bytes = Array(keys.utf8)
    while !bytes.isEmpty {
      let wrote = write(master, bytes, bytes.count)
      if wrote <= 0 { return }
      bytes.removeFirst(wrote)
    }
  }

  // Detaches (Ctrl+\) once hc has passed every key on, and waits for it to go (killed after 3 s).
  // Ending it any sooner loses the last keys: hc takes about half a second to pass them on.
  func close() {
    lock.lock()
    defer { lock.unlock() }
    _ = write(master, [0x1c], 1)
    let deadline = Date().addingTimeInterval(3)
    while attach.isRunning, Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
    if attach.isRunning { attach.terminate() }
  }
}

@main
struct Live {
  static func main() async {
    let args = CommandLine.arguments
    guard args.count == 6 || args.count == 8, let cols = UInt16(args[2]), let rows = UInt16(args[3]) else {
      quit("usage: live <terminal> <cols> <rows> <wav> <words file> [<whisper-cli> <model>]", 2)
    }
    let wav = URL(fileURLWithPath: args[4])
    // Listening before anything else: the buffers wait in `taps` until the model is ready for them.
    let engine = AVAudioEngine()
    let source = engine.inputNode.outputFormat(forBus: 0)
    guard source.sampleRate > 0 else { quit("no microphone", 4) }
    let (taps, tapped) = AsyncStream<AVAudioPCMBuffer>.makeStream()
    engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: source) { pcm, _ in
      // The engine reuses its buffer.
      guard let from = pcm.floatChannelData,
            let copy = AVAudioPCMBuffer(pcmFormat: pcm.format, frameCapacity: pcm.frameLength), let to = copy.floatChannelData else { return }
      copy.frameLength = pcm.frameLength
      for channel in 0..<Int(pcm.format.channelCount) {
        to[channel].update(from: from[channel], count: Int(pcm.frameLength))
      }
      tapped.yield(copy)
    }
    do { try engine.start() } catch { quit("microphone: \(error.localizedDescription)", 5) }
    signal(SIGTERM, SIG_IGN)
    let stop = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    stop.setEventHandler {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      tapped.finish()
    }
    stop.resume()

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
    // What whisper.cpp reads: 16 kHz mono 16-bit.
    let kept = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: false)!
    guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules, considering: source),
          let toModel = AVAudioConverter(from: source, to: format),
          let toFile = AVAudioConverter(from: source, to: kept) else {
      quit("no audio format the dictation model takes", 4)
    }
    var recording: AVAudioFile?
    do {
      recording = try AVAudioFile(forWriting: wav, settings: kept.settings, commonFormat: .pcmFormatInt16, interleaved: false)
    } catch { quit("recording: \(error.localizedDescription)", 5) }
    let typist: Sink
    if args[1] == "-" {
      typist = TextFile(args[4] + ".txt")
    } else {
      do { typist = try Typist(terminal: args[1], cols: cols, rows: rows) } catch { quit("terminal: \(error.localizedDescription)", 6) }
    }
    let (inputs, feed) = AsyncStream<AnalyzerInput>.makeStream()
    Task {
      for await pcm in taps {
        if let heard = convert(pcm, with: toModel, to: format) { feed.yield(AnalyzerInput(buffer: heard)) }
        if let part = convert(pcm, with: toFile, to: kept) { try? recording?.write(from: part) }
      }
      // Closes the WAV.
      recording = nil
      feed.finish()
    }

    let writer = Task {
      var settled = ""
      for try await result in transcriber.results {
        let text = String(result.text.characters)
        if result.isFinal { settled += text }
        typist.set(result.isFinal ? settled : settled + text)
      }
      return settled
    }
    var heard = ""
    do {
      let analyzer = SpeechAnalyzer(modules: modules)
      _ = try await analyzer.analyzeSequence(inputs)
      try await analyzer.finalizeAndFinishThroughEndOfInput()
      heard = try await writer.value
    } catch {
      typist.close()
      quit("\(error)", 1)
    }
    let words = ((try? String(contentsOfFile: args[5], encoding: .utf8)) ?? "")
      .split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    if args.count == 8, !heard.trimmingCharacters(in: .whitespaces).isEmpty,
       let better = whisper(args[6], model: args[7], wav: wav, language: locale.language.languageCode?.identifier ?? "auto", words: words) {
      typist.set(better)
    }
    typist.close()
  }

  // One tap buffer in another format, or nil when nothing came out.
  static func convert(_ pcm: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
    let capacity = AVAudioFrameCount(Double(pcm.frameLength) * format.sampleRate / pcm.format.sampleRate) + 64
    guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var given = false
    converter.convert(to: out, error: nil) { _, status in
      if given { status.pointee = .noDataNow; return nil }
      given = true
      status.pointee = .haveData
      return pcm
    }
    return out.frameLength > 0 ? out : nil
  }

  // whisper.cpp's text for the recording, without its markers for silence and noise ("[BLANK_AUDIO]",
  // "(music)"); nil when it fails or hears nothing. The words go in as its prompt.
  static func whisper(_ cli: String, model: String, wav: URL, language: String, words: [String]) -> String? {
    let run = Process()
    run.executableURL = URL(fileURLWithPath: cli)
    run.arguments = ["-m", model, "-f", wav.path, "-l", language, "-nt", "-np", "-t", "8"]
      + (words.isEmpty ? [] : ["--prompt", words.joined(separator: ", ")])
    let out = Pipe()
    run.standardOutput = out
    run.standardError = FileHandle.nullDevice
    guard (try? run.run()) != nil else { return nil }
    let said = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    run.waitUntilExit()
    guard run.terminationStatus == 0 else { return nil }
    let text = said.split(separator: "\n")
      .map { $0.replacing(#/\[[^\]]*\]|\([^)]*\)/#, with: "").trimmingCharacters(in: .whitespaces) }
      .filter { !$0.isEmpty }.joined(separator: " ")
    return text.isEmpty ? nil : text
  }

  static func quit(_ why: String, _ code: Int32) -> Never {
    FileHandle.standardError.write(Data((why + "\n").utf8))
    exit(code)
  }
}
