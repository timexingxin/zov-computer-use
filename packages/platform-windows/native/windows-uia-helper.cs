using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

namespace Zov.WindowsHelper
{
    internal static class NativeMethods
    {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        public const int GWL_EXSTYLE = -20;
        public const long WS_EX_TOOLWINDOW = 0x00000080L;
        public const long WS_EX_APPWINDOW = 0x00040000L;
        public const int DWMWA_CLOAKED = 14;

        public const int SW_MINIMIZE = 6;
        public const int SW_MAXIMIZE = 3;
        public const int SW_RESTORE = 9;
        public const int SW_SHOWNOACTIVATE = 4;

        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;

        public const uint GA_ROOT = 2;
        public const uint PW_RENDERFULLCONTENT = 0x00000002;

        public const int SM_XVIRTUALSCREEN = 76;
        public const int SM_YVIRTUALSCREEN = 77;
        public const int SM_CXVIRTUALSCREEN = 78;
        public const int SM_CYVIRTUALSCREEN = 79;

        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;

        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint MOUSEEVENTF_HWHEEL = 0x01000;
        public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;
        public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;

        public const ushort VK_BACK = 0x08;
        public const ushort VK_TAB = 0x09;
        public const ushort VK_RETURN = 0x0D;
        public const ushort VK_SHIFT = 0x10;
        public const ushort VK_CONTROL = 0x11;
        public const ushort VK_MENU = 0x12; // ALT
        public const ushort VK_ESCAPE = 0x1B;
        public const ushort VK_SPACE = 0x20;
        public const ushort VK_PRIOR = 0x21; // PageUp
        public const ushort VK_NEXT = 0x22;  // PageDown
        public const ushort VK_END = 0x23;
        public const ushort VK_HOME = 0x24;
        public const ushort VK_LEFT = 0x25;
        public const ushort VK_UP = 0x26;
        public const ushort VK_RIGHT = 0x27;
        public const ushort VK_DOWN = 0x28;
        public const ushort VK_INSERT = 0x2D;
        public const ushort VK_DELETE = 0x2E;
        public const ushort VK_LWIN = 0x5B;

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [DllImport("user32.dll")]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiFlag);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
        private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
        private static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

        public static long GetWindowLongVal(IntPtr hWnd, int nIndex)
        {
            if (IntPtr.Size == 8)
            {
                return GetWindowLongPtr64(hWnd, nIndex).ToInt64();
            }
            return (long)GetWindowLong32(hWnd, nIndex);
        }

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

        [DllImport("user32.dll")]
        public static extern IntPtr WindowFromPoint(POINT Point);

        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern short VkKeyScanW(char ch);

        [DllImport("user32.dll")]
        public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

        [DllImport("user32.dll")]
        public static extern uint GetDpiForWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        public static extern IntPtr MonitorFromRect(ref RECT lprc, uint dwFlags);

        [DllImport("shcore.dll")]
        public static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

        public static void EnablePerMonitorDpi()
        {
            try
            {
                // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4
                if (SetProcessDpiAwarenessContext(new IntPtr(-4)))
                {
                    return;
                }
            }
            catch
            {
            }
            try
            {
                SetProcessDPIAware();
            }
            catch
            {
            }
        }

        public static bool IsWindowCloaked(IntPtr hWnd)
        {
            try
            {
                int cloaked = 0;
                int hr = DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out cloaked, Marshal.SizeOf(typeof(int)));
                return hr == 0 && cloaked != 0;
            }
            catch
            {
                return false;
            }
        }

        public static double GetScaleForWindow(IntPtr hWnd)
        {
            try
            {
                uint dpi = GetDpiForWindow(hWnd);
                if (dpi >= 72 && dpi <= 960)
                {
                    return Math.Round((double)dpi / 96.0, 2);
                }
            }
            catch
            {
            }
            return 1.0;
        }

        public static double GetScaleForRect(Rectangle bounds)
        {
            try
            {
                RECT rc = new RECT();
                rc.Left = bounds.Left;
                rc.Top = bounds.Top;
                rc.Right = bounds.Right;
                rc.Bottom = bounds.Bottom;
                IntPtr hMon = MonitorFromRect(ref rc, 2); // MONITOR_DEFAULTTONEAREST
                if (hMon != IntPtr.Zero)
                {
                    uint dpiX;
                    uint dpiY;
                    if (GetDpiForMonitor(hMon, 0, out dpiX, out dpiY) == 0 && dpiX >= 72)
                    {
                        return Math.Round((double)dpiX / 96.0, 2);
                    }
                }
            }
            catch
            {
            }
            return 1.0;
        }
    }

    internal static class JsonOut
    {
        public static string Escape(string s)
        {
            if (s == null) return "null";
            StringBuilder sb = new StringBuilder(s.Length + 8);
            sb.Append('"');
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u");
                            sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }

        public static string Num(long v)
        {
            return v.ToString(CultureInfo.InvariantCulture);
        }

        public static string NumD(double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) return "0";
            return v.ToString("0.###", CultureInfo.InvariantCulture);
        }

        public static string Bool(bool b)
        {
            return b ? "true" : "false";
        }

        public static string StrArray(IList<string> items)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('[');
            for (int i = 0; i < items.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(Escape(items[i]));
            }
            sb.Append(']');
            return sb.ToString();
        }

        public static string LongArray(IList<long> items)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('[');
            for (int i = 0; i < items.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(Num(items[i]));
            }
            sb.Append(']');
            return sb.ToString();
        }

        public static string BoundsObj(int x, int y, int w, int h)
        {
            return "{\"x\":" + Num(x) + ",\"y\":" + Num(y) + ",\"width\":" + Num(w) + ",\"height\":" + Num(h) + "}";
        }

        public static void Fail(string message, string code)
        {
            Console.Out.WriteLine("{\"error\":" + Escape(message) + ",\"code\":" + Escape(code) + "}");
            Console.Out.Flush();
            Environment.Exit(1);
        }
    }

    internal sealed class WinRecord
    {
        public long Id;
        public int Pid;
        public string Title;
        public string AppName;
        public string BundleId;
        public int X;
        public int Y;
        public int Width;
        public int Height;
        public bool IsMinimized;
        public bool IsFocused;

        public string ToJson()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"id\":").Append(JsonOut.Num(Id)).Append(',');
            sb.Append("\"pid\":").Append(JsonOut.Num(Pid)).Append(',');
            sb.Append("\"title\":").Append(JsonOut.Escape(Title ?? "")).Append(',');
            sb.Append("\"app_name\":").Append(JsonOut.Escape(AppName ?? "")).Append(',');
            sb.Append("\"bundle_id\":").Append(JsonOut.Escape(BundleId ?? "")).Append(',');
            sb.Append("\"bounds\":").Append(JsonOut.BoundsObj(X, Y, Width, Height)).Append(',');
            sb.Append("\"is_minimized\":").Append(JsonOut.Bool(IsMinimized)).Append(',');
            sb.Append("\"is_focused\":").Append(JsonOut.Bool(IsFocused));
            sb.Append('}');
            return sb.ToString();
        }
    }

    internal sealed class AppRecord
    {
        public int Pid;
        public string Name;
        public string BundleId;
        public bool Active;
        public int WindowsCount;

        public string ToJson()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"pid\":").Append(JsonOut.Num(Pid)).Append(',');
            sb.Append("\"name\":").Append(JsonOut.Escape(Name ?? "")).Append(',');
            sb.Append("\"bundle_id\":").Append(JsonOut.Escape(BundleId ?? "")).Append(',');
            sb.Append("\"active\":").Append(JsonOut.Bool(Active)).Append(',');
            sb.Append("\"windows_count\":").Append(JsonOut.Num(WindowsCount));
            sb.Append('}');
            return sb.ToString();
        }
    }

    internal static class Program
    {
        private static Dictionary<int, Tuple<string, string>> _procMetaCache = new Dictionary<int, Tuple<string, string>>();

        private static Tuple<string, string> GetProcessMeta(int pid)
        {
            Tuple<string, string> cached;
            if (_procMetaCache.TryGetValue(pid, out cached))
            {
                return cached;
            }
            string name = "pid-" + pid.ToString(CultureInfo.InvariantCulture);
            string exeName = name + ".exe";
            try
            {
                Process p = Process.GetProcessById(pid);
                if (!string.IsNullOrEmpty(p.ProcessName))
                {
                    name = p.ProcessName;
                    exeName = p.ProcessName + ".exe";
                }
                try
                {
                    if (p.MainModule != null && !string.IsNullOrEmpty(p.MainModule.ModuleName))
                    {
                        exeName = p.MainModule.ModuleName;
                    }
                }
                catch
                {
                }
            }
            catch
            {
            }
            Tuple<string, string> res = new Tuple<string, string>(name, exeName);
            _procMetaCache[pid] = res;
            return res;
        }

        private static string GetWindowTitle(IntPtr hWnd)
        {
            int len = NativeMethods.GetWindowTextLength(hWnd);
            if (len <= 0) return "";
            StringBuilder sb = new StringBuilder(len + 2);
            NativeMethods.GetWindowText(hWnd, sb, sb.Capacity);
            return sb.ToString();
        }

        private static List<WinRecord> CollectWindows(int filterPid)
        {
            List<WinRecord> results = new List<WinRecord>();
            IntPtr fgHwnd = NativeMethods.GetForegroundWindow();

            NativeMethods.EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
            {
                if (!NativeMethods.IsWindowVisible(hWnd)) return true;
                if (NativeMethods.IsWindowCloaked(hWnd)) return true;

                long exStyle = NativeMethods.GetWindowLongVal(hWnd, NativeMethods.GWL_EXSTYLE);
                if ((exStyle & NativeMethods.WS_EX_TOOLWINDOW) != 0 && (exStyle & NativeMethods.WS_EX_APPWINDOW) == 0)
                {
                    return true;
                }

                uint rawPid;
                NativeMethods.GetWindowThreadProcessId(hWnd, out rawPid);
                int pid = (int)rawPid;
                if (pid <= 0) return true;
                if (filterPid > 0 && pid != filterPid) return true;

                NativeMethods.RECT rc;
                if (!NativeMethods.GetWindowRect(hWnd, out rc)) return true;
                bool minimized = NativeMethods.IsIconic(hWnd);
                int w = rc.Right - rc.Left;
                int h = rc.Bottom - rc.Top;
                if (!minimized && (w <= 1 || h <= 1)) return true;

                string title = GetWindowTitle(hWnd);
                Tuple<string, string> meta = GetProcessMeta(pid);
                if (string.IsNullOrEmpty(title) && string.Equals(meta.Item1, "explorer", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                WinRecord rec = new WinRecord();
                rec.Id = hWnd.ToInt64();
                rec.Pid = pid;
                rec.Title = title;
                rec.AppName = meta.Item1;
                rec.BundleId = meta.Item2;
                rec.X = minimized ? 0 : rc.Left;
                rec.Y = minimized ? 0 : rc.Top;
                rec.Width = minimized ? 0 : Math.Max(0, w);
                rec.Height = minimized ? 0 : Math.Max(0, h);
                rec.IsMinimized = minimized;
                rec.IsFocused = (hWnd == fgHwnd);
                results.Add(rec);
                return true;
            }, IntPtr.Zero);

            results.Sort(delegate(WinRecord a, WinRecord b)
            {
                if (a.IsFocused != b.IsFocused) return a.IsFocused ? -1 : 1;
                if (a.IsMinimized != b.IsMinimized) return a.IsMinimized ? 1 : -1;
                return 0;
            });
            return results;
        }

        private static List<AppRecord> CollectApps()
        {
            List<WinRecord> wins = CollectWindows(0);
            IntPtr fgHwnd = NativeMethods.GetForegroundWindow();
            uint fgPidRaw = 0;
            if (fgHwnd != IntPtr.Zero)
            {
                NativeMethods.GetWindowThreadProcessId(fgHwnd, out fgPidRaw);
            }
            int fgPid = (int)fgPidRaw;

            Dictionary<int, AppRecord> byPid = new Dictionary<int, AppRecord>();
            List<int> order = new List<int>();

            for (int i = 0; i < wins.Count; i++)
            {
                WinRecord w = wins[i];
                AppRecord app;
                if (!byPid.TryGetValue(w.Pid, out app))
                {
                    app = new AppRecord();
                    app.Pid = w.Pid;
                    app.Name = w.AppName;
                    app.BundleId = w.BundleId;
                    app.Active = (w.Pid == fgPid) || w.IsFocused;
                    app.WindowsCount = 1;
                    byPid[w.Pid] = app;
                    order.Add(w.Pid);
                }
                else
                {
                    app.WindowsCount++;
                    if (w.IsFocused) app.Active = true;
                }
            }

            List<AppRecord> list = new List<AppRecord>();
            for (int i = 0; i < order.Count; i++)
            {
                list.Add(byPid[order[i]]);
            }
            list.Sort(delegate(AppRecord a, AppRecord b)
            {
                if (a.Active != b.Active) return a.Active ? -1 : 1;
                return string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
            });
            return list;
        }

        private static readonly HashSet<string> ValueFlags = new HashSet<string>(StringComparer.Ordinal)
        {
            "--pid", "--window-id", "--display-id", "--max-depth", "--max-nodes",
            "--path", "--action", "--value", "--expected-role", "--expected-identifier",
            "--expected-name", "--expected-bounds", "--out", "--target", "--activate",
            "--op", "--x", "--y", "--to-x", "--to-y", "--from-x", "--from-y",
            "--width", "--height", "--button", "--count", "--modifiers",
            "--restore-cursor", "--require-pid", "--delta-x", "--delta-y",
            "--text", "--key", "--repeat", "--parent-pid"
        };

        private static Dictionary<string, string> _parsedOpts = new Dictionary<string, string>(StringComparer.Ordinal);
        private static bool _parsedDryRun = false;

        private static void ParseCliArgs(string[] args)
        {
            _parsedOpts.Clear();
            _parsedDryRun = false;
            if (args == null) return;
            int i = 1;
            while (i < args.Length)
            {
                string tok = args[i];
                if (tok == "--dry-run")
                {
                    if (i + 1 < args.Length && (args[i + 1] == "0" || args[i + 1] == "1" || string.Equals(args[i + 1], "true", StringComparison.OrdinalIgnoreCase) || string.Equals(args[i + 1], "false", StringComparison.OrdinalIgnoreCase)))
                    {
                        string v = args[i + 1];
                        _parsedDryRun = (v == "1" || string.Equals(v, "true", StringComparison.OrdinalIgnoreCase));
                        i += 2;
                    }
                    else
                    {
                        _parsedDryRun = true;
                        i += 1;
                    }
                    continue;
                }
                if (ValueFlags.Contains(tok))
                {
                    if (i + 1 >= args.Length)
                    {
                        JsonOut.Fail("Missing value for flag " + tok, "invalid_argument");
                    }
                    _parsedOpts[tok] = args[i + 1];
                    i += 2;
                    continue;
                }
                JsonOut.Fail("Unknown flag or unexpected positional argument: " + tok, "invalid_argument");
            }
        }

        private static string GetArg(string[] args, string flag)
        {
            string val;
            if (_parsedOpts.TryGetValue(flag, out val))
            {
                return val;
            }
            return null;
        }

        private static bool HasFlag(string[] args, string flag)
        {
            if (flag == "--dry-run") return _parsedDryRun;
            string val;
            if (_parsedOpts.TryGetValue(flag, out val))
            {
                return !(val == "0" || string.Equals(val, "false", StringComparison.OrdinalIgnoreCase));
            }
            return false;
        }

        private static int ParsePositiveInt(string raw, string name)
        {
            int val = 0;
            if (string.IsNullOrEmpty(raw) || !int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out val) || val <= 0)
            {
                JsonOut.Fail(name + " must be a positive integer", "invalid_argument");
            }
            return val;
        }

        private static long ParsePositiveLong(string raw, string name)
        {
            long val = 0;
            if (string.IsNullOrEmpty(raw) || !long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out val) || val <= 0)
            {
                JsonOut.Fail(name + " must be a positive integer", "invalid_argument");
            }
            return val;
        }

        private static double ParseCoord(string raw, string name)
        {
            double val = 0.0;
            if (string.IsNullOrEmpty(raw) || !double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out val) || double.IsNaN(val) || double.IsInfinity(val) || Math.Abs(val) > 100000.0)
            {
                JsonOut.Fail("Invalid or out-of-bounds coordinate for " + name, "invalid_argument");
            }
            return val;
        }

        private static List<long> ParseJsonLongArray(string raw)
        {
            if (string.IsNullOrEmpty(raw))
            {
                JsonOut.Fail("Missing --path JSON array", "invalid_argument");
            }
            string trimmed = raw.Trim();
            if (!trimmed.StartsWith("[") || !trimmed.EndsWith("]"))
            {
                JsonOut.Fail("--path must be a JSON integer array", "invalid_argument");
            }
            string inner = trimmed.Substring(1, trimmed.Length - 2).Trim();
            List<long> res = new List<long>();
            if (inner.Length == 0) return res;
            string[] parts = inner.Split(',');
            for (int i = 0; i < parts.Length; i++)
            {
                long v;
                if (!long.TryParse(parts[i].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out v) || v < 0)
                {
                    JsonOut.Fail("Invalid integer in --path array", "invalid_argument");
                }
                res.Add(v);
            }
            return res;
        }

        private static void StartParentWatchdog(int parentPid)
        {
            if (parentPid <= 0) return;
            Thread t = new Thread(delegate()
            {
                while (true)
                {
                    Thread.Sleep(250);
                    try
                    {
                        Process p = Process.GetProcessById(parentPid);
                        if (p.HasExited)
                        {
                            Environment.Exit(1);
                        }
                    }
                    catch
                    {
                        Environment.Exit(1);
                    }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        private static void MapRole(ControlType ct, bool isPassword, out string role, out string subrole)
        {
            subrole = null;
            if (ct == ControlType.Button || ct == ControlType.SplitButton) { role = "button"; return; }
            if (ct == ControlType.Edit)
            {
                if (isPassword)
                {
                    role = "securetextfield";
                    subrole = "securetextfield";
                }
                else
                {
                    role = "textfield";
                }
                return;
            }
            if (ct == ControlType.Document) { role = "textarea"; return; }
            if (ct == ControlType.ComboBox) { role = "combobox"; return; }
            if (ct == ControlType.CheckBox) { role = "checkbox"; return; }
            if (ct == ControlType.RadioButton) { role = "radiobutton"; return; }
            if (ct == ControlType.Hyperlink) { role = "link"; return; }
            if (ct == ControlType.MenuItem) { role = "menuitem"; return; }
            if (ct == ControlType.Menu || ct == ControlType.MenuBar) { role = "menu"; return; }
            if (ct == ControlType.TabItem) { role = "tab"; return; }
            if (ct == ControlType.Tab) { role = "tabgroup"; return; }
            if (ct == ControlType.DataItem) { role = "cell"; return; }
            if (ct == ControlType.ListItem) { role = "row"; return; }
            if (ct == ControlType.TreeItem) { role = "row"; return; }
            if (ct == ControlType.Text) { role = "statictext"; return; }
            if (ct == ControlType.Window) { role = "window"; return; }
            if (ct == ControlType.ToolBar) { role = "toolbar"; return; }
            if (ct == ControlType.Slider || ct == ControlType.Spinner) { role = "slider"; return; }
            if (ct == ControlType.ScrollBar) { role = "scrollbar"; return; }
            if (ct == ControlType.Image) { role = "image"; return; }
            if (ct == ControlType.List || ct == ControlType.DataGrid || ct == ControlType.Table) { role = "table"; return; }
            if (ct == ControlType.Tree) { role = "outline"; return; }
            role = "group";
        }

        private sealed class InspectContext
        {
            public int MaxDepth;
            public int MaxNodes;
            public int NodeCounter;
            public Stopwatch Timer;
            public long DeadlineMs;
        }

        private static string InspectNodeJson(AutomationElement el, List<long> path, int depth, InspectContext ctx)
        {
            if (el == null || depth > ctx.MaxDepth || ctx.NodeCounter >= ctx.MaxNodes) return null;
            if (ctx.Timer.ElapsedMilliseconds > ctx.DeadlineMs) return null;

            string role = "group";
            string subrole = null;
            string name = "";
            string identifier = "";
            string desc = "";
            string valStr = null;
            bool hasValue = false;
            bool enabled = true;
            bool focused = false;
            bool hasBounds = false;
            int bx = 0, by = 0, bw = 0, bh = 0;

            List<string> actions = new List<string>();
            List<string> caps = new List<string>();

            try
            {
                AutomationElement.AutomationElementInformation cur = el.Current;
                bool isPassword = false;
                try { isPassword = cur.IsPassword; } catch { }
                MapRole(cur.ControlType, isPassword, out role, out subrole);
                name = cur.Name ?? "";
                identifier = cur.AutomationId ?? "";
                enabled = cur.IsEnabled;
                focused = cur.HasKeyboardFocus;

                string accel = "";
                string help = "";
                try { accel = cur.AcceleratorKey ?? ""; } catch { }
                try { help = cur.HelpText ?? ""; } catch { }
                desc = !string.IsNullOrEmpty(accel) ? accel : help;

                System.Windows.Rect r = cur.BoundingRectangle;
                if (!r.IsEmpty && !double.IsInfinity(r.X) && !double.IsInfinity(r.Y) && !double.IsNaN(r.Width) && !double.IsNaN(r.Height) && r.Width > 0 && r.Height > 0)
                {
                    hasBounds = true;
                    bx = (int)Math.Round(r.X);
                    by = (int)Math.Round(r.Y);
                    bw = (int)Math.Round(r.Width);
                    bh = (int)Math.Round(r.Height);
                }

                if (isPassword)
                {
                    hasValue = true;
                    valStr = "[REDACTED_PASSWORD]";
                    caps.Add("editable");
                    actions.Add("setValue");
                }
                else
                {
                    object patObj;
                    if (el.TryGetCurrentPattern(ValuePattern.Pattern, out patObj) && patObj != null)
                    {
                        ValuePattern vp = (ValuePattern)patObj;
                        try
                        {
                            valStr = vp.Current.Value;
                            hasValue = (valStr != null);
                            if (!vp.Current.IsReadOnly)
                            {
                                actions.Add("setValue");
                                caps.Add("editable");
                            }
                        }
                        catch { }
                    }
                    else if (el.TryGetCurrentPattern(RangeValuePattern.Pattern, out patObj) && patObj != null)
                    {
                        RangeValuePattern rvp = (RangeValuePattern)patObj;
                        try
                        {
                            valStr = rvp.Current.Value.ToString("0.###", CultureInfo.InvariantCulture);
                            hasValue = true;
                        }
                        catch { }
                    }
                }

                object invObj;
                if (el.TryGetCurrentPattern(InvokePattern.Pattern, out invObj) && invObj != null)
                {
                    actions.Add("AXPress");
                    if (!caps.Contains("pressable")) caps.Add("pressable");
                }

                object togObj;
                if (el.TryGetCurrentPattern(TogglePattern.Pattern, out togObj) && togObj != null)
                {
                    if (!actions.Contains("AXPress")) actions.Add("AXPress");
                    actions.Add("toggle");
                    if (!caps.Contains("pressable")) caps.Add("pressable");
                    if (!hasValue)
                    {
                        try
                        {
                            ToggleState ts = ((TogglePattern)togObj).Current.ToggleState;
                            valStr = ts == ToggleState.On ? "1" : (ts == ToggleState.Off ? "0" : "mixed");
                            hasValue = true;
                        }
                        catch { }
                    }
                }

                object selObj;
                if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out selObj) && selObj != null)
                {
                    if (!actions.Contains("AXPress")) actions.Add("AXPress");
                    actions.Add("select");
                    if (!caps.Contains("pressable")) caps.Add("pressable");
                }

                object expObj;
                if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out expObj) && expObj != null)
                {
                    actions.Add("expand");
                    actions.Add("collapse");
                    if (!caps.Contains("has_menu")) caps.Add("has_menu");
                }

                if (actions.Count == 0 && enabled && hasBounds)
                {
                    if (role == "button" || role == "link" || role == "menuitem" || role == "tab" || role == "checkbox" || role == "radiobutton" || role == "cell" || role == "row")
                    {
                        caps.Add("clickable");
                    }
                }
            }
            catch
            {
                return null;
            }

            int myIndex = ctx.NodeCounter++;
            List<string> childrenJson = new List<string>();

            if (depth < ctx.MaxDepth && ctx.NodeCounter < ctx.MaxNodes && ctx.Timer.ElapsedMilliseconds <= ctx.DeadlineMs)
            {
                try
                {
                    AutomationElement child = TreeWalker.ControlViewWalker.GetFirstChild(el);
                    long childIdx = 0;
                    while (child != null && ctx.NodeCounter < ctx.MaxNodes && ctx.Timer.ElapsedMilliseconds <= ctx.DeadlineMs)
                    {
                        List<long> childPath = new List<long>(path);
                        childPath.Add(childIdx);
                        string cj = InspectNodeJson(child, childPath, depth + 1, ctx);
                        if (cj != null)
                        {
                            childrenJson.Add(cj);
                        }
                        childIdx++;
                        try
                        {
                            child = TreeWalker.ControlViewWalker.GetNextSibling(child);
                        }
                        catch
                        {
                            break;
                        }
                    }
                }
                catch
                {
                }
            }

            StringBuilder sb = new StringBuilder();
            sb.Append('{');
            sb.Append("\"index\":").Append(JsonOut.Num(myIndex)).Append(',');
            sb.Append("\"handle\":\"\",");
            sb.Append("\"role\":").Append(JsonOut.Escape(role)).Append(',');
            if (subrole != null)
            {
                sb.Append("\"subrole\":").Append(JsonOut.Escape(subrole)).Append(',');
            }
            if (!string.IsNullOrEmpty(identifier))
            {
                sb.Append("\"identifier\":").Append(JsonOut.Escape(identifier)).Append(',');
            }
            sb.Append("\"name\":").Append(JsonOut.Escape(name)).Append(',');
            if (!string.IsNullOrEmpty(desc))
            {
                sb.Append("\"description\":").Append(JsonOut.Escape(desc)).Append(',');
            }
            if (hasValue && valStr != null)
            {
                sb.Append("\"value\":").Append(JsonOut.Escape(valStr)).Append(',');
            }
            if (hasBounds)
            {
                sb.Append("\"bounds\":").Append(JsonOut.BoundsObj(bx, by, bw, bh)).Append(',');
            }
            sb.Append("\"enabled\":").Append(JsonOut.Bool(enabled)).Append(',');
            sb.Append("\"focused\":").Append(JsonOut.Bool(focused)).Append(',');
            sb.Append("\"capabilities\":").Append(JsonOut.StrArray(caps)).Append(',');
            sb.Append("\"actions\":").Append(JsonOut.StrArray(actions)).Append(',');
            sb.Append("\"ax_path\":").Append(JsonOut.LongArray(path));
            if (childrenJson.Count > 0)
            {
                sb.Append(",\"children\":[");
                for (int i = 0; i < childrenJson.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    sb.Append(childrenJson[i]);
                }
                sb.Append(']');
            }
            sb.Append('}');
            return sb.ToString();
        }

        private static AutomationElement ResolveByPath(int expectedPid, List<long> path)
        {
            if (path == null || path.Count == 0)
            {
                JsonOut.Fail("Empty --path", "stale_handle");
            }
            IntPtr hwnd = new IntPtr(path[0]);
            if (!NativeMethods.IsWindow(hwnd))
            {
                JsonOut.Fail("Target window no longer exists", "stale_handle");
            }
            uint ownerPid = 0;
            NativeMethods.GetWindowThreadProcessId(hwnd, out ownerPid);
            if ((int)ownerPid != expectedPid)
            {
                JsonOut.Fail("Window PID mismatch on ax_path", "stale_handle");
            }

            AutomationElement cur = null;
            try
            {
                cur = AutomationElement.FromHandle(hwnd);
            }
            catch (UnauthorizedAccessException)
            {
                JsonOut.Fail("Windows UIPI blocked access to elevated window", "permission_denied");
            }
            catch
            {
                JsonOut.Fail("Failed to bind AutomationElement for window", "stale_handle");
            }

            for (int step = 1; step < path.Count; step++)
            {
                long targetIdx = path[step];
                AutomationElement child = null;
                try
                {
                    child = TreeWalker.ControlViewWalker.GetFirstChild(cur);
                    long idx = 0;
                    while (child != null && idx < targetIdx)
                    {
                        child = TreeWalker.ControlViewWalker.GetNextSibling(child);
                        idx++;
                    }
                }
                catch
                {
                    JsonOut.Fail("UIA tree changed while walking ax_path", "stale_handle");
                }
                if (child == null)
                {
                    JsonOut.Fail("Element child index out of range (UI changed)", "stale_handle");
                }
                cur = child;
            }
            return cur;
        }

        private static NativeMethods.INPUT MakeMouseInput(int dx, int dy, uint flags, uint mouseData)
        {
            NativeMethods.INPUT inp = new NativeMethods.INPUT();
            inp.type = NativeMethods.INPUT_MOUSE;
            inp.U.mi.dx = dx;
            inp.U.mi.dy = dy;
            inp.U.mi.dwFlags = flags;
            inp.U.mi.mouseData = mouseData;
            inp.U.mi.time = 0;
            inp.U.mi.dwExtraInfo = IntPtr.Zero;
            return inp;
        }

        private static NativeMethods.INPUT MakeVkInput(ushort vk, bool keyUp)
        {
            NativeMethods.INPUT inp = new NativeMethods.INPUT();
            inp.type = NativeMethods.INPUT_KEYBOARD;
            inp.U.ki.wVk = vk;
            inp.U.ki.wScan = 0;
            uint flags = keyUp ? NativeMethods.KEYEVENTF_KEYUP : 0u;
            if (vk == NativeMethods.VK_UP || vk == NativeMethods.VK_DOWN || vk == NativeMethods.VK_LEFT || vk == NativeMethods.VK_RIGHT ||
                vk == NativeMethods.VK_HOME || vk == NativeMethods.VK_END || vk == NativeMethods.VK_PRIOR || vk == NativeMethods.VK_NEXT ||
                vk == NativeMethods.VK_INSERT || vk == NativeMethods.VK_DELETE || vk == NativeMethods.VK_LWIN)
            {
                flags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;
            }
            inp.U.ki.dwFlags = flags;
            inp.U.ki.time = 0;
            inp.U.ki.dwExtraInfo = IntPtr.Zero;
            return inp;
        }

        private static NativeMethods.INPUT MakeUnicodeInput(ushort utf16Unit, bool keyUp)
        {
            NativeMethods.INPUT inp = new NativeMethods.INPUT();
            inp.type = NativeMethods.INPUT_KEYBOARD;
            inp.U.ki.wVk = 0;
            inp.U.ki.wScan = utf16Unit;
            inp.U.ki.dwFlags = NativeMethods.KEYEVENTF_UNICODE | (keyUp ? NativeMethods.KEYEVENTF_KEYUP : 0u);
            inp.U.ki.time = 0;
            inp.U.ki.dwExtraInfo = IntPtr.Zero;
            return inp;
        }

        private static void DispatchInputs(NativeMethods.INPUT[] inputs)
        {
            if (inputs == null || inputs.Length == 0) return;
            uint sent = NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
            if (sent == 0)
            {
                int err = Marshal.GetLastWin32Error();
                JsonOut.Fail("Win32 SendInput blocked or failed (err=" + err.ToString(CultureInfo.InvariantCulture) + "; check UIPI elevation or locked desktop)", "permission_denied");
            }
        }

        private static void NormalizeVirtualCoords(int x, int y, out int normX, out int normY)
        {
            int vx = NativeMethods.GetSystemMetrics(NativeMethods.SM_XVIRTUALSCREEN);
            int vy = NativeMethods.GetSystemMetrics(NativeMethods.SM_YVIRTUALSCREEN);
            int vw = Math.Max(2, NativeMethods.GetSystemMetrics(NativeMethods.SM_CXVIRTUALSCREEN));
            int vh = Math.Max(2, NativeMethods.GetSystemMetrics(NativeMethods.SM_CYVIRTUALSCREEN));
            normX = (int)(((long)(x - vx) * 65535L) / (long)(vw - 1));
            normY = (int)(((long)(y - vy) * 65535L) / (long)(vh - 1));
        }

        private static ushort ModifierToVk(string rawMod, out string canonical)
        {
            string m = (rawMod ?? "").Trim().ToLowerInvariant();
            if (m == "ctrl" || m == "control") { canonical = "ctrl"; return NativeMethods.VK_CONTROL; }
            if (m == "alt" || m == "option" || m == "opt") { canonical = "alt"; return NativeMethods.VK_MENU; }
            if (m == "shift") { canonical = "shift"; return NativeMethods.VK_SHIFT; }
            if (m == "cmd" || m == "command" || m == "meta" || m == "super" || m == "win" || m == "windows") { canonical = "win"; return NativeMethods.VK_LWIN; }
            canonical = "";
            JsonOut.Fail("Unrecognized modifier: '" + rawMod + "' (expected ctrl/alt/shift/cmd/win)", "invalid_argument");
            return 0;
        }

        private static List<ushort> ParseModifiers(string csv, out List<string> canonicalMods)
        {
            canonicalMods = new List<string>();
            List<ushort> vks = new List<ushort>();
            if (string.IsNullOrEmpty(csv)) return vks;
            string[] parts = csv.Split(',');
            for (int i = 0; i < parts.Length; i++)
            {
                string tok = parts[i].Trim();
                if (tok.Length == 0)
                {
                    JsonOut.Fail("Empty modifier token", "invalid_argument");
                }
                string can;
                ushort vk = ModifierToVk(tok, out can);
                if (!vks.Contains(vk))
                {
                    vks.Add(vk);
                    canonicalMods.Add(can);
                }
            }
            return vks;
        }

        private static void ResolveKeyAndChord(string rawKey, List<ushort> modVks, List<string> modNames, out ushort mainVk, out string resolvedName)
        {
            if (string.IsNullOrEmpty(rawKey))
            {
                JsonOut.Fail("Key must not be empty", "invalid_argument");
            }

            string keyToken = rawKey;
            if (rawKey.Length > 1 && rawKey.Contains("+"))
            {
                if (rawKey.StartsWith("+"))
                {
                    JsonOut.Fail("Invalid key chord: '" + rawKey + "'", "invalid_argument");
                }
                if (rawKey.EndsWith("++"))
                {
                    string prefix = rawKey.Substring(0, rawKey.Length - 2);
                    if (prefix.Length == 0 || prefix.EndsWith("+"))
                    {
                        JsonOut.Fail("Invalid key chord: '" + rawKey + "'", "invalid_argument");
                    }
                    string[] modTokens = prefix.Split('+');
                    for (int i = 0; i < modTokens.Length; i++)
                    {
                        if (modTokens[i].Length == 0) JsonOut.Fail("Invalid key chord: '" + rawKey + "'", "invalid_argument");
                        string can;
                        ushort mvk = ModifierToVk(modTokens[i], out can);
                        if (!modVks.Contains(mvk)) { modVks.Add(mvk); modNames.Add(can); }
                    }
                    keyToken = "+";
                }
                else if (rawKey.EndsWith("+"))
                {
                    JsonOut.Fail("Invalid key chord: '" + rawKey + "'", "invalid_argument");
                }
                else
                {
                    string[] tokens = rawKey.Split('+');
                    for (int i = 0; i < tokens.Length - 1; i++)
                    {
                        if (tokens[i].Length == 0) JsonOut.Fail("Invalid key chord: '" + rawKey + "'", "invalid_argument");
                        string can;
                        ushort mvk = ModifierToVk(tokens[i], out can);
                        if (!modVks.Contains(mvk)) { modVks.Add(mvk); modNames.Add(can); }
                    }
                    keyToken = tokens[tokens.Length - 1];
                    if (keyToken.Length == 0) JsonOut.Fail("Invalid key chord: '" + rawKey + "'", "invalid_argument");
                }
            }

            string lower = keyToken.ToLowerInvariant();
            resolvedName = lower;

            if (lower == "return" || lower == "enter") { mainVk = NativeMethods.VK_RETURN; return; }
            if (lower == "tab") { mainVk = NativeMethods.VK_TAB; return; }
            if (lower == "space" || keyToken == " ") { mainVk = NativeMethods.VK_SPACE; resolvedName = "space"; return; }
            if (lower == "backspace" || lower == "delete") { mainVk = NativeMethods.VK_BACK; return; }
            if (lower == "forwarddelete" || lower == "del") { mainVk = NativeMethods.VK_DELETE; return; }
            if (lower == "escape" || lower == "esc") { mainVk = NativeMethods.VK_ESCAPE; return; }
            if (lower == "up" || lower == "arrowup") { mainVk = NativeMethods.VK_UP; return; }
            if (lower == "down" || lower == "arrowdown") { mainVk = NativeMethods.VK_DOWN; return; }
            if (lower == "left" || lower == "arrowleft") { mainVk = NativeMethods.VK_LEFT; return; }
            if (lower == "right" || lower == "arrowright") { mainVk = NativeMethods.VK_RIGHT; return; }
            if (lower == "home") { mainVk = NativeMethods.VK_HOME; return; }
            if (lower == "end") { mainVk = NativeMethods.VK_END; return; }
            if (lower == "pageup" || lower == "pgup") { mainVk = NativeMethods.VK_PRIOR; return; }
            if (lower == "pagedown" || lower == "pgdn") { mainVk = NativeMethods.VK_NEXT; return; }
            if (lower == "insert" || lower == "ins") { mainVk = NativeMethods.VK_INSERT; return; }

            if (lower.StartsWith("f") && lower.Length >= 2 && lower.Length <= 3)
            {
                int fn;
                if (int.TryParse(lower.Substring(1), NumberStyles.Integer, CultureInfo.InvariantCulture, out fn) && fn >= 1 && fn <= 24)
                {
                    mainVk = (ushort)(0x70 + (fn - 1));
                    return;
                }
            }

            if (keyToken.Length == 1)
            {
                char ch = keyToken[0];
                bool hasCtrlOrWin = modVks.Contains(NativeMethods.VK_CONTROL) || modVks.Contains(NativeMethods.VK_LWIN);
                if (ch >= 'A' && ch <= 'Z')
                {
                    if (!hasCtrlOrWin && !modVks.Contains(NativeMethods.VK_SHIFT))
                    {
                        modVks.Add(NativeMethods.VK_SHIFT);
                        modNames.Add("shift");
                    }
                    mainVk = (ushort)ch;
                    return;
                }
                if (ch >= 'a' && ch <= 'z')
                {
                    mainVk = (ushort)char.ToUpperInvariant(ch);
                    return;
                }
                if (ch >= '0' && ch <= '9')
                {
                    mainVk = (ushort)ch;
                    return;
                }

                short scan = NativeMethods.VkKeyScanW(ch);
                if (scan != -1)
                {
                    mainVk = (ushort)(scan & 0xFF);
                    int shiftState = (scan >> 8) & 0xFF;
                    if ((shiftState & 1) != 0 && !modVks.Contains(NativeMethods.VK_SHIFT))
                    {
                        modVks.Add(NativeMethods.VK_SHIFT);
                        modNames.Add("shift");
                    }
                    return;
                }
            }

            mainVk = 0;
            JsonOut.Fail("Unsupported or unrecognized key: '" + rawKey + "'", "invalid_argument");
        }

        [STAThread]
        public static int Main(string[] args)
        {
            Console.OutputEncoding = new UTF8Encoding(false);
            Console.InputEncoding = new UTF8Encoding(false);
            NativeMethods.EnablePerMonitorDpi();

            if (args == null || args.Length == 0)
            {
                JsonOut.Fail("Missing subcommand", "invalid_argument");
            }

            ParseCliArgs(args);

            string parentPidStr = GetArg(args, "--parent-pid");
            if (!string.IsNullOrEmpty(parentPidStr))
            {
                int ppid;
                if (int.TryParse(parentPidStr, NumberStyles.Integer, CultureInfo.InvariantCulture, out ppid) && ppid > 0)
                {
                    StartParentWatchdog(ppid);
                }
            }

            string subcmd = args[0];
            bool dryRun = HasFlag(args, "--dry-run");

            switch (subcmd)
            {
                case "permissions":
                {
                    bool uiaOk = false;
                    bool screenOk = false;
                    try
                    {
                        uiaOk = (AutomationElement.RootElement != null);
                    }
                    catch { }
                    try
                    {
                        Screen ps = Screen.PrimaryScreen;
                        screenOk = (ps != null && ps.Bounds.Width > 0 && ps.Bounds.Height > 0);
                    }
                    catch { }
                    Console.Out.WriteLine("{\"accessibility\":" + JsonOut.Bool(uiaOk) + ",\"screen_recording\":" + JsonOut.Bool(screenOk) + "}");
                    return 0;
                }

                case "screen-info":
                {
                    Screen[] screens = Screen.AllScreens;
                    Screen primary = Screen.PrimaryScreen ?? (screens.Length > 0 ? screens[0] : null);
                    if (primary == null)
                    {
                        Console.Out.WriteLine("{\"platform\":\"win32\",\"displays\":0,\"main_display\":{\"width\":0,\"height\":0,\"scale\":1,\"pixel_width\":0,\"pixel_height\":0},\"displays_detail\":[]}");
                        return 0;
                    }
                    double mainScale = NativeMethods.GetScaleForRect(primary.Bounds);
                    int pw = primary.Bounds.Width;
                    int ph = primary.Bounds.Height;
                    StringBuilder sb = new StringBuilder();
                    sb.Append("{\"platform\":\"win32\",\"displays\":").Append(JsonOut.Num(screens.Length)).Append(',');
                    sb.Append("\"main_display\":{\"width\":").Append(JsonOut.Num(pw)).Append(",\"height\":").Append(JsonOut.Num(ph));
                    sb.Append(",\"scale\":").Append(JsonOut.NumD(mainScale));
                    sb.Append(",\"pixel_width\":").Append(JsonOut.Num(pw)).Append(",\"pixel_height\":").Append(JsonOut.Num(ph)).Append("},");
                    sb.Append("\"displays_detail\":[");
                    for (int i = 0; i < screens.Length; i++)
                    {
                        if (i > 0) sb.Append(',');
                        Screen s = screens[i];
                        double sc = NativeMethods.GetScaleForRect(s.Bounds);
                        sb.Append("{\"id\":").Append(JsonOut.Num(i + 1));
                        sb.Append(",\"is_main\":").Append(JsonOut.Bool(s.Primary));
                        sb.Append(",\"bounds\":").Append(JsonOut.BoundsObj(s.Bounds.X, s.Bounds.Y, s.Bounds.Width, s.Bounds.Height));
                        sb.Append(",\"scale\":").Append(JsonOut.NumD(sc)).Append('}');
                    }
                    sb.Append("]}");
                    Console.Out.WriteLine(sb.ToString());
                    return 0;
                }

                case "list-apps":
                {
                    List<AppRecord> apps = CollectApps();
                    StringBuilder sb = new StringBuilder();
                    sb.Append('[');
                    for (int i = 0; i < apps.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        sb.Append(apps[i].ToJson());
                    }
                    sb.Append(']');
                    Console.Out.WriteLine(sb.ToString());
                    return 0;
                }

                case "list-windows":
                {
                    string pidArg = GetArg(args, "--pid");
                    int filterPid = 0;
                    if (!string.IsNullOrEmpty(pidArg))
                    {
                        filterPid = ParsePositiveInt(pidArg, "--pid");
                    }
                    List<WinRecord> wins = CollectWindows(filterPid);
                    StringBuilder sb = new StringBuilder();
                    sb.Append('[');
                    for (int i = 0; i < wins.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        sb.Append(wins[i].ToJson());
                    }
                    sb.Append(']');
                    Console.Out.WriteLine(sb.ToString());
                    return 0;
                }

                case "inspect":
                {
                    int pid = ParsePositiveInt(GetArg(args, "--pid"), "--pid");
                    int maxDepth = 20;
                    int maxNodes = 3000;
                    string mdArg = GetArg(args, "--max-depth");
                    if (!string.IsNullOrEmpty(mdArg)) maxDepth = ParsePositiveInt(mdArg, "--max-depth");
                    string mnArg = GetArg(args, "--max-nodes");
                    if (!string.IsNullOrEmpty(mnArg)) maxNodes = ParsePositiveInt(mnArg, "--max-nodes");

                    List<WinRecord> wins = CollectWindows(pid);
                    WinRecord targetWin = null;
                    string widArg = GetArg(args, "--window-id");
                    if (!string.IsNullOrEmpty(widArg))
                    {
                        long targetWid = ParsePositiveLong(widArg, "--window-id");
                        for (int i = 0; i < wins.Count; i++)
                        {
                            if (wins[i].Id == targetWid)
                            {
                                targetWin = wins[i];
                                break;
                            }
                        }
                        if (targetWin == null)
                        {
                            JsonOut.Fail("Window not found for pid " + pid.ToString(CultureInfo.InvariantCulture) + ": " + widArg, "window_not_found");
                        }
                    }
                    else if (wins.Count > 0)
                    {
                        targetWin = wins[0];
                    }

                    Tuple<string, string> meta = GetProcessMeta(pid);
                    try
                    {
                        Process.GetProcessById(pid);
                    }
                    catch
                    {
                        JsonOut.Fail("Application process not found: " + pid.ToString(CultureInfo.InvariantCulture), "app_not_found");
                    }

                    AppRecord appRec = new AppRecord();
                    appRec.Pid = pid;
                    appRec.Name = meta.Item1;
                    appRec.BundleId = meta.Item2;
                    appRec.Active = (targetWin != null && targetWin.IsFocused);
                    appRec.WindowsCount = wins.Count;

                    List<string> rootElements = new List<string>();
                    if (targetWin != null)
                    {
                        IntPtr hwnd = new IntPtr(targetWin.Id);
                        AutomationElement winEl = null;
                        try
                        {
                            winEl = AutomationElement.FromHandle(hwnd);
                        }
                        catch (UnauthorizedAccessException)
                        {
                            JsonOut.Fail("Windows UIPI blocked inspection of elevated window", "permission_denied");
                        }
                        catch (Exception ex)
                        {
                            JsonOut.Fail("Failed to inspect window: " + ex.Message, "operation_failed");
                        }

                        InspectContext ctx = new InspectContext();
                        ctx.MaxDepth = maxDepth;
                        ctx.MaxNodes = maxNodes;
                        ctx.NodeCounter = 0;
                        ctx.Timer = Stopwatch.StartNew();
                        ctx.DeadlineMs = 9500;

                        List<long> rootPath = new List<long>();
                        rootPath.Add(targetWin.Id);
                        string rootJson = InspectNodeJson(winEl, rootPath, 0, ctx);
                        if (rootJson != null)
                        {
                            rootElements.Add(rootJson);
                        }
                    }

                    StringBuilder sb = new StringBuilder();
                    sb.Append("{\"app\":").Append(appRec.ToJson()).Append(',');
                    if (targetWin != null)
                    {
                        sb.Append("\"active_window\":").Append(targetWin.ToJson()).Append(',');
                    }
                    sb.Append("\"elements\":[");
                    for (int i = 0; i < rootElements.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        sb.Append(rootElements[i]);
                    }
                    sb.Append("]}");
                    Console.Out.WriteLine(sb.ToString());
                    return 0;
                }

                case "act-element":
                {
                    int pid = ParsePositiveInt(GetArg(args, "--pid"), "--pid");
                    List<long> path = ParseJsonLongArray(GetArg(args, "--path"));
                    string action = GetArg(args, "--action");
                    if (string.IsNullOrEmpty(action))
                    {
                        JsonOut.Fail("Missing --action", "invalid_argument");
                    }

                    string expRole = GetArg(args, "--expected-role");
                    string expId = GetArg(args, "--expected-identifier");
                    string expName = GetArg(args, "--expected-name");
                    string expBounds = GetArg(args, "--expected-bounds");
                    string val = GetArg(args, "--value");

                    if (dryRun)
                    {
                        Console.Out.WriteLine("{\"ok\":true,\"dry_run\":true,\"action\":" + JsonOut.Escape(action) + "}");
                        return 0;
                    }

                    AutomationElement el = ResolveByPath(pid, path);
                    string actualRole;
                    string actualSub;
                    bool isPwd = false;
                    string actualName = "";
                    string actualId = "";
                    System.Windows.Rect actualRect = System.Windows.Rect.Empty;

                    try
                    {
                        AutomationElement.AutomationElementInformation cur = el.Current;
                        try { isPwd = cur.IsPassword; } catch { }
                        MapRole(cur.ControlType, isPwd, out actualRole, out actualSub);
                        actualName = cur.Name ?? "";
                        actualId = cur.AutomationId ?? "";
                        actualRect = cur.BoundingRectangle;
                    }
                    catch
                    {
                        JsonOut.Fail("Element disappeared before dispatch", "stale_handle");
                        return 1;
                    }

                    if (!string.IsNullOrEmpty(expRole) && !string.Equals(actualRole, expRole, StringComparison.OrdinalIgnoreCase))
                    {
                        JsonOut.Fail("TOCTOU role mismatch: expected " + expRole + ", got " + actualRole, "stale_handle");
                    }
                    if (!string.IsNullOrEmpty(expId) && !string.Equals(actualId, expId, StringComparison.Ordinal))
                    {
                        JsonOut.Fail("TOCTOU AutomationId mismatch", "stale_handle");
                    }
                    if (!string.IsNullOrEmpty(expName) && string.IsNullOrEmpty(expId) && !string.Equals(actualName, expName, StringComparison.Ordinal))
                    {
                        JsonOut.Fail("TOCTOU element name mismatch", "stale_handle");
                    }
                    if (!string.IsNullOrEmpty(expBounds) && string.IsNullOrEmpty(expId) && string.IsNullOrEmpty(expName))
                    {
                        string[] bp = expBounds.Split(',');
                        if (bp.Length == 4 && !actualRect.IsEmpty)
                        {
                            double ex, ey, ew, eh;
                            if (double.TryParse(bp[0], NumberStyles.Float, CultureInfo.InvariantCulture, out ex) &&
                                double.TryParse(bp[1], NumberStyles.Float, CultureInfo.InvariantCulture, out ey) &&
                                double.TryParse(bp[2], NumberStyles.Float, CultureInfo.InvariantCulture, out ew) &&
                                double.TryParse(bp[3], NumberStyles.Float, CultureInfo.InvariantCulture, out eh))
                            {
                                if (Math.Abs(actualRect.X - ex) > 32 || Math.Abs(actualRect.Y - ey) > 32)
                                {
                                    JsonOut.Fail("TOCTOU bounds shifted beyond tolerance", "stale_handle");
                                }
                            }
                        }
                    }

                    string actLower = action.ToLowerInvariant();
                    try
                    {
                        if (actLower == "axpress" || actLower == "press" || actLower == "invoke")
                        {
                            object pat;
                            if (el.TryGetCurrentPattern(InvokePattern.Pattern, out pat) && pat != null)
                            {
                                ((InvokePattern)pat).Invoke();
                            }
                            else if (el.TryGetCurrentPattern(TogglePattern.Pattern, out pat) && pat != null)
                            {
                                ((TogglePattern)pat).Toggle();
                            }
                            else if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat) && pat != null)
                            {
                                ((SelectionItemPattern)pat).Select();
                            }
                            else
                            {
                                JsonOut.Fail("Element does not support UIA Invoke/Toggle/Select pattern", "action_unavailable");
                            }
                        }
                        else if (actLower == "setvalue" || actLower == "set_value")
                        {
                            object pat;
                            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out pat) && pat != null)
                            {
                                ValuePattern vp = (ValuePattern)pat;
                                if (vp.Current.IsReadOnly)
                                {
                                    JsonOut.Fail("Element ValuePattern is read-only", "not_settable");
                                }
                                vp.SetValue(val ?? "");
                            }
                            else
                            {
                                JsonOut.Fail("Element does not support UIA ValuePattern", "not_settable");
                            }
                        }
                        else if (actLower == "toggle")
                        {
                            object pat;
                            if (el.TryGetCurrentPattern(TogglePattern.Pattern, out pat) && pat != null)
                            {
                                ((TogglePattern)pat).Toggle();
                            }
                            else
                            {
                                JsonOut.Fail("Element does not support TogglePattern", "action_unavailable");
                            }
                        }
                        else if (actLower == "expand")
                        {
                            object pat;
                            if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat) && pat != null)
                            {
                                ((ExpandCollapsePattern)pat).Expand();
                            }
                            else
                            {
                                JsonOut.Fail("Element does not support ExpandCollapsePattern", "action_unavailable");
                            }
                        }
                        else if (actLower == "collapse")
                        {
                            object pat;
                            if (el.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat) && pat != null)
                            {
                                ((ExpandCollapsePattern)pat).Collapse();
                            }
                            else
                            {
                                JsonOut.Fail("Element does not support ExpandCollapsePattern", "action_unavailable");
                            }
                        }
                        else if (actLower == "select")
                        {
                            object pat;
                            if (el.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat) && pat != null)
                            {
                                ((SelectionItemPattern)pat).Select();
                            }
                            else
                            {
                                JsonOut.Fail("Element does not support SelectionItemPattern", "action_unavailable");
                            }
                        }
                        else
                        {
                            JsonOut.Fail("Unsupported UIA action: " + action, "invalid_argument");
                        }
                    }
                    catch (UnauthorizedAccessException)
                    {
                        JsonOut.Fail("Windows UIPI blocked action on elevated control", "permission_denied");
                    }
                    catch (ElementNotEnabledException)
                    {
                        JsonOut.Fail("Target element is disabled", "action_unavailable");
                    }
                    catch (InvalidOperationException ex)
                    {
                        JsonOut.Fail("UIA pattern rejected operation: " + ex.Message, "action_unavailable");
                    }

                    Console.Out.WriteLine("{\"ok\":true}");
                    return 0;
                }

                case "screenshot":
                {
                    string outPath = GetArg(args, "--out");
                    if (string.IsNullOrEmpty(outPath))
                    {
                        JsonOut.Fail("Missing --out path", "invalid_argument");
                    }
                    string widArg = GetArg(args, "--window-id");
                    string dispArg = GetArg(args, "--display-id");

                    if (!string.IsNullOrEmpty(widArg) && !string.IsNullOrEmpty(dispArg))
                    {
                        JsonOut.Fail("Specify either --window-id or --display-id, not both", "invalid_argument");
                    }

                    if (!string.IsNullOrEmpty(widArg))
                    {
                        long wid = ParsePositiveLong(widArg, "--window-id");
                        IntPtr hwnd = new IntPtr(wid);
                        if (!NativeMethods.IsWindow(hwnd))
                        {
                            JsonOut.Fail("Window not found: " + widArg, "window_not_found");
                        }
                        if (NativeMethods.IsIconic(hwnd))
                        {
                            JsonOut.Fail("Cannot capture minimized window without restoring it", "operation_failed");
                        }
                        NativeMethods.RECT rc;
                        if (!NativeMethods.GetWindowRect(hwnd, out rc))
                        {
                            JsonOut.Fail("GetWindowRect failed for window " + widArg, "operation_failed");
                        }
                        int w = Math.Max(1, rc.Right - rc.Left);
                        int h = Math.Max(1, rc.Bottom - rc.Top);
                        double scale = NativeMethods.GetScaleForWindow(hwnd);

                        using (Bitmap bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                        {
                            bool rendered = false;
                            using (Graphics g = Graphics.FromImage(bmp))
                            {
                                IntPtr hdc = g.GetHdc();
                                try
                                {
                                    rendered = NativeMethods.PrintWindow(hwnd, hdc, NativeMethods.PW_RENDERFULLCONTENT);
                                }
                                finally
                                {
                                    g.ReleaseHdc(hdc);
                                }
                                if (!rendered)
                                {
                                    g.CopyFromScreen(rc.Left, rc.Top, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
                                }
                            }
                            bmp.Save(outPath, ImageFormat.Png);
                        }

                        int ptW = (int)Math.Round(w / (scale > 0 ? scale : 1.0));
                        int ptH = (int)Math.Round(h / (scale > 0 ? scale : 1.0));
                        Console.Out.WriteLine("{\"ok\":true,\"width\":" + JsonOut.Num(w) + ",\"height\":" + JsonOut.Num(h) + ",\"scale_factor\":" + JsonOut.NumD(scale) + ",\"point_width\":" + JsonOut.Num(ptW) + ",\"point_height\":" + JsonOut.Num(ptH) + "}");
                        return 0;
                    }

                    Screen[] screens = Screen.AllScreens;
                    Screen targetScreen = Screen.PrimaryScreen ?? (screens.Length > 0 ? screens[0] : null);
                    if (!string.IsNullOrEmpty(dispArg))
                    {
                        int dispIdx = ParsePositiveInt(dispArg, "--display-id");
                        if (dispIdx > screens.Length)
                        {
                            JsonOut.Fail("display_id " + dispArg + " out of range (displays=" + screens.Length.ToString(CultureInfo.InvariantCulture) + ")", "invalid_argument");
                        }
                        targetScreen = screens[dispIdx - 1];
                    }
                    if (targetScreen == null)
                    {
                        JsonOut.Fail("No active display available for screenshot", "operation_failed");
                    }

                    Rectangle sb = targetScreen.Bounds;
                    double dispScale = NativeMethods.GetScaleForRect(sb);
                    using (Bitmap bmp = new Bitmap(sb.Width, sb.Height, PixelFormat.Format32bppArgb))
                    {
                        using (Graphics g = Graphics.FromImage(bmp))
                        {
                            g.CopyFromScreen(sb.X, sb.Y, 0, 0, new Size(sb.Width, sb.Height), CopyPixelOperation.SourceCopy);
                        }
                        bmp.Save(outPath, ImageFormat.Png);
                    }
                    int dPtW = (int)Math.Round(sb.Width / (dispScale > 0 ? dispScale : 1.0));
                    int dPtH = (int)Math.Round(sb.Height / (dispScale > 0 ? dispScale : 1.0));
                    Console.Out.WriteLine("{\"ok\":true,\"width\":" + JsonOut.Num(sb.Width) + ",\"height\":" + JsonOut.Num(sb.Height) + ",\"scale_factor\":" + JsonOut.NumD(dispScale) + ",\"point_width\":" + JsonOut.Num(dPtW) + ",\"point_height\":" + JsonOut.Num(dPtH) + "}");
                    return 0;
                }

                case "launch-app":
                {
                    string target = GetArg(args, "--target");
                    if (string.IsNullOrEmpty(target) || target.Trim().Length == 0)
                    {
                        JsonOut.Fail("Missing --target application name or path", "invalid_argument");
                    }
                    bool activate = true;
                    string actArg = GetArg(args, "--activate");
                    if (actArg == "0" || string.Equals(actArg, "false", StringComparison.OrdinalIgnoreCase))
                    {
                        activate = false;
                    }
                    if (dryRun)
                    {
                        Console.Out.WriteLine("{\"ok\":true,\"dry_run\":true,\"target\":" + JsonOut.Escape(target) + "}");
                        return 0;
                    }
                    try
                    {
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = target;
                        psi.UseShellExecute = true;
                        if (!activate)
                        {
                            psi.WindowStyle = ProcessWindowStyle.Minimized;
                        }
                        Process p = Process.Start(psi);
                        int launchedPid = (p != null) ? p.Id : 0;
                        Console.Out.WriteLine("{\"ok\":true,\"pid\":" + JsonOut.Num(launchedPid) + "}");
                        return 0;
                    }
                    catch (Exception ex)
                    {
                        JsonOut.Fail("Failed to launch '" + target + "': " + ex.Message, "app_not_found");
                        return 1;
                    }
                }

                case "focus-app":
                {
                    int pid = ParsePositiveInt(GetArg(args, "--pid"), "--pid");
                    if (dryRun)
                    {
                        Console.Out.WriteLine("{\"ok\":true,\"dry_run\":true}");
                        return 0;
                    }
                    List<WinRecord> wins = CollectWindows(pid);
                    if (wins.Count == 0)
                    {
                        Console.Out.WriteLine("{\"ok\":false}");
                        return 0;
                    }
                    IntPtr hwnd = new IntPtr(wins[0].Id);
                    if (NativeMethods.IsIconic(hwnd))
                    {
                        NativeMethods.ShowWindow(hwnd, NativeMethods.SW_RESTORE);
                    }
                    bool ok = NativeMethods.SetForegroundWindow(hwnd);
                    Console.Out.WriteLine("{\"ok\":" + JsonOut.Bool(ok) + "}");
                    return 0;
                }

                case "window-op":
                {
                    string op = GetArg(args, "--op");
                    if (string.IsNullOrEmpty(op))
                    {
                        JsonOut.Fail("Missing --op", "invalid_argument");
                    }
                    long wid = ParsePositiveLong(GetArg(args, "--window-id"), "--window-id");
                    IntPtr hwnd = new IntPtr(wid);

                    if (op == "move")
                    {
                        ParseCoord(GetArg(args, "--x"), "--x");
                        ParseCoord(GetArg(args, "--y"), "--y");
                    }
                    else if (op == "resize")
                    {
                        double rw = ParseCoord(GetArg(args, "--width"), "--width");
                        double rh = ParseCoord(GetArg(args, "--height"), "--height");
                        if (rw <= 10 || rh <= 10)
                        {
                            JsonOut.Fail("Window width and height must be > 10", "invalid_argument");
                        }
                    }
                    else if (op != "focus" && op != "minimize" && op != "maximize")
                    {
                        JsonOut.Fail("Unknown window op: " + op, "invalid_argument");
                    }

                    if (dryRun)
                    {
                        Console.Out.WriteLine("{\"ok\":true,\"dry_run\":true}");
                        return 0;
                    }

                    if (!NativeMethods.IsWindow(hwnd))
                    {
                        JsonOut.Fail("Window not found: " + wid.ToString(CultureInfo.InvariantCulture), "window_not_found");
                    }

                    bool ok = false;
                    if (op == "focus")
                    {
                        if (NativeMethods.IsIconic(hwnd)) NativeMethods.ShowWindow(hwnd, NativeMethods.SW_RESTORE);
                        ok = NativeMethods.SetForegroundWindow(hwnd);
                    }
                    else if (op == "move")
                    {
                        int nx = (int)Math.Round(ParseCoord(GetArg(args, "--x"), "--x"));
                        int ny = (int)Math.Round(ParseCoord(GetArg(args, "--y"), "--y"));
                        ok = NativeMethods.SetWindowPos(hwnd, IntPtr.Zero, nx, ny, 0, 0, NativeMethods.SWP_NOSIZE | NativeMethods.SWP_NOZORDER | NativeMethods.SWP_NOACTIVATE);
                    }
                    else if (op == "resize")
                    {
                        int nw = (int)Math.Round(ParseCoord(GetArg(args, "--width"), "--width"));
                        int nh = (int)Math.Round(ParseCoord(GetArg(args, "--height"), "--height"));
                        ok = NativeMethods.SetWindowPos(hwnd, IntPtr.Zero, 0, 0, nw, nh, NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOZORDER | NativeMethods.SWP_NOACTIVATE);
                    }
                    else if (op == "minimize")
                    {
                        ok = NativeMethods.ShowWindow(hwnd, NativeMethods.SW_MINIMIZE);
                    }
                    else if (op == "maximize")
                    {
                        ok = NativeMethods.ShowWindow(hwnd, NativeMethods.SW_MAXIMIZE);
                    }

                    Console.Out.WriteLine("{\"ok\":" + JsonOut.Bool(ok) + "}");
                    return 0;
                }

                case "click-coord":
                {
                    int x = (int)Math.Round(ParseCoord(GetArg(args, "--x"), "--x"));
                    int y = (int)Math.Round(ParseCoord(GetArg(args, "--y"), "--y"));
                    string button = GetArg(args, "--button") ?? "left";
                    if (button != "left" && button != "right" && button != "middle")
                    {
                        JsonOut.Fail("Invalid button: " + button, "invalid_argument");
                    }
                    int count = 1;
                    string cntArg = GetArg(args, "--count");
                    if (!string.IsNullOrEmpty(cntArg))
                    {
                        count = ParsePositiveInt(cntArg, "--count");
                        if (count > 10) JsonOut.Fail("clickCount must be <= 10", "invalid_argument");
                    }
                    List<string> canMods;
                    List<ushort> modVks = ParseModifiers(GetArg(args, "--modifiers"), out canMods);
                    bool restoreCursor = HasFlag(args, "--restore-cursor");

                    string reqPidStr = GetArg(args, "--require-pid");
                    int reqPid = 0;
                    if (!string.IsNullOrEmpty(reqPidStr))
                    {
                        reqPid = ParsePositiveInt(reqPidStr, "--require-pid");
                    }

                    if (dryRun)
                    {
                        Console.Out.WriteLine("{\"ok\":true,\"dry_run\":true,\"x\":" + JsonOut.Num(x) + ",\"y\":" + JsonOut.Num(y) + ",\"modifiers\":" + JsonOut.StrArray(canMods) + "}");
                        return 0;
                    }

                    if (reqPid > 0)
                    {
                        NativeMethods.POINT hitPt = new NativeMethods.POINT();
                        hitPt.X = x;
                        hitPt.Y = y;
                        IntPtr hitHwnd = NativeMethods.WindowFromPoint(hitPt);
                        if (hitHwnd == IntPtr.Zero)
                        {
                            JsonOut.Fail("Target point is offscreen or occluded", "foreground_required");
                        }
                        IntPtr rootHwnd = NativeMethods.GetAncestor(hitHwnd, NativeMethods.GA_ROOT);
                        uint hitPid = 0;
                        NativeMethods.GetWindowThreadProcessId(rootHwnd != IntPtr.Zero ? rootHwnd : hitHwnd, out hitPid);
                        if ((int)hitPid != reqPid)
                        {
                            JsonOut.Fail("Target point (" + x.ToString(CultureInfo.InvariantCulture) + "," + y.ToString(CultureInfo.InvariantCulture) + ") is occluded by pid=" + hitPid.ToString(CultureInfo.InvariantCulture) + " (expected pid=" + reqPid.ToString(CultureInfo.InvariantCulture) + ")", "foreground_required");
                        }
                    }

                    NativeMethods.POINT savedPt;
                    bool hadSaved = NativeMethods.GetCursorPos(out savedPt);

                    uint downFlag = NativeMethods.MOUSEEVENTF_LEFTDOWN;
                    uint upFlag = NativeMethods.MOUSEEVENTF_LEFTUP;
                    if (button == "right")
                    {
                        downFlag = NativeMethods.MOUSEEVENTF_RIGHTDOWN;
                        upFlag = NativeMethods.MOUSEEVENTF_RIGHTUP;
                    }
                    else if (button == "middle")
                    {
                        downFlag = NativeMethods.MOUSEEVENTF_MIDDLEDOWN;
                        upFlag = NativeMethods.MOUSEEVENTF_MIDDLEUP;
                    }

                    int normX, normY;
                    NormalizeVirtualCoords(x, y, out normX, out normY);
                    NativeMethods.SetCursorPos(x, y);

                    for (int m = 0; m < modVks.Count; m++)
                    {
                        DispatchInputs(new NativeMethods.INPUT[] { MakeVkInput(modVks[m], false) });
                    }
                    try
                    {
                        for (int c = 0; c < count; c++)
                        {
                            DispatchInputs(new NativeMethods.INPUT[]
                            {
                                MakeMouseInput(normX, normY, NativeMethods.MOUSEEVENTF_MOVE | NativeMethods.MOUSEEVENTF_ABSOLUTE | NativeMethods.MOUSEEVENTF_VIRTUALDESK | downFlag, 0),
                                MakeMouseInput(normX, normY, NativeMethods.MOUSEEVENTF_MOVE | NativeMethods.MOUSEEVENTF_ABSOLUTE | NativeMethods.MOUSEEVENTF_VIRTUALDESK | upFlag, 0)
                            });
                            if (c + 1 < count) Thread.Sleep(25);
                        }
                    }
                    finally
                    {
                        for (int m = modVks.Count - 1; m >= 0; m--)
                        {
                            DispatchInputs(new NativeMethods.INPUT[] { MakeVkInput(modVks[m], true) });
                        }
                        if (restoreCursor && hadSaved)
                        {
                            Thread.Sleep(15);
                            NativeMethods.SetCursorPos(savedPt.X, savedPt.Y);
                        }
                    }

                    Console.Out.WriteLine("{\"ok\":true,\"x\":" + JsonOut.Num(x) + ",\"y\":" + JsonOut.Num(y) + "}");
                    return 0;
                }

                case "pointer-op":
                {
                    string op = GetArg(args, "--op");
                    if (string.IsNullOrEmpty(op))
                    {
                        JsonOut.Fail("Missing --op", "invalid_argument");
                    }
                    string button = GetArg(args, "--button") ?? "left";
                    if (button != "left" && button != "right" && button != "middle")
                    {
                        JsonOut.Fail("Invalid button: " + button, "invalid_argument");
                    }

                    uint downFlag = NativeMethods.MOUSEEVENTF_LEFTDOWN;
                    uint upFlag = NativeMethods.MOUSEEVENTF_LEFTUP;
                    if (button == "right")
                    {
                        downFlag = NativeMethods.MOUSEEVENTF_RIGHTDOWN;
                        upFlag = NativeMethods.MOUSEEVENTF_RIGHTUP;
                    }
                    else if (button == "middle")
                    {
                        downFlag = NativeMethods.MOUSEEVENTF_MIDDLEDOWN;
                        upFlag = NativeMethods.MOUSEEVENTF_MIDDLEUP;
                    }

                    if (op == "move")
                    {
                        int x = (int)Math.Round(ParseCoord(GetArg(args, "--x"), "--x"));
                        int y = (int)Math.Round(ParseCoord(GetArg(args, "--y"), "--y"));
                        if (!dryRun)
                        {
                            int nx, ny;
                            NormalizeVirtualCoords(x, y, out nx, out ny);
                            NativeMethods.SetCursorPos(x, y);
                            DispatchInputs(new NativeMethods.INPUT[]
                            {
                                MakeMouseInput(nx, ny, NativeMethods.MOUSEEVENTF_MOVE | NativeMethods.MOUSEEVENTF_ABSOLUTE | NativeMethods.MOUSEEVENTF_VIRTUALDESK, 0)
                            });
                        }
                    }
                    else if (op == "down")
                    {
                        if (!dryRun) DispatchInputs(new NativeMethods.INPUT[] { MakeMouseInput(0, 0, downFlag, 0) });
                    }
                    else if (op == "up")
                    {
                        if (!dryRun) DispatchInputs(new NativeMethods.INPUT[] { MakeMouseInput(0, 0, upFlag, 0) });
                    }
                    else if (op == "drag")
                    {
                        int tx = (int)Math.Round(ParseCoord(GetArg(args, "--to-x"), "--to-x"));
                        int ty = (int)Math.Round(ParseCoord(GetArg(args, "--to-y"), "--to-y"));
                        bool hasFrom = (GetArg(args, "--from-x") != null || GetArg(args, "--from-y") != null);
                        int fx = 0, fy = 0;
                        if (hasFrom)
                        {
                            fx = (int)Math.Round(ParseCoord(GetArg(args, "--from-x"), "--from-x"));
                            fy = (int)Math.Round(ParseCoord(GetArg(args, "--from-y"), "--from-y"));
                        }
                        if (!dryRun)
                        {
                            if (hasFrom)
                            {
                                NativeMethods.SetCursorPos(fx, fy);
                                Thread.Sleep(15);
                            }
                            DispatchInputs(new NativeMethods.INPUT[] { MakeMouseInput(0, 0, downFlag, 0) });
                            Thread.Sleep(20);
                            int ntx, nty;
                            NormalizeVirtualCoords(tx, ty, out ntx, out nty);
                            NativeMethods.SetCursorPos(tx, ty);
                            DispatchInputs(new NativeMethods.INPUT[]
                            {
                                MakeMouseInput(ntx, nty, NativeMethods.MOUSEEVENTF_MOVE | NativeMethods.MOUSEEVENTF_ABSOLUTE | NativeMethods.MOUSEEVENTF_VIRTUALDESK, 0)
                            });
                            Thread.Sleep(20);
                            DispatchInputs(new NativeMethods.INPUT[] { MakeMouseInput(0, 0, upFlag, 0) });
                        }
                    }
                    else if (op == "scroll")
                    {
                        int dy = (int)Math.Round(ParseCoord(GetArg(args, "--delta-y") ?? "0", "--delta-y"));
                        int dx = (int)Math.Round(ParseCoord(GetArg(args, "--delta-x") ?? "0", "--delta-x"));
                        if (!dryRun)
                        {
                            if (dy != 0)
                            {
                                // In Zov protocol, positive deltaY scrolls down; Win32 WHEEL_DELTA positive scrolls up
                                int wheelY = -dy;
                                if (Math.Abs(wheelY) < 120) wheelY = wheelY > 0 ? 120 : -120;
                                DispatchInputs(new NativeMethods.INPUT[] { MakeMouseInput(0, 0, NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)wheelY)) });
                            }
                            if (dx != 0)
                            {
                                int wheelX = dx;
                                if (Math.Abs(wheelX) < 120) wheelX = wheelX > 0 ? 120 : -120;
                                DispatchInputs(new NativeMethods.INPUT[] { MakeMouseInput(0, 0, NativeMethods.MOUSEEVENTF_HWHEEL, unchecked((uint)wheelX)) });
                            }
                        }
                    }
                    else
                    {
                        JsonOut.Fail("Unknown pointer op: " + op, "invalid_argument");
                    }

                    Console.Out.WriteLine("{\"ok\":true}");
                    return 0;
                }

                case "type-unicode":
                {
                    string text = GetArg(args, "--text");
                    if (text == null)
                    {
                        JsonOut.Fail("Missing --text", "invalid_argument");
                    }
                    if (dryRun)
                    {
                        Console.Out.WriteLine("{\"ok\":true,\"dry_run\":true,\"length\":" + JsonOut.Num(text.Length) + "}");
                        return 0;
                    }
                    for (int i = 0; i < text.Length; i++)
                    {
                        ushort unit = (ushort)text[i];
                        DispatchInputs(new NativeMethods.INPUT[]
                        {
                            MakeUnicodeInput(unit, false),
                            MakeUnicodeInput(unit, true)
                        });
                        if (i % 16 == 15) Thread.Sleep(2);
                    }
                    Console.Out.WriteLine("{\"ok\":true,\"length\":" + JsonOut.Num(text.Length) + "}");
                    return 0;
                }

                case "key":
                {
                    string rawKey = GetArg(args, "--key");
                    List<string> modNames;
                    List<ushort> modVks = ParseModifiers(GetArg(args, "--modifiers"), out modNames);
                    int repeat = 1;
                    string repArg = GetArg(args, "--repeat");
                    if (!string.IsNullOrEmpty(repArg))
                    {
                        repeat = ParsePositiveInt(repArg, "--repeat");
                        if (repeat > 100) JsonOut.Fail("repeat must be <= 100", "invalid_argument");
                    }

                    ushort mainVk;
                    string resolvedKey;
                    ResolveKeyAndChord(rawKey, modVks, modNames, out mainVk, out resolvedKey);

                    if (dryRun)
                    {
                        Console.Out.WriteLine("{\"ok\":true,\"dry_run\":true,\"key\":" + JsonOut.Escape(resolvedKey) + ",\"modifiers\":" + JsonOut.StrArray(modNames) + ",\"repeat\":" + JsonOut.Num(repeat) + "}");
                        return 0;
                    }

                    for (int r = 0; r < repeat; r++)
                    {
                        List<NativeMethods.INPUT> seq = new List<NativeMethods.INPUT>();
                        for (int m = 0; m < modVks.Count; m++) seq.Add(MakeVkInput(modVks[m], false));
                        seq.Add(MakeVkInput(mainVk, false));
                        seq.Add(MakeVkInput(mainVk, true));
                        for (int m = modVks.Count - 1; m >= 0; m--) seq.Add(MakeVkInput(modVks[m], true));
                        DispatchInputs(seq.ToArray());
                        if (r + 1 < repeat) Thread.Sleep(15);
                    }

                    Console.Out.WriteLine("{\"ok\":true,\"key\":" + JsonOut.Escape(resolvedKey) + ",\"modifiers\":" + JsonOut.StrArray(modNames) + ",\"repeat\":" + JsonOut.Num(repeat) + "}");
                    return 0;
                }

                case "clipboard":
                {
                    string op = GetArg(args, "--op");
                    if (op == "read")
                    {
                        string txt = "";
                        try
                        {
                            if (Clipboard.ContainsText())
                            {
                                txt = Clipboard.GetText() ?? "";
                            }
                        }
                        catch (Exception ex)
                        {
                            JsonOut.Fail("Clipboard read failed: " + ex.Message, "operation_failed");
                        }
                        Console.Out.WriteLine("{\"text\":" + JsonOut.Escape(txt) + "}");
                        return 0;
                    }
                    else if (op == "write")
                    {
                        string txt = GetArg(args, "--text");
                        if (txt == null) JsonOut.Fail("Missing --text for clipboard write", "invalid_argument");
                        if (!dryRun)
                        {
                            try
                            {
                                if (txt.Length == 0) Clipboard.Clear();
                                else Clipboard.SetText(txt);
                            }
                            catch (Exception ex)
                            {
                                JsonOut.Fail("Clipboard write failed: " + ex.Message, "operation_failed");
                            }
                        }
                        Console.Out.WriteLine("{\"ok\":true,\"length\":" + JsonOut.Num(txt.Length) + "}");
                        return 0;
                    }
                    JsonOut.Fail("Unknown clipboard op: " + (op ?? ""), "invalid_argument");
                    return 1;
                }

                default:
                    JsonOut.Fail("Unknown subcommand: " + subcmd, "invalid_argument");
                    return 1;
            }
        }
    }
}
