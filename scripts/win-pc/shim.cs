using System; using System.Diagnostics; using System.IO; using System.Text;
// Runs the Python script of the same name beside this file, so `herdr-task` starts on Windows.
class Shim {
  static string Q(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] {' ', '\t', '\n', '\r', '"'}) < 0) return a;
    var s = new StringBuilder("\""); int b = 0;
    foreach (char c in a) { if (c == '\\') { b++; continue; } if (c == '"') s.Append('\\', b * 2 + 1); else s.Append('\\', b); b = 0; s.Append(c); }
    return s.Append('\\', b * 2).Append('"').ToString();
  }
  static int Main(string[] args) {
    string self = Process.GetCurrentProcess().MainModule.FileName;
    var line = new StringBuilder("-X utf8 " + Q(Path.ChangeExtension(self, null)));
    foreach (string a in args) line.Append(' ').Append(Q(a));
    var p = Process.Start(new ProcessStartInfo("python", line.ToString()) { UseShellExecute = false });
    p.WaitForExit(); return p.ExitCode;
  }
}
