// Pass through the official Codex backend. Persist routing metadata, never raw messages.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

class CodexCapture
{
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16777216 };
    static string DirectoryPath;
    static Process Backend;
    static int Count;
    static string LastResponseAt;
    static string CaptureError;

    static object Field(object value, string key)
    {
        var fields = value as Dictionary<string, object>;
        object result;
        return fields != null && fields.TryGetValue(key, out result) ? result : null;
    }

    static string Small(object value)
    {
        var s = value as string;
        return !String.IsNullOrEmpty(s) && s.Length <= 256 ? s : null;
    }

    static void Status()
    {
        try {
            var value = new { collectorPid = Process.GetCurrentProcess().Id, backendPid = Backend.Id,
                responseCount = Count, lastResponseAt = LastResponseAt, error = CaptureError };
            File.WriteAllText(Path.Combine(DirectoryPath, "collector.json"), Json.Serialize(value), new UTF8Encoding(false));
        } catch { /* Capture storage must never break the official backend. */ }
    }

    static bool Trace(string line)
    {
        if (!line.Contains("tungstenite::protocol") && !line.Contains("codex_api::sse::responses")) return false;
        // Compact native logs put their top-level target first or last. Other layouts
        // still use the JSON parser, so warnings mentioning a traffic target pass through.
        bool traffic = line.StartsWith("{\"target\":\"tungstenite::protocol\",", StringComparison.Ordinal) ||
            line.StartsWith("{\"target\":\"codex_api::sse::responses\",", StringComparison.Ordinal) ||
            line.EndsWith(",\"target\":\"tungstenite::protocol\"}", StringComparison.Ordinal) ||
            line.EndsWith(",\"target\":\"codex_api::sse::responses\"}", StringComparison.Ordinal);
        // Outgoing payloads and text deltas carry no routing evidence. Unicode escapes
        // may encode an event name, so leave those to the JSON parser as well.
        bool routing = line.Contains("response.created") || line.Contains("response.completed") ||
            line.Contains("response.failed") || line.Contains("response.incomplete");
        if (traffic && !routing && !line.Contains(@"\\u")) return true;
        try {
            var log = Json.DeserializeObject(line);
            var target = Field(log, "target") as string;
            if (target != "tungstenite::protocol" && target != "codex_api::sse::responses") return false;
            // Drop all native traffic traces from desktop stderr, including outgoing frames.
            var message = Field(Field(log, "fields"), "message") as string;
            string prefix = message != null && message.StartsWith("Received message ") ? "Received message " :
                message != null && message.StartsWith("SSE event: ") ? "SSE event: " : null;
            if (prefix == null) return true;
            var frame = Json.DeserializeObject(message.Substring(prefix.Length));
            var kind = Small(Field(frame, "type"));
            if (kind != "response.created" && kind != "response.completed" && kind != "response.failed" && kind != "response.incomplete") return true;
            var response = Field(frame, "response");
            var id = Small(Field(response, "id"));
            var model = Small(Field(response, "model"));
            if (id == null || model == null) return true;
            var now = DateTime.UtcNow.ToString("o");
            var record = new { source = "codex-native-trace-v1", responseId = id, model = model, observedAt = now, eventType = kind };
            // One journal per backend process avoids interleaved writes across desktop windows.
            var journal = Path.Combine(DirectoryPath, "responses-" + Backend.Id + ".jsonl");
            using (var stream = new FileStream(journal, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
            using (var writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.WriteLine(Json.Serialize(record));
            if (kind == "response.completed" || kind == "response.failed" || kind == "response.incomplete") Count++;
            LastResponseAt = now;
            Status();
            return true;
        } catch {
            // Never forward a malformed trace containing private data to desktop logs.
            if (line.Contains("tungstenite::protocol") || line.Contains("codex_api::sse::responses")) {
                CaptureError = "响应采集未完成，请检查采集目录或 Codex 版本";
                Status();
                return true;
            }
            return false;
        }
    }

    // Windows quoting preserves empty arguments, embedded quotes and trailing slashes.
    static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(c);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    static void Pump(Stream input, Stream output)
    {
        var buffer = new byte[8192];
        int count;
        while ((count = input.Read(buffer, 0, buffer.Length)) > 0) {
            output.Write(buffer, 0, count);
            // app-server is interactive: flush each chunk rather than waiting for EOF.
            output.Flush();
        }
    }

    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        var real = Environment.GetEnvironmentVariable("TOKEN_LENS_REAL_CODEX");
        DirectoryPath = Environment.GetEnvironmentVariable("TOKEN_LENS_CAPTURE_DIR");
        if (String.IsNullOrEmpty(real) || !File.Exists(real) || Path.GetFullPath(real) == Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName)) {
            Console.Error.WriteLine("Token Lens: 官方 Codex 后端路径无效"); return 1;
        }
        bool capture = Array.IndexOf(args, "app-server") >= 0 && !String.IsNullOrEmpty(DirectoryPath);
        var info = new ProcessStartInfo(real, String.Join(" ", Array.ConvertAll(args, Quote))) {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true, StandardErrorEncoding = Encoding.UTF8
        };
        if (capture) {
            try { Directory.CreateDirectory(DirectoryPath); }
            catch { Console.Error.WriteLine("Token Lens: 无法打开响应采集目录"); return 1; }
            info.EnvironmentVariables["LOG_FORMAT"] = "json";
            info.EnvironmentVariables["RUST_LOG"] = "warn,tungstenite::protocol=trace,tungstenite::protocol::frame=off,codex_api::sse::responses=trace";
        }
        try {
            using (var job = new BackendJob())
            using (Backend = Process.Start(info)) {
                job.Attach(Backend);
                if (capture) Status();
                Task.Run(() => {
                    try { Pump(Console.OpenStandardInput(), Backend.StandardInput.BaseStream); }
                    catch { }
                    finally { try { Backend.StandardInput.Close(); } catch { } }
                });
                var output = Task.Run(() => Pump(Backend.StandardOutput.BaseStream, Console.OpenStandardOutput()));
                var errors = Task.Run(() => {
                    string line;
                    while ((line = Backend.StandardError.ReadLine()) != null) {
                        if (!capture || !Trace(line)) Console.Error.WriteLine(line);
                    }
                });
                Backend.WaitForExit();
                Task.WaitAll(output, errors);
                return Backend.ExitCode;
            }
        } catch {
            Console.Error.WriteLine("Token Lens: 无法启动官方 Codex 后端"); return 1;
        }
    }

    // Kill the native backend when desktop terminates this wrapper, including forced exits.
    sealed class BackendJob : IDisposable
    {
        readonly IntPtr Handle;
        public BackendJob() {
            Handle = CreateJobObject(IntPtr.Zero, null);
            var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000;
            int size = Marshal.SizeOf(limits);
            IntPtr data = Marshal.AllocHGlobal(size);
            try {
                Marshal.StructureToPtr(limits, data, false);
                if (Handle == IntPtr.Zero || !SetInformationJobObject(Handle, 9, data, (uint)size)) throw new IOException("Job setup failed");
            } finally { Marshal.FreeHGlobal(data); }
        }
        public void Attach(Process p) {
            if (!AssignProcessToJobObject(Handle, p.Handle)) { try { p.Kill(); } catch { } throw new IOException("Job attach failed"); }
        }
        public void Dispose() { if (Handle != IntPtr.Zero) CloseHandle(Handle); }
        [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
            public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet;
            public uint ActiveProcessLimit; public UIntPtr Affinity; public uint Priority, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
            public BasicLimits Basic; public IoCounters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint size);
        [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    }
}
