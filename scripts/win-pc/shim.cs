using System; using System.Diagnostics; using System.IO; using System.Text;
// Runs the Python script of the same name beside this file, so `herdr-task` starts on Windows.
class Shim {
  static string Q(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] {' ', '\t', '\n', '\r', '"'}) < 0) return a;
    var s = new StringBuilder("\""); int b = 0;
    foreach (char c in a) { if (c == '\\') { b++; continue; } if (c == '"') s.Append('\\', b * 2 + 1); else s.Append('\\', b); b = 0; s.Append(c); }
    return s.Append('\\', b * 2).Append('"').ToString();
  }
  // python.exe from PATH's full paths only. Started by bare name, Windows would look in the current
  // folder first, and these tools run inside whatever repo an agent is working in.
  static string Python() {
    foreach (string entry in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
      string d = entry.Trim().Trim('"');
      bool full = d.StartsWith(@"\\") || (d.Length > 2 && char.IsLetter(d[0]) && d[1] == ':' && (d[2] == '\\' || d[2] == '/'));
      if (!full || d.IndexOfAny(Path.GetInvalidPathChars()) >= 0) continue;
      string exe = Path.Combine(d, "python.exe");
      if (File.Exists(exe)) return exe;
    }
    return null;
  }
  static int Main(string[] args) {
    string python = Python();
    if (python == null) { Console.Error.WriteLine("python.exe was not found in a full path on PATH"); return 127; }
    string self = Process.GetCurrentProcess().MainModule.FileName;
    var line = new StringBuilder("-X utf8 " + Q(Path.ChangeExtension(self, null)));
    foreach (string a in args) line.Append(' ').Append(Q(a));
    var p = Process.Start(new ProcessStartInfo(python, line.ToString()) { UseShellExecute = false });
    p.WaitForExit(); return p.ExitCode;
  }
}
