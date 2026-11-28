using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

[assembly: AssemblyTitle("Prism Win32 CUA Helper & Native Messaging Bridge")]
[assembly: AssemblyDescription("Anti-Claude Prism Suite v0.9.5 Controlled Desktop & Browser CUA Helper")]
[assembly: AssemblyProduct("Anti-Claude Prism Suite")]
[assembly: AssemblyVersion("0.9.5.0")]
[assembly: AssemblyFileVersion("0.9.5.0")]

namespace AntiClaudePrismWinCua
{
    internal static class NativeMethods
    {
        public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
        public static readonly IntPtr HWND_MESSAGE = new IntPtr(-3);

        public const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        public const int JobObjectExtendedLimitInformation = 9;

        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x00001000;
        public const uint SYNCHRONIZE = 0x00100000;
        public const uint INFINITE = 0xFFFFFFFF;
        public const uint TOKEN_QUERY = 0x0008;
        public const int TokenIntegrityLevel = 25;
        public const int SECURITY_MANDATORY_HIGH_RID = 0x00003000;

        public const uint WM_NULL = 0x0000;
        public const uint WM_SETTEXT = 0x000C;
        public const int WM_MOUSEACTIVATE = 0x0021;
        public const uint WM_KEYDOWN = 0x0100;
        public const uint WM_KEYUP = 0x0101;
        public const uint WM_CHAR = 0x0102;
        public const uint WM_MOUSEMOVE = 0x0200;
        public const uint WM_LBUTTONDOWN = 0x0201;
        public const uint WM_LBUTTONUP = 0x0202;
        public const uint WM_LBUTTONDBLCLK = 0x0203;
        public const uint WM_RBUTTONDOWN = 0x0204;
        public const uint WM_RBUTTONUP = 0x0205;
        public const uint WM_MOUSEWHEEL = 0x020A;
        public const uint WM_MOUSEHWHEEL = 0x020E;
        public const int WM_HOTKEY = 0x0312;
        public const int MA_NOACTIVATE = 3;

        public const int MK_LBUTTON = 0x0001;
        public const int MK_RBUTTON = 0x0002;

        public const uint SMTO_BLOCK = 0x0001;
        public const uint SMTO_ABORTIFHUNG = 0x0002;

        public const uint PW_RENDERFULLCONTENT = 0x00000002;
        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        public const int DWMWA_CLOAKED = 14;

        public const int SW_SHOWNOACTIVATE = 4;
        public const int SW_RESTORE = 9;
        public const uint GA_ROOT = 2;
        public const uint GA_ROOTOWNER = 3;
        public const uint GW_OWNER = 4;

        [DllImport("user32.dll")]
        public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
        public const uint CWP_SKIPINVISIBLE = 0x0001;
        public const uint CWP_SKIPDISABLED = 0x0002;

        public const uint ULW_ALPHA = 0x00000002;
        public const byte AC_SRC_OVER = 0x00;
        public const byte AC_SRC_ALPHA = 0x01;

        public const uint MOD_ALT = 0x0001;
        public const uint MOD_CONTROL = 0x0002;
        public const uint MOD_SHIFT = 0x0004;
        public const uint MOD_WIN = 0x0008;
        public const uint MOD_NOREPEAT = 0x4000;

        public const int HOTKEY_ID_ESC = 1;

        public const ushort VK_BACK = 0x08;
        public const ushort VK_TAB = 0x09;
        public const ushort VK_RETURN = 0x0D;
        public const ushort VK_SHIFT = 0x10;
        public const ushort VK_CONTROL = 0x11;
        public const ushort VK_MENU = 0x12;
        public const ushort VK_PAUSE = 0x13;
        public const ushort VK_CAPITAL = 0x14;
        public const ushort VK_ESCAPE = 0x1B;
        public const ushort VK_SPACE = 0x20;
        public const ushort VK_PRIOR = 0x21;
        public const ushort VK_NEXT = 0x22;
        public const ushort VK_END = 0x23;
        public const ushort VK_HOME = 0x24;
        public const ushort VK_LEFT = 0x25;
        public const ushort VK_UP = 0x26;
        public const ushort VK_RIGHT = 0x27;
        public const ushort VK_DOWN = 0x28;
        public const ushort VK_INSERT = 0x2D;
        public const ushort VK_DELETE = 0x2E;
        public const ushort VK_LWIN = 0x5B;
        public const ushort VK_RWIN = 0x5C;
        public const ushort VK_F1 = 0x70;
        public const ushort VK_F4 = 0x73;
        public const ushort VK_F12 = 0x7B;
        public const ushort VK_LSHIFT = 0xA0;
        public const ushort VK_RSHIFT = 0xA1;
        public const ushort VK_LCONTROL = 0xA2;
        public const ushort VK_RCONTROL = 0xA3;
        public const ushort VK_LMENU = 0xA4;
        public const ushort VK_RMENU = 0xA5;

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

        public const int SM_XVIRTUALSCREEN = 76;
        public const int SM_YVIRTUALSCREEN = 77;
        public const int SM_CXVIRTUALSCREEN = 78;
        public const int SM_CYVIRTUALSCREEN = 79;

        public const int WS_EX_TOPMOST = 0x00000008;
        public const int WS_EX_TRANSPARENT = 0x00000020;
        public const int WS_EX_TOOLWINDOW = 0x00000080;
        public const int WS_EX_LAYERED = 0x00080000;
        public const int WS_EX_NOACTIVATE = 0x08000000;

        public const uint PM_REMOVE = 0x0001;

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

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
        public struct SIZE
        {
            public int cx;
            public int cy;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct GUITHREADINFO
        {
            public uint cbSize;
            public uint flags;
            public IntPtr hwndActive;
            public IntPtr hwndFocus;
            public IntPtr hwndCapture;
            public IntPtr hwndMenuOwner;
            public IntPtr hwndMoveSize;
            public IntPtr hwndCaret;
            public RECT rcCaret;
        }

        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        public struct BLENDFUNCTION
        {
            public byte BlendOp;
            public byte BlendFlags;
            public byte SourceConstantAlpha;
            public byte AlphaFormat;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSG
        {
            public IntPtr hwnd;
            public uint message;
            public IntPtr wParam;
            public IntPtr lParam;
            public uint time;
            public POINT pt;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SID_AND_ATTRIBUTES
        {
            public IntPtr Sid;
            public uint Attributes;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct TOKEN_MANDATORY_LABEL
        {
            public SID_AND_ATTRIBUTES Label;
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
            public InputUnion u;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDPIAware();

        public const int GWL_STYLE = -16;
        public const int ES_PASSWORD = 0x0020;

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int GetWindowLongW(IntPtr hWnd, int nIndex);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref int lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool GetTokenInformation(IntPtr TokenHandle, int TokenInformationClass, IntPtr TokenInformation, uint TokenInformationLength, out uint ReturnLength);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern IntPtr GetSidSubAuthorityCount(IntPtr pSid);

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern IntPtr GetSidSubAuthority(IntPtr pSid, uint nSubAuthority);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsHungAppWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeoutW(
            IntPtr hWnd,
            uint Msg,
            IntPtr wParam,
            IntPtr lParam,
            uint fuFlags,
            uint uTimeout,
            out IntPtr lpdwResult);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr WindowFromPoint(POINT Point);

        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern bool PeekMessageW(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax, uint wRemoveMsg);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);

        [DllImport("kernel32.dll")]
        public static extern uint GetTickCount();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr ChildWindowFromPointEx(IntPtr hwndParent, POINT pt, uint uFlags);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr RealChildWindowFromPoint(IntPtr hwndParent, POINT ptParentClientCoords);

        [DllImport("user32.dll")]
        public static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool PostMessageW(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeoutStringW(
            IntPtr hWnd,
            uint Msg,
            IntPtr wParam,
            string lParam,
            uint fuFlags,
            uint uTimeout,
            out IntPtr lpdwResult);

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll", ExactSpelling = true)]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern IntPtr CreateCompatibleDC(IntPtr hDC);

        [DllImport("gdi32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", ExactSpelling = true)]
        public static extern IntPtr SelectObject(IntPtr hDC, IntPtr hObject);

        [DllImport("user32.dll", ExactSpelling = true, SetLastError = true)]
        public static extern bool UpdateLayeredWindow(
            IntPtr hwnd,
            IntPtr hdcDst,
            ref POINT pptDst,
            ref SIZE psize,
            IntPtr hdcSrc,
            ref POINT pptSrc,
            uint crKey,
            ref BLENDFUNCTION pblend,
            uint dwFlags);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateRoundRectRgn(int nLeftRect, int nTopRect, int nRightRect, int nBottomRect, int nWidthEllipse, int nHeightEllipse);

        [DllImport("gdi32.dll")]
        public static extern bool DeleteObject(IntPtr hObject);
    }

    internal static class JsonUtil
    {
        public static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer ser = new JavaScriptSerializer();
            ser.MaxJsonLength = 32 * 1024 * 1024;
            ser.RecursionLimit = 64;
            return ser;
        }

        public static string Serialize(object obj)
        {
            return CreateSerializer().Serialize(obj);
        }

        public static Dictionary<string, object> DeserializeDict(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            string trimmed = raw.Trim();
            if (trimmed.Length == 0) return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            try
            {
                object parsed = CreateSerializer().DeserializeObject(trimmed);
                Dictionary<string, object> dict = parsed as Dictionary<string, object>;
                if (dict != null)
                {
                    return new Dictionary<string, object>(dict, StringComparer.OrdinalIgnoreCase);
                }
            }
            catch
            {
            }
            return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }

        public static string GetString(Dictionary<string, object> d, string key, string fallback)
        {
            if (d == null) return fallback;
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return fallback;
            return Convert.ToString(v);
        }

        public static bool GetBool(Dictionary<string, object> d, string key, bool fallback)
        {
            if (d == null) return fallback;
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return fallback;
            if (v is bool) return (bool)v;
            string s = Convert.ToString(v).Trim();
            if (string.Equals(s, "true", StringComparison.OrdinalIgnoreCase) || s == "1") return true;
            if (string.Equals(s, "false", StringComparison.OrdinalIgnoreCase) || s == "0") return false;
            return fallback;
        }

        public static int GetInt(Dictionary<string, object> d, string key, int fallback)
        {
            if (d == null) return fallback;
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return fallback;
            if (v is int) return (int)v;
            if (v is long) return (int)(long)v;
            if (v is double) return (int)Math.Round((double)v);
            if (v is decimal) return (int)Math.Round((decimal)v);
            int parsed;
            if (int.TryParse(Convert.ToString(v).Trim(), out parsed)) return parsed;
            double dParsed;
            if (double.TryParse(Convert.ToString(v).Trim(), out dParsed)) return (int)Math.Round(dParsed);
            return fallback;
        }

        public static bool HasKey(Dictionary<string, object> d, string key)
        {
            if (d == null) return false;
            object v;
            return d.TryGetValue(key, out v) && v != null;
        }

        public static Dictionary<string, object> GetSubDict(Dictionary<string, object> d, string key)
        {
            if (d == null) return null;
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return null;
            Dictionary<string, object> sub = v as Dictionary<string, object>;
            if (sub != null)
            {
                return new Dictionary<string, object>(sub, StringComparer.OrdinalIgnoreCase);
            }
            return null;
        }
    }

    internal sealed class WindowInfo
    {
        public IntPtr Hwnd;
        public string HwndHex;
        public string Title;
        public string ProcessName;
        public string ClassName;
        public uint Pid;
        public bool IsElectron;
        public bool IsElevated;
        public NativeMethods.RECT Rect;

        public Dictionary<string, object> ToDictionary()
        {
            Dictionary<string, object> bounds = new Dictionary<string, object>();
            bounds["x"] = Rect.Left;
            bounds["y"] = Rect.Top;
            bounds["width"] = Math.Max(0, Rect.Right - Rect.Left);
            bounds["height"] = Math.Max(0, Rect.Bottom - Rect.Top);

            Dictionary<string, object> obj = new Dictionary<string, object>();
            obj["hwnd"] = HwndHex;
            obj["title"] = Title ?? string.Empty;
            obj["processName"] = ProcessName ?? string.Empty;
            obj["className"] = ClassName ?? string.Empty;
            obj["pid"] = (int)Pid;
            obj["isElectron"] = IsElectron;
            obj["isElevated"] = IsElevated;
            obj["bounds"] = bounds;
            return obj;
        }
    }

    internal static class WindowSecurity
    {
        private static readonly string[] BlockedExactProcessNames = new string[]
        {
            "credentialuibroker",
            "consent",
            "lsass",
            "csrss",
            "winlogon",
            "logonui"
        };

        private static readonly string[] BlockedProcessSubstrings = new string[]
        {
            "keepass",
            "1password",
            "bitwarden",
            "lastpass",
            "dashlane",
            "enpass",
            "roboform"
        };

        private static readonly string[] BlockedTitleSubstrings = new string[]
        {
            ".codex",
            ".claude",
            ".cc-switch",
            ".ssh",
            ".gnupg"
        };

        public static string FormatHwnd(IntPtr hwnd)
        {
            return "0x" + hwnd.ToInt64().ToString("X");
        }

        public static IntPtr ParseHwnd(object raw)
        {
            if (raw == null) return IntPtr.Zero;
            if (raw is int) return new IntPtr((int)raw);
            if (raw is long) return new IntPtr((long)raw);
            string s = Convert.ToString(raw).Trim();
            if (s.Length == 0) return IntPtr.Zero;
            long val;
            if (s.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            {
                if (long.TryParse(s.Substring(2), System.Globalization.NumberStyles.HexNumber, System.Globalization.CultureInfo.InvariantCulture, out val))
                {
                    return new IntPtr(val);
                }
            }
            if (long.TryParse(s, System.Globalization.NumberStyles.Integer, System.Globalization.CultureInfo.InvariantCulture, out val))
            {
                return new IntPtr(val);
            }
            return IntPtr.Zero;
        }

        public static string SafeGetClassName(IntPtr hwnd)
        {
            StringBuilder sb = new StringBuilder(256);
            int len = NativeMethods.GetClassNameW(hwnd, sb, sb.Capacity);
            if (len <= 0) return string.Empty;
            return sb.ToString(0, len);
        }

        public static string SafeGetWindowTitle(IntPtr hwnd)
        {
            StringBuilder sb = new StringBuilder(1024);
            int len = NativeMethods.GetWindowTextW(hwnd, sb, sb.Capacity);
            if (len <= 0) return string.Empty;
            return sb.ToString(0, len);
        }

        public static string SafeGetWindowText(IntPtr hwnd, int maxChars)
        {
            if (hwnd == IntPtr.Zero) return string.Empty;
            int cap = Math.Max(16, Math.Min(4096, maxChars));
            StringBuilder sb = new StringBuilder(cap);
            int wLen = NativeMethods.GetWindowTextW(hwnd, sb, sb.Capacity);
            return wLen > 0 ? sb.ToString(0, wLen) : string.Empty;
        }

        public static string SafeGetProcessName(uint pid)
        {
            if (pid == 0) return string.Empty;
            IntPtr hProc = NativeMethods.OpenProcess(NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProc != IntPtr.Zero)
            {
                try
                {
                    StringBuilder sb = new StringBuilder(1024);
                    int size = sb.Capacity;
                    if (NativeMethods.QueryFullProcessImageNameW(hProc, 0, sb, ref size) && size > 0)
                    {
                        string fullPath = sb.ToString(0, size);
                        return Path.GetFileName(fullPath) ?? string.Empty;
                    }
                }
                finally
                {
                    NativeMethods.CloseHandle(hProc);
                }
            }
            try
            {
                using (Process p = Process.GetProcessById((int)pid))
                {
                    return p.ProcessName + ".exe";
                }
            }
            catch
            {
                return string.Empty;
            }
        }

        public static bool IsProcessHighIntegrity(uint pid)
        {
            if (pid == 0) return true;
            IntPtr hProc = NativeMethods.OpenProcess(NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (hProc == IntPtr.Zero)
            {
                return true;
            }
            try
            {
                int rid;
                if (!TryReadProcessIntegrityRid(hProc, out rid))
                {
                    return true;
                }
                return rid >= NativeMethods.SECURITY_MANDATORY_HIGH_RID;
            }
            finally
            {
                NativeMethods.CloseHandle(hProc);
            }
        }

        public static bool IsCurrentProcessHighIntegrity()
        {
            int rid;
            if (!TryReadProcessIntegrityRid(Process.GetCurrentProcess().Handle, out rid))
            {
                return false;
            }
            return rid >= NativeMethods.SECURITY_MANDATORY_HIGH_RID;
        }

        private static bool TryReadProcessIntegrityRid(IntPtr hProcess, out int rid)
        {
            rid = 0;
            IntPtr hToken;
            if (!NativeMethods.OpenProcessToken(hProcess, NativeMethods.TOKEN_QUERY, out hToken) || hToken == IntPtr.Zero)
            {
                return false;
            }
            try
            {
                uint needed = 0;
                NativeMethods.GetTokenInformation(hToken, NativeMethods.TokenIntegrityLevel, IntPtr.Zero, 0, out needed);
                if (needed == 0) return false;
                IntPtr buffer = Marshal.AllocHGlobal((int)needed);
                try
                {
                    uint retLen;
                    if (!NativeMethods.GetTokenInformation(hToken, NativeMethods.TokenIntegrityLevel, buffer, needed, out retLen))
                    {
                        return false;
                    }
                    NativeMethods.TOKEN_MANDATORY_LABEL label = (NativeMethods.TOKEN_MANDATORY_LABEL)Marshal.PtrToStructure(
                        buffer,
                        typeof(NativeMethods.TOKEN_MANDATORY_LABEL));
                    if (label.Label.Sid == IntPtr.Zero) return false;
                    IntPtr pCount = NativeMethods.GetSidSubAuthorityCount(label.Label.Sid);
                    if (pCount == IntPtr.Zero) return false;
                    byte count = Marshal.ReadByte(pCount);
                    if (count == 0) return false;
                    IntPtr pRid = NativeMethods.GetSidSubAuthority(label.Label.Sid, (uint)(count - 1));
                    if (pRid == IntPtr.Zero) return false;
                    rid = Marshal.ReadInt32(pRid);
                    return true;
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
            finally
            {
                NativeMethods.CloseHandle(hToken);
            }
        }

        public static NativeMethods.RECT GetAccurateWindowRect(IntPtr hwnd)
        {
            NativeMethods.RECT rect;
            if (NativeMethods.DwmGetWindowAttribute(hwnd, NativeMethods.DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(NativeMethods.RECT))) == 0)
            {
                if (rect.Right > rect.Left && rect.Bottom > rect.Top)
                {
                    return rect;
                }
            }
            if (!NativeMethods.GetWindowRect(hwnd, out rect))
            {
                rect = new NativeMethods.RECT();
            }
            return rect;
        }

        public static bool IsWindowCloaked(IntPtr hwnd)
        {
            int cloaked = 0;
            if (NativeMethods.DwmGetWindowAttribute(hwnd, NativeMethods.DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0)
            {
                return cloaked != 0;
            }
            return false;
        }

        public static WindowInfo InspectWindow(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !NativeMethods.IsWindow(hwnd)) return null;
            uint pid;
            NativeMethods.GetWindowThreadProcessId(hwnd, out pid);
            string procName = SafeGetProcessName(pid);
            string className = SafeGetClassName(hwnd);
            string title = SafeGetWindowTitle(hwnd);
            NativeMethods.RECT rect = GetAccurateWindowRect(hwnd);
            bool isElectron = string.Equals(className, "Chrome_WidgetWin_1", StringComparison.OrdinalIgnoreCase);
            bool isElevated = IsProcessHighIntegrity(pid);

            WindowInfo info = new WindowInfo();
            info.Hwnd = hwnd;
            info.HwndHex = FormatHwnd(hwnd);
            info.Title = title;
            info.ProcessName = procName;
            info.ClassName = className;
            info.Pid = pid;
            info.IsElectron = isElectron;
            info.IsElevated = isElevated;
            info.Rect = rect;
            return info;
        }

        public static bool CheckWindowBlocked(WindowInfo info, out string blockCode, out string blockReason)
        {
            blockCode = null;
            blockReason = null;
            if (info == null)
            {
                blockCode = "WINDOW_NOT_FOUND";
                blockReason = "目标窗口不存在或已关闭";
                return true;
            }

            int currentPid = Process.GetCurrentProcess().Id;
            string bareProc = Path.GetFileNameWithoutExtension(info.ProcessName ?? string.Empty).ToLowerInvariant();
            string classLower = (info.ClassName ?? string.Empty).ToLowerInvariant();
            string titleLower = (info.Title ?? string.Empty).ToLowerInvariant();

            if ((int)info.Pid == currentPid
                || bareProc == "antigravity"
                || bareProc == "prism-win-cua"
                || bareProc == "prism-win-cua-check")
            {
                blockCode = "SELF_WINDOW_BLOCKED";
                blockReason = "已硬拦截对 Antigravity 自身或 CUA 宿主窗口的观察与控制";
                return true;
            }

            for (int i = 0; i < BlockedExactProcessNames.Length; i++)
            {
                if (bareProc == BlockedExactProcessNames[i])
                {
                    blockCode = "SENSITIVE_WINDOW_BLOCKED";
                    blockReason = "已硬拦截系统凭据或提权窗口 (" + info.ProcessName + ")";
                    return true;
                }
            }

            if (classLower == "credential dialog xaml host")
            {
                blockCode = "SENSITIVE_WINDOW_BLOCKED";
                blockReason = "已硬拦截 Windows 安全凭据对话框";
                return true;
            }

            for (int i = 0; i < BlockedProcessSubstrings.Length; i++)
            {
                if (bareProc.IndexOf(BlockedProcessSubstrings[i], StringComparison.Ordinal) >= 0)
                {
                    blockCode = "SENSITIVE_WINDOW_BLOCKED";
                    blockReason = "已硬拦截密码管理器窗口 (" + info.ProcessName + ")";
                    return true;
                }
            }

            for (int i = 0; i < BlockedTitleSubstrings.Length; i++)
            {
                if (titleLower.IndexOf(BlockedTitleSubstrings[i], StringComparison.Ordinal) >= 0)
                {
                    blockCode = "SENSITIVE_WINDOW_BLOCKED";
                    blockReason = "窗口标题包含受保护密钥或配置目录 (" + BlockedTitleSubstrings[i] + ")，已硬拦截";
                    return true;
                }
            }

            return false;
        }

        public static bool IsSystemOrSensitiveForClose(WindowInfo info)
        {
            if (info == null) return true;
            string bare = Path.GetFileNameWithoutExtension(info.ProcessName ?? string.Empty).ToLowerInvariant();
            string cls = (info.ClassName ?? string.Empty).ToLowerInvariant();
            if (bare == "explorer" || bare == "taskmgr" || bare == "dwm" || bare == "sihost" || bare == "shellhost")
            {
                return true;
            }
            if (cls == "progman" || cls == "shell_traywnd" || cls == "workerw")
            {
                return true;
            }
            return false;
        }

        public static List<WindowInfo> EnumerateSafeTopWindows()
        {
            List<WindowInfo> list = new List<WindowInfo>();
            NativeMethods.EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
            {
                if (!NativeMethods.IsWindowVisible(hWnd)) return true;
                if (IsWindowCloaked(hWnd)) return true;

                WindowInfo info = InspectWindow(hWnd);
                if (info == null) return true;
                int w = info.Rect.Right - info.Rect.Left;
                int h = info.Rect.Bottom - info.Rect.Top;
                if (!NativeMethods.IsIconic(hWnd) && (w < 40 || h < 30)) return true;
                if (string.IsNullOrEmpty(info.Title) || info.Title.Trim().Length == 0) return true;

                string cls = (info.ClassName ?? string.Empty).ToLowerInvariant();
                if (cls == "progman" || cls == "shell_traywnd" || cls == "workerw") return true;

                string blockCode;
                string blockReason;
                if (CheckWindowBlocked(info, out blockCode, out blockReason))
                {
                    return true;
                }
                list.Add(info);
                return true;
            }, IntPtr.Zero);
            return list;
        }
    }

    internal static class InputController
    {
        private static readonly ushort[] AllModifierVks = new ushort[]
        {
            NativeMethods.VK_LSHIFT,
            NativeMethods.VK_RSHIFT,
            NativeMethods.VK_LCONTROL,
            NativeMethods.VK_RCONTROL,
            NativeMethods.VK_LMENU,
            NativeMethods.VK_RMENU,
            NativeMethods.VK_LWIN,
            NativeMethods.VK_RWIN
        };

        public static void ReleaseAllModifiers()
        {
            NativeMethods.INPUT[] inputs = new NativeMethods.INPUT[AllModifierVks.Length];
            for (int i = 0; i < AllModifierVks.Length; i++)
            {
                ushort vk = AllModifierVks[i];
                uint flags = NativeMethods.KEYEVENTF_KEYUP;
                if (vk == NativeMethods.VK_RCONTROL || vk == NativeMethods.VK_RMENU || vk == NativeMethods.VK_LWIN || vk == NativeMethods.VK_RWIN)
                {
                    flags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;
                }
                inputs[i] = CreateKeyVkInput(vk, flags);
            }
            NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
        }

        public static NativeMethods.INPUT CreateKeyVkInput(ushort vk, uint flags)
        {
            NativeMethods.INPUT inp = new NativeMethods.INPUT();
            inp.type = NativeMethods.INPUT_KEYBOARD;
            inp.u.ki.wVk = vk;
            inp.u.ki.wScan = 0;
            inp.u.ki.dwFlags = flags;
            inp.u.ki.time = 0;
            inp.u.ki.dwExtraInfo = IntPtr.Zero;
            return inp;
        }

        public static NativeMethods.INPUT CreateKeyUnicodeInput(ushort utf16Unit, bool keyUp)
        {
            NativeMethods.INPUT inp = new NativeMethods.INPUT();
            inp.type = NativeMethods.INPUT_KEYBOARD;
            inp.u.ki.wVk = 0;
            inp.u.ki.wScan = utf16Unit;
            inp.u.ki.dwFlags = keyUp
                ? (NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP)
                : NativeMethods.KEYEVENTF_UNICODE;
            inp.u.ki.time = 0;
            inp.u.ki.dwExtraInfo = IntPtr.Zero;
            return inp;
        }

        public static void ComputeVirtualDesktopNormalizedCoords(int physX, int physY, out int dx, out int dy)
        {
            int L = NativeMethods.GetSystemMetrics(NativeMethods.SM_XVIRTUALSCREEN);
            int T = NativeMethods.GetSystemMetrics(NativeMethods.SM_YVIRTUALSCREEN);
            int W = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SM_CXVIRTUALSCREEN));
            int H = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SM_CYVIRTUALSCREEN));
            dx = (int)((((long)physX - L) * 65536L + W - 1) / W);
            dy = (int)((((long)physY - T) * 65536L + H - 1) / H);
        }

        public static NativeMethods.INPUT CreateMouseAbsMoveInput(int physX, int physY)
        {
            int dx;
            int dy;
            ComputeVirtualDesktopNormalizedCoords(physX, physY, out dx, out dy);
            NativeMethods.INPUT inp = new NativeMethods.INPUT();
            inp.type = NativeMethods.INPUT_MOUSE;
            inp.u.mi.dx = dx;
            inp.u.mi.dy = dy;
            inp.u.mi.mouseData = 0;
            inp.u.mi.dwFlags = NativeMethods.MOUSEEVENTF_MOVE | NativeMethods.MOUSEEVENTF_ABSOLUTE | NativeMethods.MOUSEEVENTF_VIRTUALDESK;
            inp.u.mi.time = 0;
            inp.u.mi.dwExtraInfo = IntPtr.Zero;
            return inp;
        }

        public static NativeMethods.INPUT CreateMouseButtonInput(uint flags, uint mouseData)
        {
            NativeMethods.INPUT inp = new NativeMethods.INPUT();
            inp.type = NativeMethods.INPUT_MOUSE;
            inp.u.mi.dx = 0;
            inp.u.mi.dy = 0;
            inp.u.mi.mouseData = mouseData;
            inp.u.mi.dwFlags = flags;
            inp.u.mi.time = 0;
            inp.u.mi.dwExtraInfo = IntPtr.Zero;
            return inp;
        }

        public static bool SendInputs(NativeMethods.INPUT[] inputs)
        {
            if (inputs == null || inputs.Length == 0) return true;
            uint sent = NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(NativeMethods.INPUT)));
            return sent == (uint)inputs.Length;
        }

        public static bool IsExtendedKey(ushort vk)
        {
            switch (vk)
            {
                case NativeMethods.VK_PRIOR:
                case NativeMethods.VK_NEXT:
                case NativeMethods.VK_END:
                case NativeMethods.VK_HOME:
                case NativeMethods.VK_LEFT:
                case NativeMethods.VK_UP:
                case NativeMethods.VK_RIGHT:
                case NativeMethods.VK_DOWN:
                case NativeMethods.VK_INSERT:
                case NativeMethods.VK_DELETE:
                case NativeMethods.VK_RCONTROL:
                case NativeMethods.VK_RMENU:
                case NativeMethods.VK_LWIN:
                case NativeMethods.VK_RWIN:
                    return true;
                default:
                    return false;
            }
        }
    }

    internal sealed class EscEmergencyGuard : NativeWindow, IDisposable
    {
        private readonly ThreadStart _onHotKeyCallback;
        private bool _hotkeyRegistered;
        private bool _escTriggered;
        private bool _disposed;

        public EscEmergencyGuard()
            : this(null)
        {
        }

        public EscEmergencyGuard(ThreadStart onHotKeyCallback)
        {
            _onHotKeyCallback = onHotKeyCallback;
            CreateParams cp = new CreateParams();
            cp.Caption = "PrismCuaEscGuard";
            cp.Parent = NativeMethods.HWND_MESSAGE;
            CreateHandle(cp);
            RegisterEscHotKey();
        }

        public void RegisterEscHotKey()
        {
            if (!_disposed && Handle != IntPtr.Zero && !_hotkeyRegistered)
            {
                _hotkeyRegistered = NativeMethods.RegisterHotKey(
                    Handle,
                    NativeMethods.HOTKEY_ID_ESC,
                    NativeMethods.MOD_NOREPEAT,
                    NativeMethods.VK_ESCAPE);
            }
        }

        public void TemporarilySuspendHotKey()
        {
            if (_hotkeyRegistered && Handle != IntPtr.Zero)
            {
                NativeMethods.UnregisterHotKey(Handle, NativeMethods.HOTKEY_ID_ESC);
                _hotkeyRegistered = false;
            }
        }

        public void DrainPendingMessages()
        {
            NativeMethods.MSG msg;
            while (NativeMethods.PeekMessageW(out msg, Handle, 0, 0, NativeMethods.PM_REMOVE))
            {
                if (msg.message == NativeMethods.WM_HOTKEY && msg.wParam.ToInt32() == NativeMethods.HOTKEY_ID_ESC)
                {
                    _escTriggered = true;
                }
            }
        }

        public void ClearSyntheticMessages()
        {
            _escTriggered = false;
            NativeMethods.MSG msg;
            while (NativeMethods.PeekMessageW(out msg, Handle, 0, 0, NativeMethods.PM_REMOVE))
            {
            }
        }

        public bool IsEscTriggered()
        {
            DrainPendingMessages();
            if (_escTriggered) return true;
            short asyncState = NativeMethods.GetAsyncKeyState(NativeMethods.VK_ESCAPE);
            if ((asyncState & 0x8000) != 0)
            {
                _escTriggered = true;
                return true;
            }
            return false;
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeMethods.WM_HOTKEY && m.WParam.ToInt32() == NativeMethods.HOTKEY_ID_ESC)
            {
                _escTriggered = true;
                if (_onHotKeyCallback != null)
                {
                    try
                    {
                        _onHotKeyCallback();
                    }
                    catch
                    {
                    }
                }
                return;
            }
            base.WndProc(ref m);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (_hotkeyRegistered && Handle != IntPtr.Zero)
            {
                NativeMethods.UnregisterHotKey(Handle, NativeMethods.HOTKEY_ID_ESC);
                _hotkeyRegistered = false;
            }
            if (Handle != IntPtr.Zero)
            {
                DestroyHandle();
            }
        }
    }

    internal static class DesktopWorker
    {
        private const int MaxUiaDepth = 6;
        private const int MaxUiaNodes = 220;

        public static bool IsWindowResponsive(IntPtr hwnd)
        {
            if (NativeMethods.IsHungAppWindow(hwnd)) return false;
            IntPtr result;
            IntPtr ok = NativeMethods.SendMessageTimeoutW(
                hwnd,
                NativeMethods.WM_NULL,
                IntPtr.Zero,
                IntPtr.Zero,
                NativeMethods.SMTO_ABORTIFHUNG | NativeMethods.SMTO_BLOCK,
                150,
                out result);
            return ok != IntPtr.Zero;
        }

        public static Dictionary<string, object> RunListWindows()
        {
            List<WindowInfo> wins = WindowSecurity.EnumerateSafeTopWindows();
            List<object> items = new List<object>(wins.Count);
            for (int i = 0; i < wins.Count; i++)
            {
                items.Add(wins[i].ToDictionary());
            }
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["windows"] = items;
            return res;
        }

        public static Dictionary<string, object> RunObserve(Dictionary<string, object> payload)
        {
            IntPtr hwnd = WindowSecurity.ParseHwnd(payload != null && payload.ContainsKey("hwnd") ? payload["hwnd"] : null);
            WindowInfo info = WindowSecurity.InspectWindow(hwnd);
            string blockCode;
            string blockReason;
            if (WindowSecurity.CheckWindowBlocked(info, out blockCode, out blockReason))
            {
                return ErrorResult(blockCode, blockReason);
            }

            bool includeScreenshot = JsonUtil.GetBool(payload, "includeScreenshot", true);
            bool includeElements = JsonUtil.GetBool(payload, "includeElements", true);
            bool gridOverlay = JsonUtil.GetBool(payload, "gridOverlay", false);
            int maxSide = JsonUtil.GetInt(payload, "maxSide", 1440);
            if (maxSide < 200) maxSide = 200;
            if (maxSide > 3840) maxSide = 3840;
            string format = JsonUtil.GetString(payload, "format", "jpeg").Trim().ToLowerInvariant();
            int quality = JsonUtil.GetInt(payload, "quality", 82);
            if (quality < 30) quality = 30;
            if (quality > 98) quality = 98;

            List<Dictionary<string, object>> elements = new List<Dictionary<string, object>>();
            string uiaNote = null;

            /* 0ms Typing Guard: NEVER invoke UIAutomation on Chrome_WidgetWin_1 (Electron/Chromium) */
            if (info.IsElectron)
            {
                uiaNote = "CHROME_WIDGETWIN_1_TYPING_GUARD";
            }
            else if (includeElements)
            {
                if (!IsWindowResponsive(hwnd))
                {
                    uiaNote = "WINDOW_HUNG";
                }
                else
                {
                    elements = CollectUiaElementsMta(hwnd, info.Rect, out uiaNote);
                }
            }

            string screenshotBase64 = string.Empty;
            string mimeType = format == "png" ? "image/png" : "image/jpeg";
            int outW = Math.Max(1, info.Rect.Right - info.Rect.Left);
            int outH = Math.Max(1, info.Rect.Bottom - info.Rect.Top);
            double scale = 1.0;

            if (includeScreenshot)
            {
                if (NativeMethods.IsIconic(hwnd))
                {
                    return ErrorResult("WINDOW_MINIMIZED", "目标窗口处于最小化状态，无法捕获画面");
                }
                string capErrCode;
                string capErrMsg;
                screenshotBase64 = CaptureWindowBase64(
                    hwnd,
                    info.Rect,
                    maxSide,
                    gridOverlay,
                    format == "png",
                    quality,
                    out outW,
                    out outH,
                    out scale,
                    out capErrCode,
                    out capErrMsg);
                if (!string.IsNullOrEmpty(capErrCode))
                {
                    return ErrorResult(capErrCode, capErrMsg);
                }
            }

            Dictionary<string, object> winDict = info.ToDictionary();
            winDict["scale"] = scale;
            if (!string.IsNullOrEmpty(uiaNote))
            {
                winDict["uiaNote"] = uiaNote;
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["window"] = winDict;
            res["elements"] = elements;
            res["screenshotBase64"] = screenshotBase64;
            res["mimeType"] = mimeType;
            res["width"] = outW;
            res["height"] = outH;
            return res;
        }

        private sealed class UiaMtaItem
        {
            public Dictionary<string, object> Dict;
            public AutomationElement LiveElement;
            public string RefId;
        }

        private static List<Dictionary<string, object>> CollectUiaElementsMta(IntPtr hwnd, NativeMethods.RECT winRect, out string note)
        {
            List<UiaMtaItem> items = WalkUiaTreeMta(hwnd, winRect, false, out note);
            List<Dictionary<string, object>> outList = new List<Dictionary<string, object>>(items.Count);
            for (int i = 0; i < items.Count; i++)
            {
                outList.Add(items[i].Dict);
            }
            return outList;
        }

        private static List<UiaMtaItem> WalkUiaTreeMta(IntPtr hwnd, NativeMethods.RECT winRect, bool keepLiveElements, out string note)
        {
            List<UiaMtaItem> collected = new List<UiaMtaItem>();
            string localNote = null;

            Thread mtaThread = new Thread((ThreadStart)delegate
            {
                try
                {
                    CacheRequest cr = new CacheRequest();
                    cr.Add(AutomationElement.NameProperty);
                    cr.Add(AutomationElement.ControlTypeProperty);
                    cr.Add(AutomationElement.BoundingRectangleProperty);
                    cr.Add(AutomationElement.IsEnabledProperty);
                    cr.Add(AutomationElement.IsPasswordProperty);
                    cr.Add(AutomationElement.AutomationIdProperty);
                    cr.TreeScope = TreeScope.Element;

                    AutomationElement root;
                    using (cr.Activate())
                    {
                        root = AutomationElement.FromHandle(hwnd);
                    }
                    if (root == null) return;

                    WalkUiaNodeRecursive(root, cr, 0, winRect, keepLiveElements, collected);
                }
                catch (Exception ex)
                {
                    localNote = "UIA_ERROR:" + ex.GetType().Name;
                }
            });
            mtaThread.IsBackground = true;
            mtaThread.SetApartmentState(ApartmentState.MTA);
            mtaThread.Start();
            if (!mtaThread.Join(2500))
            {
                note = "UIA_TIMEOUT";
                return new List<UiaMtaItem>();
            }
            note = localNote;
            return collected;
        }

        private static void WalkUiaNodeRecursive(
            AutomationElement node,
            CacheRequest cr,
            int depth,
            NativeMethods.RECT winRect,
            bool keepLive,
            List<UiaMtaItem> results)
        {
            if (node == null || depth > MaxUiaDepth || results.Count >= MaxUiaNodes)
            {
                return;
            }

            if (depth > 0)
            {
                TryRecordUiaNode(node, winRect, keepLive, results);
                if (results.Count >= MaxUiaNodes) return;
            }

            if (depth == MaxUiaDepth) return;

            AutomationElement child = null;
            try
            {
                child = TreeWalker.ControlViewWalker.GetFirstChild(node, cr);
            }
            catch
            {
                child = null;
            }

            while (child != null && results.Count < MaxUiaNodes)
            {
                WalkUiaNodeRecursive(child, cr, depth + 1, winRect, keepLive, results);
                if (results.Count >= MaxUiaNodes) break;
                try
                {
                    child = TreeWalker.ControlViewWalker.GetNextSibling(child, cr);
                }
                catch
                {
                    child = null;
                }
            }
        }

        private static void TryRecordUiaNode(
            AutomationElement node,
            NativeMethods.RECT winRect,
            bool keepLive,
            List<UiaMtaItem> results)
        {
            try
            {
                System.Windows.Rect r = node.Cached.BoundingRectangle;
                if (double.IsInfinity(r.Width) || double.IsInfinity(r.Height) || double.IsNaN(r.X) || double.IsNaN(r.Y))
                {
                    return;
                }
                int bx = (int)Math.Round(r.X);
                int by = (int)Math.Round(r.Y);
                int bw = (int)Math.Round(r.Width);
                int bh = (int)Math.Round(r.Height);
                if (bw <= 2 || bh <= 2) return;

                ControlType ct = node.Cached.ControlType;
                string role = ct != null ? ct.ProgrammaticName : "ControlType.Custom";
                if (role.StartsWith("ControlType.", StringComparison.Ordinal))
                {
                    role = role.Substring("ControlType.".Length);
                }
                string name = node.Cached.Name ?? string.Empty;
                string automationId = node.Cached.AutomationId ?? string.Empty;
                bool isEnabled = node.Cached.IsEnabled;
                bool isPassword = node.Cached.IsPassword;

                bool interactiveOrInformative = IsInterestingRole(role)
                    || name.Trim().Length > 0
                    || automationId.Trim().Length > 0
                    || isPassword;
                if (!interactiveOrInformative) return;

                string refId = "@w" + (results.Count + 1).ToString();
                Dictionary<string, object> bounds = new Dictionary<string, object>();
                bounds["x"] = bx;
                bounds["y"] = by;
                bounds["width"] = bw;
                bounds["height"] = bh;

                Dictionary<string, object> relBounds = new Dictionary<string, object>();
                relBounds["x"] = bx - winRect.Left;
                relBounds["y"] = by - winRect.Top;
                relBounds["width"] = bw;
                relBounds["height"] = bh;

                Dictionary<string, object> dict = new Dictionary<string, object>();
                dict["ref"] = refId;
                dict["role"] = role;
                dict["name"] = isPassword ? "[PASSWORD_REDACTED]" : TruncateText(name, 160);
                dict["automationId"] = TruncateText(automationId, 100);
                dict["enabled"] = isEnabled;
                dict["isPassword"] = isPassword;
                if (isPassword)
                {
                    dict["valueRedacted"] = "[PASSWORD_REDACTED]";
                }
                dict["bounds"] = bounds;
                dict["windowBounds"] = relBounds;

                UiaMtaItem item = new UiaMtaItem();
                item.RefId = refId;
                item.Dict = dict;
                item.LiveElement = keepLive ? node : null;
                results.Add(item);
            }
            catch
            {
            }
        }

        private static bool IsInterestingRole(string role)
        {
            switch (role)
            {
                case "Button":
                case "Edit":
                case "CheckBox":
                case "RadioButton":
                case "ComboBox":
                case "ListItem":
                case "MenuItem":
                case "TabItem":
                case "Hyperlink":
                case "TreeItem":
                case "Slider":
                case "Spinner":
                case "SplitButton":
                case "DataItem":
                case "Document":
                case "Text":
                    return true;
                default:
                    return false;
            }
        }

        private static string TruncateText(string s, int maxChars)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            if (s.Length <= maxChars) return s;
            return s.Substring(0, maxChars) + "...";
        }

        private static IntPtr GetRootOrSelf(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return IntPtr.Zero;
            IntPtr root = NativeMethods.GetAncestor(hwnd, NativeMethods.GA_ROOT);
            return root != IntPtr.Zero ? root : hwnd;
        }

        private static bool IsTargetWindowStillForeground(IntPtr hwnd, IntPtr targetRoot)
        {
            if (hwnd == IntPtr.Zero) return false;
            IntPtr expectedRoot = targetRoot != IntPtr.Zero ? targetRoot : GetRootOrSelf(hwnd);
            IntPtr actualFg = NativeMethods.GetForegroundWindow();
            if (actualFg == IntPtr.Zero) return false;
            if (actualFg == hwnd || actualFg == expectedRoot) return true;
            IntPtr actualRoot = NativeMethods.GetAncestor(actualFg, NativeMethods.GA_ROOT);
            if (actualRoot != IntPtr.Zero && actualRoot == expectedRoot) return true;
            IntPtr actualRootOwner = NativeMethods.GetAncestor(actualFg, NativeMethods.GA_ROOTOWNER);
            return actualRootOwner != IntPtr.Zero && actualRootOwner == expectedRoot;
        }

        private static bool IsRectOccludedByBlockedWindow(IntPtr targetHwnd, NativeMethods.RECT rect, out string blockedReason)
        {
            blockedReason = null;
            int w = Math.Max(1, rect.Right - rect.Left);
            int h = Math.Max(1, rect.Bottom - rect.Top);
            IntPtr targetRoot = GetRootOrSelf(targetHwnd);
            int[] xFracs = new int[] { 2, 1, 3, 1, 3, 2, 2, 1, 3 };
            int[] yFracs = new int[] { 2, 1, 1, 3, 3, 1, 3, 2, 2 };
            for (int i = 0; i < xFracs.Length; i++)
            {
                NativeMethods.POINT pt = new NativeMethods.POINT();
                pt.X = rect.Left + (w * xFracs[i]) / 4;
                pt.Y = rect.Top + (h * yFracs[i]) / 4;
                IntPtr hit = NativeMethods.WindowFromPoint(pt);
                if (hit == IntPtr.Zero) continue;
                IntPtr hitRoot = NativeMethods.GetAncestor(hit, NativeMethods.GA_ROOT);
                if (hitRoot == IntPtr.Zero) hitRoot = hit;
                if (hitRoot == targetHwnd || hitRoot == targetRoot) continue;

                WindowInfo hitInfo = WindowSecurity.InspectWindow(hitRoot);
                if (hitInfo == null) continue;
                if (string.Equals(hitInfo.Title, "PrismCuaOverlayPill", StringComparison.Ordinal)
                    || string.Equals(hitInfo.Title, "PrismCuaVirtualCursor", StringComparison.Ordinal))
                {
                    continue;
                }
                string bCode;
                string bReason;
                if (WindowSecurity.CheckWindowBlocked(hitInfo, out bCode, out bReason))
                {
                    blockedReason = bReason;
                    return true;
                }
            }
            return false;
        }

        private static string CaptureWindowBase64(
            IntPtr hwnd,
            NativeMethods.RECT rect,
            int maxSide,
            bool gridOverlay,
            bool usePng,
            int jpegQuality,
            out int outWidth,
            out int outHeight,
            out double outScale,
            out string errCode,
            out string errMsg)
        {
            errCode = null;
            errMsg = null;
            int srcW = Math.Max(1, rect.Right - rect.Left);
            int srcH = Math.Max(1, rect.Bottom - rect.Top);

            using (Bitmap rawBmp = new Bitmap(srcW, srcH, PixelFormat.Format32bppRgb))
            {
                bool printOk = false;
                using (Graphics g = Graphics.FromImage(rawBmp))
                {
                    IntPtr hdc = g.GetHdc();
                    try
                    {
                        printOk = NativeMethods.PrintWindow(hwnd, hdc, NativeMethods.PW_RENDERFULLCONTENT);
                    }
                    finally
                    {
                        g.ReleaseHdc(hdc);
                    }
                }

                if (!printOk || IsBitmapBlankBlack(rawBmp))
                {
                    string occludedReason;
                    if (IsRectOccludedByBlockedWindow(hwnd, rect, out occludedReason))
                    {
                        errCode = "SCREENSHOT_OCCLUDED";
                        errMsg = "目标窗口屏幕抓图区域被受保护窗口遮挡（" + (occludedReason ?? "敏感窗口") + "），已跳过 CopyFromScreen 防止敏感画面泄露";
                        outWidth = srcW;
                        outHeight = srcH;
                        outScale = 1.0;
                        return null;
                    }
                    using (Graphics gScreen = Graphics.FromImage(rawBmp))
                    {
                        gScreen.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(srcW, srcH), CopyPixelOperation.SourceCopy);
                    }
                }

                int maxDim = Math.Max(srcW, srcH);
                outScale = maxDim > maxSide ? ((double)maxSide / (double)maxDim) : 1.0;
                outWidth = Math.Max(1, (int)Math.Round(srcW * outScale));
                outHeight = Math.Max(1, (int)Math.Round(srcH * outScale));

                using (Bitmap finalBmp = new Bitmap(outWidth, outHeight, PixelFormat.Format24bppRgb))
                {
                    using (Graphics gf = Graphics.FromImage(finalBmp))
                    {
                        gf.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        gf.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        gf.SmoothingMode = SmoothingMode.AntiAlias;
                        gf.DrawImage(rawBmp, new Rectangle(0, 0, outWidth, outHeight), new Rectangle(0, 0, srcW, srcH), GraphicsUnit.Pixel);

                        if (gridOverlay)
                        {
                            DrawRulerGridOverlay(gf, outWidth, outHeight);
                        }
                    }

                    using (MemoryStream ms = new MemoryStream())
                    {
                        if (usePng)
                        {
                            finalBmp.Save(ms, ImageFormat.Png);
                        }
                        else
                        {
                            ImageCodecInfo jpegEncoder = FindImageEncoder(ImageFormat.Jpeg);
                            if (jpegEncoder != null)
                            {
                                using (EncoderParameters ep = new EncoderParameters(1))
                                {
                                    ep.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)jpegQuality);
                                    finalBmp.Save(ms, jpegEncoder, ep);
                                }
                            }
                            else
                            {
                                finalBmp.Save(ms, ImageFormat.Jpeg);
                            }
                        }
                        return Convert.ToBase64String(ms.ToArray());
                    }
                }
            }
        }

        private static bool IsBitmapBlankBlack(Bitmap bmp)
        {
            int w = bmp.Width;
            int h = bmp.Height;
            if (w <= 0 || h <= 0) return true;
            for (int gy = 1; gy <= 4; gy++)
            {
                int py = Math.Min(h - 1, (h * gy) / 5);
                for (int gx = 1; gx <= 4; gx++)
                {
                    int px = Math.Min(w - 1, (w * gx) / 5);
                    Color c = bmp.GetPixel(px, py);
                    if (c.R != 0 || c.G != 0 || c.B != 0)
                    {
                        return false;
                    }
                }
            }
            return true;
        }

        private static void DrawRulerGridOverlay(Graphics g, int width, int height)
        {
            using (Pen minorPen = new Pen(Color.FromArgb(85, 56, 189, 248), 1f))
            using (Brush badgeBg = new SolidBrush(Color.FromArgb(165, 15, 23, 42)))
            using (Brush badgeFg = new SolidBrush(Color.FromArgb(235, 224, 242, 254)))
            using (Font font = new Font("Consolas", 8f, FontStyle.Regular))
            {
                for (int x = 100; x < width; x += 100)
                {
                    g.DrawLine(minorPen, x, 0, x, height);
                    string lbl = x.ToString();
                    SizeF sz = g.MeasureString(lbl, font);
                    g.FillRectangle(badgeBg, x + 2, 2, sz.Width + 2, sz.Height);
                    g.DrawString(lbl, font, badgeFg, x + 3, 2);
                }
                for (int y = 100; y < height; y += 100)
                {
                    g.DrawLine(minorPen, 0, y, width, y);
                    string lbl = y.ToString();
                    SizeF sz = g.MeasureString(lbl, font);
                    g.FillRectangle(badgeBg, 2, y + 2, sz.Width + 2, sz.Height);
                    g.DrawString(lbl, font, badgeFg, 3, y + 2);
                }
            }
        }

        private static ImageCodecInfo FindImageEncoder(ImageFormat format)
        {
            ImageCodecInfo[] codecs = ImageCodecInfo.GetImageDecoders();
            for (int i = 0; i < codecs.Length; i++)
            {
                if (codecs[i].FormatID == format.Guid)
                {
                    return codecs[i];
                }
            }
            return null;
        }

        public static Dictionary<string, object> RunAct(Dictionary<string, object> payload)
        {
            IntPtr hwnd = WindowSecurity.ParseHwnd(payload != null && payload.ContainsKey("hwnd") ? payload["hwnd"] : null);
            WindowInfo info = WindowSecurity.InspectWindow(hwnd);
            string blockCode;
            string blockReason;
            if (WindowSecurity.CheckWindowBlocked(info, out blockCode, out blockReason))
            {
                return ErrorResult(blockCode, blockReason);
            }

            /* UIPI Integrity Protection Check */
            if (info.IsElevated && !WindowSecurity.IsCurrentProcessHighIntegrity())
            {
                return ErrorResult(
                    "ELEVATED_WINDOW_UIPI_BLOCKED",
                    "目标窗口为管理员权限，受 Windows UIPI 保护已拦截自动注入");
            }

            Dictionary<string, object> step = JsonUtil.GetSubDict(payload, "step");
            if (step == null)
            {
                step = payload ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            }

            string op = JsonUtil.GetString(step, "op", string.Empty);
            if (string.IsNullOrEmpty(op)) op = JsonUtil.GetString(step, "type", string.Empty);
            if (string.IsNullOrEmpty(op)) op = JsonUtil.GetString(step, "action", string.Empty);
            op = op.Trim().ToLowerInvariant();
            if (string.IsNullOrEmpty(op))
            {
                return ErrorResult("INVALID_STEP_OP", "缺少操作类型 op");
            }

            string rawMouseMode = JsonUtil.GetString(step, "mouseMode", string.Empty);
            if (string.IsNullOrEmpty(rawMouseMode))
            {
                rawMouseMode = JsonUtil.GetString(payload, "mouseMode", "courteous");
            }
            string mouseMode = NormalizeMouseMode(rawMouseMode);

            EscEmergencyGuard escGuard = new EscEmergencyGuard();
            try
            {
                if (escGuard.IsEscTriggered())
                {
                    return EscAbortedResult();
                }

                if (op != "wait_for" && NativeMethods.IsIconic(hwnd) && mouseMode != "strict_virtual")
                {
                    NativeMethods.ShowWindow(hwnd, NativeMethods.SW_SHOWNOACTIVATE);
                    Thread.Sleep(45);
                    info = WindowSecurity.InspectWindow(hwnd) ?? info;
                }

                if (escGuard.IsEscTriggered())
                {
                    return EscAbortedResult();
                }

                switch (op)
                {
                    case "click":
                    case "double_click":
                    case "right_click":
                        return ExecuteMouseClick(hwnd, info, step, op, mouseMode, escGuard);

                    case "type_text":
                        return ExecuteTypeText(hwnd, info, step, mouseMode, escGuard);

                    case "press_key":
                        return ExecutePressKey(hwnd, info, step, mouseMode, escGuard);

                    case "scroll":
                        return ExecuteScroll(hwnd, info, step, mouseMode, escGuard);

                    case "select_option":
                        return ExecuteSelectOption(hwnd, info, step, mouseMode, escGuard);

                    case "focus_ref":
                        return ExecuteFocusRef(hwnd, info, step, escGuard);

                    case "wait_for":
                        return ExecuteWaitFor(hwnd, info, step, escGuard);

                    default:
                        return ErrorResult("UNSUPPORTED_OP", "不支持的桌面动作类型: " + op);
                }
            }
            finally
            {
                InputController.ReleaseAllModifiers();
                escGuard.Dispose();
            }
        }

        private static string NormalizeMouseMode(string raw)
        {
            string s = (raw ?? string.Empty).Trim().ToLowerInvariant();
            if (s == "strict_virtual" || s == "virtual_only" || s == "background")
            {
                return "strict_virtual";
            }
            if (s == "physical" || s == "hardware")
            {
                return "physical";
            }
            return "courteous";
        }

        private static IntPtr MakeLParam(int loWord, int hiWord)
        {
            return new IntPtr(((hiWord & 0xFFFF) << 16) | (loWord & 0xFFFF));
        }

        private static IntPtr FindDeepestChildWindowAtScreenPoint(IntPtr rootHwnd, int screenX, int screenY)
        {
            if (rootHwnd == IntPtr.Zero) return IntPtr.Zero;
            IntPtr cur = rootHwnd;
            for (int depth = 0; depth < 16; depth++)
            {
                NativeMethods.POINT clientPt = new NativeMethods.POINT();
                clientPt.X = screenX;
                clientPt.Y = screenY;
                if (!NativeMethods.ScreenToClient(cur, ref clientPt))
                {
                    break;
                }

                IntPtr next = NativeMethods.RealChildWindowFromPoint(cur, clientPt);
                if (next == IntPtr.Zero || next == cur)
                {
                    next = NativeMethods.ChildWindowFromPointEx(
                        cur,
                        clientPt,
                        NativeMethods.CWP_SKIPINVISIBLE | NativeMethods.CWP_SKIPDISABLED);
                }
                if (next == IntPtr.Zero || next == cur)
                {
                    break;
                }
                if (!NativeMethods.IsChild(rootHwnd, next))
                {
                    break;
                }
                cur = next;
            }
            return cur;
        }

        private static bool WaitForUserInputIdle(
            int idleThresholdMs,
            int maxWaitMs,
            EscEmergencyGuard escGuard,
            out string errCode,
            out string errMsg)
        {
            errCode = null;
            errMsg = null;

            Stopwatch sw = Stopwatch.StartNew();
            NativeMethods.POINT lastPt;
            NativeMethods.GetCursorPos(out lastPt);

            while (sw.ElapsedMilliseconds < maxWaitMs)
            {
                if (escGuard != null && escGuard.IsEscTriggered())
                {
                    errCode = "USER_ESC_ABORTED";
                    errMsg = "用户按下 Esc 紧急中断";
                    return false;
                }

                bool mouseBtnDown = (NativeMethods.GetAsyncKeyState(0x01) & 0x8000) != 0
                    || (NativeMethods.GetAsyncKeyState(0x02) & 0x8000) != 0
                    || (NativeMethods.GetAsyncKeyState(0x04) & 0x8000) != 0;

                NativeMethods.LASTINPUTINFO lii = new NativeMethods.LASTINPUTINFO();
                lii.cbSize = (uint)Marshal.SizeOf(typeof(NativeMethods.LASTINPUTINFO));
                uint idleMs = 999999;
                if (NativeMethods.GetLastInputInfo(ref lii))
                {
                    idleMs = unchecked(NativeMethods.GetTickCount() - lii.dwTime);
                }

                NativeMethods.POINT curPt;
                NativeMethods.GetCursorPos(out curPt);
                bool cursorMoved = Math.Abs(curPt.X - lastPt.X) > 1 || Math.Abs(curPt.Y - lastPt.Y) > 1;
                lastPt = curPt;

                if (!mouseBtnDown && !cursorMoved && idleMs >= (uint)idleThresholdMs)
                {
                    return true;
                }

                Thread.Sleep(35);
            }

            if ((NativeMethods.GetAsyncKeyState(0x01) & 0x8000) != 0
                || (NativeMethods.GetAsyncKeyState(0x02) & 0x8000) != 0)
            {
                errCode = "USER_MOUSE_DRAGGING";
                errMsg = "检测到用户正在按住物理鼠标拖拽或点击，已礼让暂停借用系统光标";
                return false;
            }

            errCode = "USER_BUSY_YIELD";
            errMsg = "检测到用户正在持续操作键鼠，未满足空闲礼让窗口，已放弃占用系统光标与焦点";
            return false;
        }

        private static bool ActivateWindowForPhysicalInput(
            IntPtr hwnd,
            ref WindowInfo info,
            string mouseMode,
            EscEmergencyGuard escGuard,
            out string errCode,
            out string errMsg)
        {
            errCode = null;
            errMsg = null;

            if (mouseMode == "strict_virtual")
            {
                errCode = "PHYSICAL_CURSOR_REQUIRED";
                errMsg = "当前处于「严格后台虚拟鼠标」模式 (strict_virtual)，目标窗口 ("
                    + (info != null ? info.ClassName : "Unknown")
                    + ") 不支持后台无感投递，已拦截物理键鼠与焦点占用";
                return false;
            }

            if (mouseMode == "courteous")
            {
                if (!WaitForUserInputIdle(350, 2200, escGuard, out errCode, out errMsg))
                {
                    return false;
                }
            }

            if (NativeMethods.IsIconic(hwnd))
            {
                NativeMethods.ShowWindow(hwnd, NativeMethods.SW_RESTORE);
                Thread.Sleep(55);
            }
            NativeMethods.SetForegroundWindow(hwnd);
            Thread.Sleep(20);

            IntPtr actualFg = NativeMethods.GetForegroundWindow();
            IntPtr actualRoot = actualFg != IntPtr.Zero ? NativeMethods.GetAncestor(actualFg, NativeMethods.GA_ROOT) : IntPtr.Zero;
            IntPtr targetRoot = NativeMethods.GetAncestor(hwnd, NativeMethods.GA_ROOT);
            if (targetRoot == IntPtr.Zero) targetRoot = hwnd;
            if (actualFg == IntPtr.Zero || (actualFg != hwnd && actualRoot != targetRoot))
            {
                Thread.Sleep(35);
                actualFg = NativeMethods.GetForegroundWindow();
                actualRoot = actualFg != IntPtr.Zero ? NativeMethods.GetAncestor(actualFg, NativeMethods.GA_ROOT) : IntPtr.Zero;
            }
            if (actualFg == IntPtr.Zero || (actualFg != hwnd && actualRoot != targetRoot))
            {
                errCode = "FOREGROUND_ACQUIRE_FAILED";
                errMsg = "未能将目标窗口切换至前台焦点，已拒绝物理键鼠注入以防误输入到当前活动窗口";
                return false;
            }

            info = WindowSecurity.InspectWindow(hwnd) ?? info;
            return true;
        }

        private static bool ResolveStepPhysicalPoint(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            bool checkScreenOcclusion,
            out int physX,
            out int physY,
            out string errCode,
            out string errMsg)
        {
            physX = 0;
            physY = 0;
            errCode = null;
            errMsg = null;

            string refId = JsonUtil.GetString(step, "ref", string.Empty).Trim();
            if (!string.IsNullOrEmpty(refId) && !JsonUtil.HasKey(step, "x") && !JsonUtil.HasKey(step, "screenX"))
            {
                if (info.IsElectron)
                {
                    errCode = "ELECTRON_UIA_DISABLED";
                    errMsg = "Electron 窗口启用了 0ms 防卡顿守卫，请使用坐标或浏览器桥定位";
                    return false;
                }
                string note;
                List<UiaMtaItem> items = WalkUiaTreeMta(hwnd, info.Rect, false, out note);
                for (int i = 0; i < items.Count; i++)
                {
                    if (string.Equals(items[i].RefId, refId, StringComparison.OrdinalIgnoreCase))
                    {
                        Dictionary<string, object> b = items[i].Dict["bounds"] as Dictionary<string, object>;
                        if (b != null)
                        {
                            physX = Convert.ToInt32(b["x"]) + Convert.ToInt32(b["width"]) / 2;
                            physY = Convert.ToInt32(b["y"]) + Convert.ToInt32(b["height"]) / 2;
                            return ValidateTargetPointSafety(info, physX, physY, checkScreenOcclusion, out errCode, out errMsg);
                        }
                    }
                }
                errCode = "REF_NOT_FOUND";
                errMsg = "未找到指定的控件引用: " + refId;
                return false;
            }

            if (JsonUtil.HasKey(step, "screenX") && JsonUtil.HasKey(step, "screenY"))
            {
                physX = JsonUtil.GetInt(step, "screenX", 0);
                physY = JsonUtil.GetInt(step, "screenY", 0);
                return ValidateTargetPointSafety(info, physX, physY, checkScreenOcclusion, out errCode, out errMsg);
            }

            if (!JsonUtil.HasKey(step, "x") || !JsonUtil.HasKey(step, "y"))
            {
                errCode = "MISSING_COORDINATES";
                errMsg = "操作缺少坐标 (x, y) 或控件引用 ref";
                return false;
            }

            int rawX = JsonUtil.GetInt(step, "x", 0);
            int rawY = JsonUtil.GetInt(step, "y", 0);
            int winW = Math.Max(1, info.Rect.Right - info.Rect.Left);
            int winH = Math.Max(1, info.Rect.Bottom - info.Rect.Top);
            string coordSpace = JsonUtil.GetString(step, "coordSpace", string.Empty).Trim().ToLowerInvariant();
            int imageWidth = JsonUtil.GetInt(step, "imageWidth", 0);
            int imageHeight = JsonUtil.GetInt(step, "imageHeight", 0);

            if (coordSpace == "screen")
            {
                physX = rawX;
                physY = rawY;
            }
            else if (coordSpace == "image" || (imageWidth > 0 && imageHeight > 0))
            {
                int iw = Math.Max(1, imageWidth > 0 ? imageWidth : winW);
                int ih = Math.Max(1, imageHeight > 0 ? imageHeight : winH);
                physX = info.Rect.Left + (int)Math.Round((double)rawX * (double)winW / (double)iw);
                physY = info.Rect.Top + (int)Math.Round((double)rawY * (double)winH / (double)ih);
            }
            else if (coordSpace == "window" || JsonUtil.GetBool(step, "relative", false))
            {
                physX = info.Rect.Left + rawX;
                physY = info.Rect.Top + rawY;
            }
            else if (rawX >= 0 && rawX <= winW && rawY >= 0 && rawY <= winH
                && !(rawX >= info.Rect.Left && rawX <= info.Rect.Right && rawY >= info.Rect.Top && rawY <= info.Rect.Bottom))
            {
                physX = info.Rect.Left + rawX;
                physY = info.Rect.Top + rawY;
            }
            else
            {
                physX = rawX;
                physY = rawY;
            }

            return ValidateTargetPointSafety(info, physX, physY, checkScreenOcclusion, out errCode, out errMsg);
        }

        private static bool ValidateTargetPointSafety(
            WindowInfo targetInfo,
            int physX,
            int physY,
            bool checkScreenOcclusion,
            out string errCode,
            out string errMsg)
        {
            errCode = null;
            errMsg = null;

            if (physX < targetInfo.Rect.Left || physX > targetInfo.Rect.Right
                || physY < targetInfo.Rect.Top || physY > targetInfo.Rect.Bottom)
            {
                errCode = "OUT_OF_WINDOW_BOUNDS";
                errMsg = "目标坐标超出授权窗口边界";
                return false;
            }

            if (checkScreenOcclusion)
            {
                NativeMethods.POINT pt = new NativeMethods.POINT();
                pt.X = physX;
                pt.Y = physY;
                IntPtr hit = NativeMethods.WindowFromPoint(pt);
                if (hit != IntPtr.Zero)
                {
                    IntPtr rootHit = NativeMethods.GetAncestor(hit, NativeMethods.GA_ROOT);
                    if (rootHit != IntPtr.Zero && rootHit != targetInfo.Hwnd)
                    {
                        WindowInfo hitInfo = WindowSecurity.InspectWindow(rootHit);
                        string bCode;
                        string bReason;
                        if (hitInfo != null && WindowSecurity.CheckWindowBlocked(hitInfo, out bCode, out bReason))
                        {
                            errCode = bCode;
                            errMsg = bReason;
                            return false;
                        }
                        errCode = "TARGET_OCCLUDED";
                        errMsg = "目标坐标当前被其他置顶或活动窗口遮挡，已拦截物理点击以防误触";
                        return false;
                    }
                }
            }
            return true;
        }

        private static bool IsControlPasswordFailClosed(IntPtr ctrlHwnd, int physX, int physY, bool isElectronHost)
        {
            if (ctrlHwnd == IntPtr.Zero) return true;
            if (isElectronHost) return true;
            string cls = WindowSecurity.SafeGetClassName(ctrlHwnd);
            if (cls.IndexOf("Edit", StringComparison.OrdinalIgnoreCase) >= 0
                || cls.IndexOf("PasswordBox", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                int style = NativeMethods.GetWindowLongW(ctrlHwnd, NativeMethods.GWL_STYLE);
                if ((style & NativeMethods.ES_PASSWORD) != 0)
                {
                    return true;
                }
            }
            /* State: -1 = pending/unsupported/error (fail-closed), 0 = verified bool false, 1 = verified password */
            int probeState = -1;
            Thread mta = new Thread((ThreadStart)delegate
            {
                try
                {
                    AutomationElement elHandle = AutomationElement.FromHandle(ctrlHwnd);
                    AutomationElement elPoint = AutomationElement.FromPoint(new System.Windows.Point(physX, physY));
                    if (elHandle != null)
                    {
                        object vH = elHandle.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty, true);
                        if (!(vH is bool) || (bool)vH)
                        {
                            Interlocked.Exchange(ref probeState, 1);
                            return;
                        }
                    }
                    if (elPoint != null)
                    {
                        object vP = elPoint.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty, true);
                        if (!(vP is bool) || (bool)vP)
                        {
                            Interlocked.Exchange(ref probeState, 1);
                            return;
                        }
                    }
                    if (elHandle != null || elPoint != null)
                    {
                        Interlocked.Exchange(ref probeState, 0);
                    }
                }
                catch
                {
                    Interlocked.Exchange(ref probeState, -1);
                }
            });
            mta.IsBackground = true;
            mta.SetApartmentState(ApartmentState.MTA);
            mta.Start();
            if (!mta.Join(650))
            {
                return true;
            }
            return Interlocked.CompareExchange(ref probeState, 0, 0) != 0;
        }

        private static int s_activeMtaPasswordProbes = 0;

        private static bool IsCurrentlyFocusedControlPasswordFailClosed(IntPtr rootHwnd, bool isElectron)
        {
            if (isElectron) return true;

            uint pid = 0;
            uint tid = rootHwnd != IntPtr.Zero ? NativeMethods.GetWindowThreadProcessId(rootHwnd, out pid) : 0;
            IntPtr focusHwnd = IntPtr.Zero;

            if (tid != 0)
            {
                NativeMethods.GUITHREADINFO gti = new NativeMethods.GUITHREADINFO();
                gti.cbSize = (uint)Marshal.SizeOf(typeof(NativeMethods.GUITHREADINFO));
                if (NativeMethods.GetGUIThreadInfo(tid, ref gti) && gti.hwndFocus != IntPtr.Zero)
                {
                    focusHwnd = gti.hwndFocus;
                }
            }
            if (focusHwnd == IntPtr.Zero)
            {
                NativeMethods.GUITHREADINFO fgGti = new NativeMethods.GUITHREADINFO();
                fgGti.cbSize = (uint)Marshal.SizeOf(typeof(NativeMethods.GUITHREADINFO));
                if (NativeMethods.GetGUIThreadInfo(0, ref fgGti))
                {
                    focusHwnd = fgGti.hwndFocus;
                }
            }

            if (focusHwnd != IntPtr.Zero)
            {
                uint focusPid = 0;
                NativeMethods.GetWindowThreadProcessId(focusHwnd, out focusPid);
                if (pid != 0 && focusPid != 0 && focusPid != pid)
                {
                    return true;
                }
                string focusCls = WindowSecurity.SafeGetClassName(focusHwnd);
                if (focusCls.IndexOf("Chrome_WidgetWin", StringComparison.OrdinalIgnoreCase) >= 0
                    || focusCls.IndexOf("PasswordBox", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
                if (focusCls.IndexOf("Edit", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    int style = NativeMethods.GetWindowLongW(focusHwnd, NativeMethods.GWL_STYLE);
                    if ((style & NativeMethods.ES_PASSWORD) != 0)
                    {
                        return true;
                    }
                }
            }

            if (Interlocked.Increment(ref s_activeMtaPasswordProbes) > 3)
            {
                Interlocked.Decrement(ref s_activeMtaPasswordProbes);
                return true;
            }

            /* State: -1 = pending/unsupported/error (fail-closed), 0 = verified bool false, 1 = verified password */
            int probeState = -1;
            uint expectedPid = pid;
            Thread mta = new Thread((ThreadStart)delegate
            {
                try
                {
                    AutomationElement elFocus = AutomationElement.FocusedElement;
                    AutomationElement elHandle = focusHwnd != IntPtr.Zero ? AutomationElement.FromHandle(focusHwnd) : null;
                    if (elFocus == null && elHandle == null)
                    {
                        Interlocked.Exchange(ref probeState, 1);
                        return;
                    }
                    if (elFocus != null)
                    {
                        if (expectedPid != 0)
                        {
                            int fPid = elFocus.Current.ProcessId;
                            if (fPid > 0 && fPid != (int)expectedPid)
                            {
                                Interlocked.Exchange(ref probeState, 1);
                                return;
                            }
                        }
                        object vF = elFocus.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty, true);
                        if (!(vF is bool) || (bool)vF)
                        {
                            Interlocked.Exchange(ref probeState, 1);
                            return;
                        }
                    }
                    if (elHandle != null)
                    {
                        object vH = elHandle.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty, true);
                        if (!(vH is bool) || (bool)vH)
                        {
                            Interlocked.Exchange(ref probeState, 1);
                            return;
                        }
                    }
                    Interlocked.Exchange(ref probeState, 0);
                }
                catch
                {
                    Interlocked.Exchange(ref probeState, -1);
                }
                finally
                {
                    Interlocked.Decrement(ref s_activeMtaPasswordProbes);
                }
            });
            mta.IsBackground = true;
            mta.SetApartmentState(ApartmentState.MTA);
            mta.Start();
            if (!mta.Join(650))
            {
                return true;
            }
            return Interlocked.CompareExchange(ref probeState, 0, 0) != 0;
        }

        private static bool TryInvokeUiaClickMta(
            IntPtr hwnd,
            WindowInfo info,
            string refId,
            bool hasFallbackPoint,
            int fallbackX,
            int fallbackY,
            out int outX,
            out int outY,
            out string matchedRef,
            out string deliveryMethod,
            out string fatalErrCode,
            out string fatalErrMsg)
        {
            outX = fallbackX;
            outY = fallbackY;
            matchedRef = null;
            deliveryMethod = null;
            fatalErrCode = null;
            fatalErrMsg = null;

            if (info.IsElectron)
            {
                if (!string.IsNullOrEmpty(refId))
                {
                    fatalErrCode = "ELECTRON_UIA_DISABLED";
                    fatalErrMsg = "Electron 窗口启用了 0ms 防卡顿守卫，请使用坐标或浏览器桥定位";
                }
                return false;
            }

            bool invoked = false;
            int localX = fallbackX;
            int localY = fallbackY;
            string localRef = null;
            string localDelivery = null;
            string localErrCode = null;
            string localErrMsg = null;

            Thread mta = new Thread((ThreadStart)delegate
            {
                try
                {
                    string walkNote;
                    List<UiaMtaItem> items = WalkUiaTreeMta(hwnd, info.Rect, true, out walkNote);
                    UiaMtaItem target = null;

                    if (!string.IsNullOrEmpty(refId))
                    {
                        for (int i = 0; i < items.Count; i++)
                        {
                            if (string.Equals(items[i].RefId, refId, StringComparison.OrdinalIgnoreCase))
                            {
                                target = items[i];
                                break;
                            }
                        }
                        if (target == null)
                        {
                            localErrCode = "REF_NOT_FOUND";
                            localErrMsg = "未找到指定的控件引用: " + refId;
                            return;
                        }
                    }
                    else if (hasFallbackPoint)
                    {
                        long bestArea = long.MaxValue;
                        for (int i = 0; i < items.Count; i++)
                        {
                            Dictionary<string, object> b = items[i].Dict["bounds"] as Dictionary<string, object>;
                            if (b == null) continue;
                            int bx = Convert.ToInt32(b["x"]);
                            int by = Convert.ToInt32(b["y"]);
                            int bw = Convert.ToInt32(b["width"]);
                            int bh = Convert.ToInt32(b["height"]);
                            if (fallbackX < bx || fallbackX > bx + bw || fallbackY < by || fallbackY > by + bh)
                            {
                                continue;
                            }
                            string role = Convert.ToString(items[i].Dict["role"] ?? string.Empty);
                            if (role != "Button" && role != "CheckBox" && role != "RadioButton"
                                && role != "MenuItem" && role != "TabItem" && role != "Hyperlink"
                                && role != "ListItem" && role != "SplitButton")
                            {
                                continue;
                            }
                            long area = (long)bw * (long)bh;
                            if (area > 0 && area < bestArea)
                            {
                                bestArea = area;
                                target = items[i];
                            }
                        }
                    }

                    if (target == null || target.LiveElement == null)
                    {
                        return;
                    }

                    Dictionary<string, object> tb = target.Dict["bounds"] as Dictionary<string, object>;
                    if (tb != null)
                    {
                        localX = Convert.ToInt32(tb["x"]) + Convert.ToInt32(tb["width"]) / 2;
                        localY = Convert.ToInt32(tb["y"]) + Convert.ToInt32(tb["height"]) / 2;
                    }
                    localRef = target.RefId;

                    bool enabled = true;
                    if (target.Dict.ContainsKey("enabled") && target.Dict["enabled"] is bool)
                    {
                        enabled = (bool)target.Dict["enabled"];
                    }
                    if (!enabled)
                    {
                        if (!string.IsNullOrEmpty(refId))
                        {
                            localErrCode = "ELEMENT_DISABLED";
                            localErrMsg = "目标控件当前处于禁用状态: " + refId;
                        }
                        return;
                    }

                    object pat;
                    if (target.LiveElement.TryGetCurrentPattern(InvokePattern.Pattern, out pat) && pat is InvokePattern)
                    {
                        ((InvokePattern)pat).Invoke();
                        localDelivery = "uia_invoke";
                        invoked = true;
                        return;
                    }
                    if (target.LiveElement.TryGetCurrentPattern(TogglePattern.Pattern, out pat) && pat is TogglePattern)
                    {
                        ((TogglePattern)pat).Toggle();
                        localDelivery = "uia_toggle";
                        invoked = true;
                        return;
                    }
                    if (target.LiveElement.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pat) && pat is SelectionItemPattern)
                    {
                        ((SelectionItemPattern)pat).Select();
                        localDelivery = "uia_select";
                        invoked = true;
                        return;
                    }
                    if (!string.IsNullOrEmpty(refId)
                        && target.LiveElement.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat)
                        && pat is ExpandCollapsePattern)
                    {
                        ExpandCollapsePattern ecp = (ExpandCollapsePattern)pat;
                        ExpandCollapseState st = ecp.Current.ExpandCollapseState;
                        if (st == ExpandCollapseState.Collapsed || st == ExpandCollapseState.PartiallyExpanded)
                        {
                            ecp.Expand();
                        }
                        else if (st == ExpandCollapseState.Expanded)
                        {
                            ecp.Collapse();
                        }
                        localDelivery = "uia_expand_collapse";
                        invoked = true;
                        return;
                    }
                }
                catch
                {
                }
            });
            mta.IsBackground = true;
            mta.SetApartmentState(ApartmentState.MTA);
            mta.Start();
            mta.Join(2200);

            outX = localX;
            outY = localY;
            matchedRef = localRef;
            deliveryMethod = localDelivery;
            fatalErrCode = localErrCode;
            fatalErrMsg = localErrMsg;
            return invoked;
        }

        private static bool TryPostWin32MouseClick(
            IntPtr rootHwnd,
            WindowInfo info,
            int physX,
            int physY,
            string op,
            Dictionary<string, object> step)
        {
            if (info.IsElectron) return false;
            if (!JsonUtil.GetBool(step, "allowPostMessage", true)) return false;
            if (JsonUtil.GetBool(step, "forcePhysical", false)) return false;

            IntPtr targetHwnd = FindDeepestChildWindowAtScreenPoint(rootHwnd, physX, physY);
            if (targetHwnd == IntPtr.Zero) return false;

            NativeMethods.POINT clientPt = new NativeMethods.POINT();
            clientPt.X = physX;
            clientPt.Y = physY;
            if (!NativeMethods.ScreenToClient(targetHwnd, ref clientPt))
            {
                return false;
            }

            IntPtr lParam = MakeLParam(clientPt.X, clientPt.Y);
            NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_MOUSEMOVE, IntPtr.Zero, lParam);

            if (op == "right_click")
            {
                if (!NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_RBUTTONDOWN, new IntPtr(NativeMethods.MK_RBUTTON), lParam))
                {
                    return false;
                }
                NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_RBUTTONUP, IntPtr.Zero, lParam);
                return true;
            }

            if (op == "double_click")
            {
                if (!NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_LBUTTONDOWN, new IntPtr(NativeMethods.MK_LBUTTON), lParam))
                {
                    return false;
                }
                NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_LBUTTONUP, IntPtr.Zero, lParam);
                NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_LBUTTONDBLCLK, new IntPtr(NativeMethods.MK_LBUTTON), lParam);
                NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_LBUTTONUP, IntPtr.Zero, lParam);
                return true;
            }

            if (!NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_LBUTTONDOWN, new IntPtr(NativeMethods.MK_LBUTTON), lParam))
            {
                return false;
            }
            NativeMethods.PostMessageW(targetHwnd, NativeMethods.WM_LBUTTONUP, IntPtr.Zero, lParam);
            return true;
        }

        private static Dictionary<string, object> ExecuteMouseClick(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            string op,
            string mouseMode,
            EscEmergencyGuard escGuard)
        {
            string refId = JsonUtil.GetString(step, "ref", string.Empty).Trim();
            int physX = 0;
            int physY = 0;
            bool hasPoint = false;
            string errCode;
            string errMsg;

            if (JsonUtil.HasKey(step, "x") || JsonUtil.HasKey(step, "screenX"))
            {
                if (!ResolveStepPhysicalPoint(hwnd, info, step, false, out physX, out physY, out errCode, out errMsg))
                {
                    return ErrorResult(errCode, errMsg);
                }
                hasPoint = true;
            }

            /* Tier L2: UIA Control Pattern (Zero cursor movement, preserve user foreground window) */
            if (mouseMode != "physical" && op == "click" && !info.IsElectron && (!string.IsNullOrEmpty(refId) || hasPoint))
            {
                IntPtr prevFg = NativeMethods.GetForegroundWindow();
                int uiaX;
                int uiaY;
                string matchedRef;
                string uiaDelivery;
                string uiaErrCode;
                string uiaErrMsg;
                if (TryInvokeUiaClickMta(
                    hwnd,
                    info,
                    refId,
                    hasPoint,
                    physX,
                    physY,
                    out uiaX,
                    out uiaY,
                    out matchedRef,
                    out uiaDelivery,
                    out uiaErrCode,
                    out uiaErrMsg))
                {
                    if (prevFg != IntPtr.Zero && prevFg != hwnd && NativeMethods.GetForegroundWindow() == hwnd
                        && JsonUtil.GetBool(step, "preserveForeground", true) && NativeMethods.IsWindow(prevFg))
                    {
                        NativeMethods.SetForegroundWindow(prevFg);
                    }
                    IntPtr afterFg = NativeMethods.GetForegroundWindow();
                    Dictionary<string, object> uiaRes = new Dictionary<string, object>();
                    uiaRes["ok"] = true;
                    uiaRes["op"] = op;
                    uiaRes["x"] = uiaX;
                    uiaRes["y"] = uiaY;
                    if (!string.IsNullOrEmpty(matchedRef)) uiaRes["ref"] = matchedRef;
                    uiaRes["delivery"] = uiaDelivery;
                    uiaRes["mouseMode"] = mouseMode;
                    uiaRes["physicalCursorMoved"] = false;
                    uiaRes["focusStolen"] = (prevFg != IntPtr.Zero && afterFg != prevFg);
                    return uiaRes;
                }
                if (!string.IsNullOrEmpty(uiaErrCode))
                {
                    return ErrorResult(uiaErrCode, uiaErrMsg);
                }
                if (!hasPoint && uiaX != 0 && uiaY != 0)
                {
                    physX = uiaX;
                    physY = uiaY;
                    hasPoint = ValidateTargetPointSafety(info, physX, physY, false, out errCode, out errMsg);
                }
            }

            if (!hasPoint)
            {
                if (!ResolveStepPhysicalPoint(hwnd, info, step, false, out physX, out physY, out errCode, out errMsg))
                {
                    return ErrorResult(errCode, errMsg);
                }
                hasPoint = true;
            }
            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            /* Tier L3: Win32 Child HWND PostMessageW (Zero cursor movement, zero focus stealing) */
            if (mouseMode != "physical" && !info.IsElectron)
            {
                if (TryPostWin32MouseClick(hwnd, info, physX, physY, op, step))
                {
                    Dictionary<string, object> msgRes = new Dictionary<string, object>();
                    msgRes["ok"] = true;
                    msgRes["op"] = op;
                    msgRes["x"] = physX;
                    msgRes["y"] = physY;
                    if (!string.IsNullOrEmpty(refId)) msgRes["ref"] = refId;
                    msgRes["delivery"] = "win32_message";
                    msgRes["mouseMode"] = mouseMode;
                    msgRes["physicalCursorMoved"] = false;
                    msgRes["focusStolen"] = false;
                    return msgRes;
                }
            }

            /* Tier L4: Courteous Physical Fallback (Idle Yield >= 350ms + Instant Cursor Restore) */
            if (!ActivateWindowForPhysicalInput(hwnd, ref info, mouseMode, escGuard, out errCode, out errMsg))
            {
                return ErrorResult(errCode, errMsg);
            }
            if (!ResolveStepPhysicalPoint(hwnd, info, step, true, out physX, out physY, out errCode, out errMsg))
            {
                return ErrorResult(errCode, errMsg);
            }
            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            bool restoreCursor = JsonUtil.GetBool(step, "restoreCursor", mouseMode == "courteous");
            NativeMethods.POINT origCursor = new NativeMethods.POINT();
            bool hasOrigCursor = restoreCursor && NativeMethods.GetCursorPos(out origCursor);

            try
            {
                NativeMethods.INPUT move = InputController.CreateMouseAbsMoveInput(physX, physY);
                if (op == "right_click")
                {
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        move,
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_RIGHTDOWN, 0),
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_RIGHTUP, 0)
                    });
                }
                else if (op == "double_click")
                {
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        move,
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_LEFTDOWN, 0),
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_LEFTUP, 0)
                    });
                    Thread.Sleep(35);
                    if (escGuard.IsEscTriggered()) return EscAbortedResult();
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_LEFTDOWN, 0),
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_LEFTUP, 0)
                    });
                }
                else
                {
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        move,
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_LEFTDOWN, 0),
                        InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_LEFTUP, 0)
                    });
                }

                if (hasOrigCursor)
                {
                    Thread.Sleep(6);
                }
            }
            finally
            {
                if (hasOrigCursor)
                {
                    NativeMethods.SetCursorPos(origCursor.X, origCursor.Y);
                }
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["op"] = op;
            res["x"] = physX;
            res["y"] = physY;
            res["delivery"] = hasOrigCursor ? "courteous_physical_restore" : "physical_sendinput";
            res["mouseMode"] = mouseMode;
            res["physicalCursorMoved"] = true;
            res["cursorRestored"] = hasOrigCursor;
            return res;
        }

        private static bool TrySetTextUiaOrWin32Mta(
            IntPtr hwnd,
            WindowInfo info,
            string refId,
            bool hasPoint,
            int targetX,
            int targetY,
            string text,
            bool clearFirst,
            out int outX,
            out int outY,
            out string matchedRef,
            out string deliveryMethod,
            out string fatalErrCode,
            out string fatalErrMsg)
        {
            outX = targetX;
            outY = targetY;
            matchedRef = null;
            deliveryMethod = null;
            fatalErrCode = null;
            fatalErrMsg = null;

            if (info.IsElectron)
            {
                if (!string.IsNullOrEmpty(refId))
                {
                    fatalErrCode = "ELECTRON_UIA_DISABLED";
                    fatalErrMsg = "Electron 窗口启用了 0ms 防卡顿守卫，不支持 UIA ValuePattern";
                }
                return false;
            }

            bool applied = false;
            int localX = targetX;
            int localY = targetY;
            string localRef = null;
            string localDelivery = null;
            string localErrCode = null;
            string localErrMsg = null;

            Thread mta = new Thread((ThreadStart)delegate
            {
                try
                {
                    string walkNote;
                    List<UiaMtaItem> items = WalkUiaTreeMta(hwnd, info.Rect, true, out walkNote);
                    UiaMtaItem target = null;

                    if (!string.IsNullOrEmpty(refId))
                    {
                        for (int i = 0; i < items.Count; i++)
                        {
                            if (string.Equals(items[i].RefId, refId, StringComparison.OrdinalIgnoreCase))
                            {
                                target = items[i];
                                break;
                            }
                        }
                        if (target == null)
                        {
                            localErrCode = "REF_NOT_FOUND";
                            localErrMsg = "未找到指定的输入控件引用: " + refId;
                            return;
                        }
                    }
                    else if (hasPoint)
                    {
                        long bestArea = long.MaxValue;
                        for (int i = 0; i < items.Count; i++)
                        {
                            Dictionary<string, object> b = items[i].Dict["bounds"] as Dictionary<string, object>;
                            if (b == null) continue;
                            int bx = Convert.ToInt32(b["x"]);
                            int by = Convert.ToInt32(b["y"]);
                            int bw = Convert.ToInt32(b["width"]);
                            int bh = Convert.ToInt32(b["height"]);
                            if (targetX < bx || targetX > bx + bw || targetY < by || targetY > by + bh) continue;
                            string role = Convert.ToString(items[i].Dict["role"] ?? string.Empty);
                            if (role != "Edit" && role != "Document" && role != "ComboBox") continue;
                            long area = (long)bw * (long)bh;
                            if (area > 0 && area < bestArea)
                            {
                                bestArea = area;
                                target = items[i];
                            }
                        }
                    }

                    if (target == null || target.LiveElement == null) return;

                    Dictionary<string, object> tb = target.Dict["bounds"] as Dictionary<string, object>;
                    if (tb != null)
                    {
                        localX = Convert.ToInt32(tb["x"]) + Convert.ToInt32(tb["width"]) / 2;
                        localY = Convert.ToInt32(tb["y"]) + Convert.ToInt32(tb["height"]) / 2;
                    }
                    localRef = target.RefId;

                    bool isPwd = (target.Dict.ContainsKey("isPassword") && target.Dict["isPassword"] is bool && (bool)target.Dict["isPassword"])
                        || target.LiveElement.Current.IsPassword;
                    if (isPwd)
                    {
                        localErrCode = "PASSWORD_FIELD_HANDOFF";
                        localErrMsg = "检测到密码输入框，已拒绝自动输入，请人工处理";
                        return;
                    }

                    object pat;
                    if (target.LiveElement.TryGetCurrentPattern(ValuePattern.Pattern, out pat) && pat is ValuePattern)
                    {
                        ValuePattern vp = (ValuePattern)pat;
                        if (!vp.Current.IsReadOnly)
                        {
                            string baseVal = clearFirst ? string.Empty : (vp.Current.Value ?? string.Empty);
                            vp.SetValue(baseVal + text);
                            localDelivery = "uia_value";
                            applied = true;
                            return;
                        }
                    }

                    int nativeHandle = target.LiveElement.Current.NativeWindowHandle;
                    if (nativeHandle != 0)
                    {
                        IntPtr ctrlHwnd = new IntPtr(nativeHandle);
                        if (ctrlHwnd == hwnd || NativeMethods.IsChild(hwnd, ctrlHwnd))
                        {
                            string existing = clearFirst ? string.Empty : WindowSecurity.SafeGetWindowText(ctrlHwnd, 4096);
                            IntPtr msgRes;
                            IntPtr sent = NativeMethods.SendMessageTimeoutStringW(
                                ctrlHwnd,
                                NativeMethods.WM_SETTEXT,
                                IntPtr.Zero,
                                existing + text,
                                NativeMethods.SMTO_ABORTIFHUNG,
                                600,
                                out msgRes);
                            if (sent != IntPtr.Zero)
                            {
                                localDelivery = "win32_settext";
                                applied = true;
                                return;
                            }
                        }
                    }
                }
                catch
                {
                }
            });
            mta.IsBackground = true;
            mta.SetApartmentState(ApartmentState.MTA);
            mta.Start();
            mta.Join(2200);

            outX = localX;
            outY = localY;
            matchedRef = localRef;
            deliveryMethod = localDelivery;
            fatalErrCode = localErrCode;
            fatalErrMsg = localErrMsg;
            return applied;
        }

        private static Dictionary<string, object> ExecuteTypeText(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            string mouseMode,
            EscEmergencyGuard escGuard)
        {
            string text = JsonUtil.GetString(step, "text", string.Empty);
            if (text.Length == 0)
            {
                Dictionary<string, object> emptyRes = new Dictionary<string, object>();
                emptyRes["ok"] = true;
                emptyRes["op"] = "type_text";
                emptyRes["typedUnits"] = 0;
                emptyRes["physicalCursorMoved"] = false;
                return emptyRes;
            }
            if (text.Length > 8192)
            {
                return ErrorResult("TEXT_TOO_LONG", "单次 type_text 长度不能超过 8192 字符");
            }

            string refId = JsonUtil.GetString(step, "ref", string.Empty).Trim();
            bool clearFirst = JsonUtil.GetBool(step, "clear", JsonUtil.GetBool(step, "clearFirst", false));
            int targetX = 0;
            int targetY = 0;
            bool hasPoint = false;
            string errCode;
            string errMsg;

            if (JsonUtil.HasKey(step, "x") || JsonUtil.HasKey(step, "screenX"))
            {
                if (!ResolveStepPhysicalPoint(hwnd, info, step, false, out targetX, out targetY, out errCode, out errMsg))
                {
                    return ErrorResult(errCode, errMsg);
                }
                hasPoint = true;
            }

            /* Tier L2 / L3: UIA ValuePattern or Win32 WM_SETTEXT (Zero cursor movement, zero focus stealing) */
            if (mouseMode != "physical" && !info.IsElectron && (!string.IsNullOrEmpty(refId) || hasPoint))
            {
                int uiaX;
                int uiaY;
                string matchedRef;
                string delivery;
                string uiaErrCode;
                string uiaErrMsg;
                if (TrySetTextUiaOrWin32Mta(
                    hwnd,
                    info,
                    refId,
                    hasPoint,
                    targetX,
                    targetY,
                    text,
                    clearFirst,
                    out uiaX,
                    out uiaY,
                    out matchedRef,
                    out delivery,
                    out uiaErrCode,
                    out uiaErrMsg))
                {
                    Dictionary<string, object> bgRes = new Dictionary<string, object>();
                    bgRes["ok"] = true;
                    bgRes["op"] = "type_text";
                    bgRes["typedUnits"] = text.Length;
                    bgRes["x"] = uiaX;
                    bgRes["y"] = uiaY;
                    if (!string.IsNullOrEmpty(matchedRef)) bgRes["ref"] = matchedRef;
                    bgRes["delivery"] = delivery;
                    bgRes["mouseMode"] = mouseMode;
                    bgRes["physicalCursorMoved"] = false;
                    bgRes["focusStolen"] = false;
                    return bgRes;
                }
                if (!string.IsNullOrEmpty(uiaErrCode))
                {
                    return ErrorResult(uiaErrCode, uiaErrMsg);
                }
            }

            /* Tier L4: Courteous Physical Keyboard Fallback */
            if (!ActivateWindowForPhysicalInput(hwnd, ref info, mouseMode, escGuard, out errCode, out errMsg))
            {
                return ErrorResult(errCode, errMsg);
            }
            if (hasPoint)
            {
                IntPtr hitChild = FindDeepestChildWindowAtScreenPoint(hwnd, targetX, targetY);
                if (IsControlPasswordFailClosed(hitChild, targetX, targetY, info.IsElectron))
                {
                    return ErrorResult("PASSWORD_FIELD_HANDOFF", "检测到目标坐标为密码或未受验受保护输入控件，已拒绝自动输入");
                }
            }
            if (IsCurrentlyFocusedControlPasswordFailClosed(hwnd, info.IsElectron))
            {
                return ErrorResult("PASSWORD_FIELD_HANDOFF", "检测到当前键盘焦点为密码或未受验受保护输入控件，已拒绝自动输入");
            }

            IntPtr targetRoot = GetRootOrSelf(hwnd);
            string normalized = text.Replace("\r\n", "\n");
            int typedUnits = 0;
            for (int i = 0; i < normalized.Length; i++)
            {
                char c = normalized[i];
                if (escGuard.IsEscTriggered())
                {
                    return EscAbortedResult();
                }
                if (!IsTargetWindowStillForeground(hwnd, targetRoot))
                {
                    return ErrorResult("FOREGROUND_LOST_ABORTED", "检测到前台焦点已离开目标窗口，已立即中止后续文本输入");
                }

                if (c == '\n' || c == '\r')
                {
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        InputController.CreateKeyVkInput(NativeMethods.VK_RETURN, 0),
                        InputController.CreateKeyVkInput(NativeMethods.VK_RETURN, NativeMethods.KEYEVENTF_KEYUP)
                    });
                    typedUnits++;
                    Thread.Sleep(15);
                    if (i + 1 < normalized.Length && IsCurrentlyFocusedControlPasswordFailClosed(hwnd, info.IsElectron))
                    {
                        return ErrorResult("PASSWORD_FIELD_HANDOFF", "回车切换焦点后命中密码或未受验受保护输入控件，已中止后续输入");
                    }
                }
                else if (c == '\t')
                {
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        InputController.CreateKeyVkInput(NativeMethods.VK_TAB, 0),
                        InputController.CreateKeyVkInput(NativeMethods.VK_TAB, NativeMethods.KEYEVENTF_KEYUP)
                    });
                    typedUnits++;
                    Thread.Sleep(15);
                    if (i + 1 < normalized.Length && IsCurrentlyFocusedControlPasswordFailClosed(hwnd, info.IsElectron))
                    {
                        return ErrorResult("PASSWORD_FIELD_HANDOFF", "Tab 切换焦点后命中密码或未受验受保护输入控件，已中止后续输入");
                    }
                }
                else if (char.IsHighSurrogate(c) && i + 1 < normalized.Length && char.IsLowSurrogate(normalized[i + 1]))
                {
                    ushort hi = (ushort)c;
                    ushort lo = (ushort)normalized[i + 1];
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        InputController.CreateKeyUnicodeInput(hi, false),
                        InputController.CreateKeyUnicodeInput(lo, false),
                        InputController.CreateKeyUnicodeInput(hi, true),
                        InputController.CreateKeyUnicodeInput(lo, true)
                    });
                    i++;
                    typedUnits += 2;
                }
                else
                {
                    ushort unit = (ushort)c;
                    InputController.SendInputs(new NativeMethods.INPUT[]
                    {
                        InputController.CreateKeyUnicodeInput(unit, false),
                        InputController.CreateKeyUnicodeInput(unit, true)
                    });
                    typedUnits++;
                }

                if ((i & 15) == 15)
                {
                    Thread.Sleep(4);
                }
            }

            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["op"] = "type_text";
            res["typedUnits"] = typedUnits;
            res["delivery"] = "courteous_keyboard";
            res["mouseMode"] = mouseMode;
            res["physicalCursorMoved"] = false;
            return res;
        }

        private static Dictionary<string, object> ExecutePressKey(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            string mouseMode,
            EscEmergencyGuard escGuard)
        {
            string chord = JsonUtil.GetString(step, "key", string.Empty);
            if (string.IsNullOrEmpty(chord)) chord = JsonUtil.GetString(step, "keys", string.Empty);
            chord = chord.Trim();
            if (chord.Length == 0)
            {
                return ErrorResult("MISSING_KEY", "缺少按键名称 key");
            }

            List<ushort> modifiers = new List<ushort>();
            ushort mainVk = 0;
            bool hasWin = false;
            bool hasAlt = false;
            bool hasCtrl = false;
            bool hasShift = false;

            string[] parts = chord.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < parts.Length; i++)
            {
                string tok = parts[i].Trim();
                string lower = tok.ToLowerInvariant();
                if (i < parts.Length - 1)
                {
                    if (lower == "ctrl" || lower == "control")
                    {
                        modifiers.Add(NativeMethods.VK_LCONTROL);
                        hasCtrl = true;
                        continue;
                    }
                    if (lower == "shift")
                    {
                        modifiers.Add(NativeMethods.VK_LSHIFT);
                        hasShift = true;
                        continue;
                    }
                    if (lower == "alt" || lower == "menu")
                    {
                        modifiers.Add(NativeMethods.VK_LMENU);
                        hasAlt = true;
                        continue;
                    }
                    if (lower == "win" || lower == "meta" || lower == "super" || lower == "lwin")
                    {
                        hasWin = true;
                        continue;
                    }
                }
                if (!TryMapKeyNameToVk(tok, out mainVk))
                {
                    return ErrorResult("INVALID_KEY_CHORD", "不支持或非法的按键组合: " + chord);
                }
            }

            if (hasWin)
            {
                return ErrorResult("WIN_SHORTCUT_BLOCKED", "出于桌面安全边界保护，禁止自动发送 Win 系统级快捷键");
            }
            if (hasCtrl && hasAlt && mainVk == NativeMethods.VK_DELETE)
            {
                return ErrorResult("SENSITIVE_CHORD_BLOCKED", "已拦截系统安全注意力组合键");
            }
            if ((hasCtrl && mainVk == NativeMethods.VK_ESCAPE)
                || (hasAlt && mainVk == NativeMethods.VK_TAB)
                || (hasAlt && mainVk == NativeMethods.VK_ESCAPE))
            {
                return ErrorResult("SENSITIVE_CHORD_BLOCKED", "已拦截高危窗口焦点切换或系统菜单组合键: " + chord);
            }
            if (hasAlt && mainVk == NativeMethods.VK_F4 && WindowSecurity.IsSystemOrSensitiveForClose(info))
            {
                return ErrorResult("SENSITIVE_CHORD_BLOCKED", "已拦截对系统壳层窗口发送 Alt+F4");
            }
            if (mainVk == 0)
            {
                return ErrorResult("INVALID_KEY_CHORD", "无法解析主按键: " + chord);
            }

            int targetX = 0;
            int targetY = 0;
            bool hasPoint = false;
            if (JsonUtil.HasKey(step, "x") || JsonUtil.HasKey(step, "screenX") || JsonUtil.HasKey(step, "ref"))
            {
                string ptErrCode;
                string ptErrMsg;
                if (!ResolveStepPhysicalPoint(hwnd, info, step, false, out targetX, out targetY, out ptErrCode, out ptErrMsg))
                {
                    return ErrorResult(ptErrCode, ptErrMsg);
                }
                hasPoint = true;
            }

            bool isShiftInsert = hasShift && mainVk == NativeMethods.VK_INSERT;
            bool isPureNavVk = mainVk == NativeMethods.VK_TAB
                || mainVk == NativeMethods.VK_ESCAPE
                || mainVk == NativeMethods.VK_UP
                || mainVk == NativeMethods.VK_DOWN
                || mainVk == NativeMethods.VK_LEFT
                || mainVk == NativeMethods.VK_RIGHT
                || mainVk == NativeMethods.VK_SHIFT
                || mainVk == NativeMethods.VK_LSHIFT
                || mainVk == NativeMethods.VK_RSHIFT;
            bool isPureNavigationKey = !hasCtrl && !hasAlt && !hasWin && !isShiftInsert && isPureNavVk;

            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            if (mouseMode == "strict_virtual" && !info.IsElectron && modifiers.Count == 0)
            {
                IntPtr targetKeyHwnd = hasPoint ? FindDeepestChildWindowAtScreenPoint(hwnd, targetX, targetY) : hwnd;
                if (targetKeyHwnd == IntPtr.Zero) targetKeyHwnd = hwnd;
                if (!isPureNavigationKey)
                {
                    bool bgPwd = (hasPoint && IsControlPasswordFailClosed(targetKeyHwnd, targetX, targetY, info.IsElectron))
                        || IsCurrentlyFocusedControlPasswordFailClosed(hwnd, info.IsElectron);
                    if (bgPwd)
                    {
                        return ErrorResult("PASSWORD_FIELD_HANDOFF", "检测到目标或焦点控件为密码或未受验受保护输入控件，已拒绝发送按键");
                    }
                }
                if (NativeMethods.PostMessageW(targetKeyHwnd, NativeMethods.WM_KEYDOWN, new IntPtr(mainVk), IntPtr.Zero))
                {
                    NativeMethods.PostMessageW(targetKeyHwnd, NativeMethods.WM_KEYUP, new IntPtr(mainVk), IntPtr.Zero);
                    Dictionary<string, object> bgKeyRes = new Dictionary<string, object>();
                    bgKeyRes["ok"] = true;
                    bgKeyRes["op"] = "press_key";
                    bgKeyRes["key"] = chord;
                    bgKeyRes["delivery"] = "win32_message";
                    bgKeyRes["mouseMode"] = mouseMode;
                    bgKeyRes["physicalCursorMoved"] = false;
                    bgKeyRes["focusStolen"] = false;
                    return bgKeyRes;
                }
            }

            string actErrCode;
            string actErrMsg;
            if (!ActivateWindowForPhysicalInput(hwnd, ref info, mouseMode, escGuard, out actErrCode, out actErrMsg))
            {
                return ErrorResult(actErrCode, actErrMsg);
            }

            if (!isPureNavigationKey)
            {
                bool fgPwd = (hasPoint && IsControlPasswordFailClosed(FindDeepestChildWindowAtScreenPoint(hwnd, targetX, targetY), targetX, targetY, info.IsElectron))
                    || IsCurrentlyFocusedControlPasswordFailClosed(hwnd, info.IsElectron);
                if (fgPwd)
                {
                    return ErrorResult("PASSWORD_FIELD_HANDOFF", "检测到目标或当前焦点为密码或未受验受保护输入控件，已拒绝发送按键");
                }
            }

            IntPtr fgTargetRoot = GetRootOrSelf(hwnd);
            if (!IsTargetWindowStillForeground(hwnd, fgTargetRoot))
            {
                return ErrorResult("FOREGROUND_LOST_ABORTED", "检测到前台焦点已离开目标窗口，已拒绝发送按键");
            }

            bool sendingEscape = (mainVk == NativeMethods.VK_ESCAPE && modifiers.Count == 0);
            if (sendingEscape)
            {
                escGuard.TemporarilySuspendHotKey();
            }

            try
            {
                List<NativeMethods.INPUT> seq = new List<NativeMethods.INPUT>();
                for (int i = 0; i < modifiers.Count; i++)
                {
                    uint mf = InputController.IsExtendedKey(modifiers[i]) ? NativeMethods.KEYEVENTF_EXTENDEDKEY : 0;
                    seq.Add(InputController.CreateKeyVkInput(modifiers[i], mf));
                }
                uint mainDownFlags = InputController.IsExtendedKey(mainVk) ? NativeMethods.KEYEVENTF_EXTENDEDKEY : 0;
                uint mainUpFlags = mainDownFlags | NativeMethods.KEYEVENTF_KEYUP;
                seq.Add(InputController.CreateKeyVkInput(mainVk, mainDownFlags));
                seq.Add(InputController.CreateKeyVkInput(mainVk, mainUpFlags));
                for (int i = modifiers.Count - 1; i >= 0; i--)
                {
                    uint mf = (InputController.IsExtendedKey(modifiers[i]) ? NativeMethods.KEYEVENTF_EXTENDEDKEY : 0) | NativeMethods.KEYEVENTF_KEYUP;
                    seq.Add(InputController.CreateKeyVkInput(modifiers[i], mf));
                }
                InputController.SendInputs(seq.ToArray());

                if (sendingEscape)
                {
                    Thread.Sleep(5);
                    escGuard.ClearSyntheticMessages();
                }
            }
            finally
            {
                if (sendingEscape)
                {
                    escGuard.RegisterEscHotKey();
                }
            }

            if (!sendingEscape && escGuard.IsEscTriggered())
            {
                return EscAbortedResult();
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["op"] = "press_key";
            res["key"] = chord;
            res["delivery"] = "courteous_keyboard";
            res["mouseMode"] = mouseMode;
            res["physicalCursorMoved"] = false;
            return res;
        }

        private static bool TryMapKeyNameToVk(string name, out ushort vk)
        {
            vk = 0;
            if (string.IsNullOrEmpty(name)) return false;
            string s = name.Trim();
            if (s.Length == 1)
            {
                char ch = char.ToUpperInvariant(s[0]);
                if (ch >= 'A' && ch <= 'Z')
                {
                    vk = (ushort)ch;
                    return true;
                }
                if (ch >= '0' && ch <= '9')
                {
                    vk = (ushort)ch;
                    return true;
                }
            }

            string lower = s.ToLowerInvariant();
            switch (lower)
            {
                case "enter":
                case "return":
                    vk = NativeMethods.VK_RETURN; return true;
                case "tab":
                    vk = NativeMethods.VK_TAB; return true;
                case "shift":
                    vk = NativeMethods.VK_SHIFT; return true;
                case "esc":
                case "escape":
                    vk = NativeMethods.VK_ESCAPE; return true;
                case "backspace":
                case "back":
                    vk = NativeMethods.VK_BACK; return true;
                case "delete":
                case "del":
                    vk = NativeMethods.VK_DELETE; return true;
                case "insert":
                case "ins":
                    vk = NativeMethods.VK_INSERT; return true;
                case "space":
                case "spacebar":
                    vk = NativeMethods.VK_SPACE; return true;
                case "up":
                case "arrowup":
                    vk = NativeMethods.VK_UP; return true;
                case "down":
                case "arrowdown":
                    vk = NativeMethods.VK_DOWN; return true;
                case "left":
                case "arrowleft":
                    vk = NativeMethods.VK_LEFT; return true;
                case "right":
                case "arrowright":
                    vk = NativeMethods.VK_RIGHT; return true;
                case "home":
                    vk = NativeMethods.VK_HOME; return true;
                case "end":
                    vk = NativeMethods.VK_END; return true;
                case "pageup":
                case "pgup":
                    vk = NativeMethods.VK_PRIOR; return true;
                case "pagedown":
                case "pgdn":
                    vk = NativeMethods.VK_NEXT; return true;
                default:
                    if (lower.StartsWith("f", StringComparison.Ordinal) && lower.Length <= 3)
                    {
                        int fNum;
                        if (int.TryParse(lower.Substring(1), out fNum) && fNum >= 1 && fNum <= 12)
                        {
                            vk = (ushort)(NativeMethods.VK_F1 + (fNum - 1));
                            return true;
                        }
                    }
                    return false;
            }
        }

        private static Dictionary<string, object> ExecuteScroll(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            string mouseMode,
            EscEmergencyGuard escGuard)
        {
            int px;
            int py;
            string errCode;
            string errMsg;
            if (JsonUtil.HasKey(step, "x") || JsonUtil.HasKey(step, "screenX") || JsonUtil.HasKey(step, "ref"))
            {
                if (!ResolveStepPhysicalPoint(hwnd, info, step, false, out px, out py, out errCode, out errMsg))
                {
                    return ErrorResult(errCode, errMsg);
                }
            }
            else
            {
                px = (info.Rect.Left + info.Rect.Right) / 2;
                py = (info.Rect.Top + info.Rect.Bottom) / 2;
            }

            int deltaY = JsonUtil.GetInt(step, "deltaY", JsonUtil.GetInt(step, "delta", -240));
            int deltaX = JsonUtil.GetInt(step, "deltaX", 0);
            string refId = JsonUtil.GetString(step, "ref", string.Empty).Trim();

            /* Tier L2: UIA ScrollPattern when ref is specified */
            if (mouseMode != "physical" && !info.IsElectron && !string.IsNullOrEmpty(refId))
            {
                bool uiaScrolled = false;
                Thread mta = new Thread((ThreadStart)delegate
                {
                    try
                    {
                        string walkNote;
                        List<UiaMtaItem> items = WalkUiaTreeMta(hwnd, info.Rect, true, out walkNote);
                        for (int i = 0; i < items.Count; i++)
                        {
                            if (!string.Equals(items[i].RefId, refId, StringComparison.OrdinalIgnoreCase) || items[i].LiveElement == null)
                            {
                                continue;
                            }
                            object pat;
                            if (items[i].LiveElement.TryGetCurrentPattern(ScrollPattern.Pattern, out pat) && pat is ScrollPattern)
                            {
                                ScrollPattern sp = (ScrollPattern)pat;
                                ScrollAmount vAmt = deltaY < 0 ? ScrollAmount.SmallIncrement : (deltaY > 0 ? ScrollAmount.SmallDecrement : ScrollAmount.NoAmount);
                                ScrollAmount hAmt = deltaX > 0 ? ScrollAmount.SmallIncrement : (deltaX < 0 ? ScrollAmount.SmallDecrement : ScrollAmount.NoAmount);
                                sp.Scroll(
                                    sp.Current.HorizontallyScrollable ? hAmt : ScrollAmount.NoAmount,
                                    sp.Current.VerticallyScrollable ? vAmt : ScrollAmount.NoAmount);
                                uiaScrolled = true;
                            }
                            break;
                        }
                    }
                    catch
                    {
                    }
                });
                mta.IsBackground = true;
                mta.SetApartmentState(ApartmentState.MTA);
                mta.Start();
                mta.Join(1800);
                if (uiaScrolled)
                {
                    Dictionary<string, object> uiaRes = new Dictionary<string, object>();
                    uiaRes["ok"] = true;
                    uiaRes["op"] = "scroll";
                    uiaRes["x"] = px;
                    uiaRes["y"] = py;
                    uiaRes["deltaY"] = deltaY;
                    uiaRes["deltaX"] = deltaX;
                    uiaRes["delivery"] = "uia_scroll";
                    uiaRes["mouseMode"] = mouseMode;
                    uiaRes["physicalCursorMoved"] = false;
                    uiaRes["focusStolen"] = false;
                    return uiaRes;
                }
            }

            /* Tier L3: Win32 Child HWND WM_MOUSEWHEEL (Zero cursor movement, zero focus stealing) */
            if (mouseMode != "physical" && !info.IsElectron && JsonUtil.GetBool(step, "allowPostMessage", true))
            {
                IntPtr childHwnd = FindDeepestChildWindowAtScreenPoint(hwnd, px, py);
                if (childHwnd != IntPtr.Zero)
                {
                    IntPtr lParamScreen = MakeLParam(px, py);
                    bool posted = false;
                    if (deltaY != 0)
                    {
                        IntPtr wParamY = new IntPtr((deltaY & 0xFFFF) << 16);
                        posted = NativeMethods.PostMessageW(childHwnd, NativeMethods.WM_MOUSEWHEEL, wParamY, lParamScreen) || posted;
                    }
                    if (deltaX != 0)
                    {
                        IntPtr wParamX = new IntPtr((deltaX & 0xFFFF) << 16);
                        posted = NativeMethods.PostMessageW(childHwnd, NativeMethods.WM_MOUSEHWHEEL, wParamX, lParamScreen) || posted;
                    }
                    if (posted || (deltaY == 0 && deltaX == 0))
                    {
                        Dictionary<string, object> msgRes = new Dictionary<string, object>();
                        msgRes["ok"] = true;
                        msgRes["op"] = "scroll";
                        msgRes["x"] = px;
                        msgRes["y"] = py;
                        msgRes["deltaY"] = deltaY;
                        msgRes["deltaX"] = deltaX;
                        msgRes["delivery"] = "win32_message";
                        msgRes["mouseMode"] = mouseMode;
                        msgRes["physicalCursorMoved"] = false;
                        msgRes["focusStolen"] = false;
                        return msgRes;
                    }
                }
            }

            /* Tier L4: Courteous Physical Wheel Fallback */
            if (!ActivateWindowForPhysicalInput(hwnd, ref info, mouseMode, escGuard, out errCode, out errMsg))
            {
                return ErrorResult(errCode, errMsg);
            }
            if (!ValidateTargetPointSafety(info, px, py, true, out errCode, out errMsg))
            {
                return ErrorResult(errCode, errMsg);
            }
            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            bool restoreCursor = JsonUtil.GetBool(step, "restoreCursor", mouseMode == "courteous");
            NativeMethods.POINT origCursor = new NativeMethods.POINT();
            bool hasOrigCursor = restoreCursor && NativeMethods.GetCursorPos(out origCursor);

            try
            {
                List<NativeMethods.INPUT> inputs = new List<NativeMethods.INPUT>();
                inputs.Add(InputController.CreateMouseAbsMoveInput(px, py));
                if (deltaY != 0)
                {
                    inputs.Add(InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)deltaY)));
                }
                if (deltaX != 0)
                {
                    inputs.Add(InputController.CreateMouseButtonInput(NativeMethods.MOUSEEVENTF_HWHEEL, unchecked((uint)deltaX)));
                }
                InputController.SendInputs(inputs.ToArray());
                if (hasOrigCursor)
                {
                    Thread.Sleep(6);
                }
            }
            finally
            {
                if (hasOrigCursor)
                {
                    NativeMethods.SetCursorPos(origCursor.X, origCursor.Y);
                }
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["op"] = "scroll";
            res["x"] = px;
            res["y"] = py;
            res["deltaY"] = deltaY;
            res["deltaX"] = deltaX;
            res["delivery"] = hasOrigCursor ? "courteous_physical_restore" : "physical_sendinput";
            res["mouseMode"] = mouseMode;
            res["physicalCursorMoved"] = true;
            res["cursorRestored"] = hasOrigCursor;
            return res;
        }

        private static Dictionary<string, object> ExecuteSelectOption(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            string mouseMode,
            EscEmergencyGuard escGuard)
        {
            string refId = JsonUtil.GetString(step, "ref", string.Empty).Trim();
            string wantVal = JsonUtil.GetString(step, "value", JsonUtil.GetString(step, "label", JsonUtil.GetString(step, "text", string.Empty))).Trim();
            if (string.IsNullOrEmpty(refId))
            {
                return ErrorResult("MISSING_REF", "select_option 缺少控件引用 ref");
            }
            if (string.IsNullOrEmpty(wantVal))
            {
                return ErrorResult("MISSING_VALUE", "select_option 缺少目标选项文本 value");
            }
            if (info.IsElectron)
            {
                return ErrorResult("ELECTRON_UIA_DISABLED", "Electron 窗口请通过 Chrome CUA 桥执行 select_option");
            }
            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            bool selected = false;
            int outX = 0;
            int outY = 0;
            string errCode = null;
            string errMsg = null;

            Thread mta = new Thread((ThreadStart)delegate
            {
                try
                {
                    string walkNote;
                    List<UiaMtaItem> items = WalkUiaTreeMta(hwnd, info.Rect, true, out walkNote);
                    UiaMtaItem target = null;
                    for (int i = 0; i < items.Count; i++)
                    {
                        if (string.Equals(items[i].RefId, refId, StringComparison.OrdinalIgnoreCase))
                        {
                            target = items[i];
                            break;
                        }
                    }
                    if (target == null || target.LiveElement == null)
                    {
                        errCode = "REF_NOT_FOUND";
                        errMsg = "未找到下拉控件引用: " + refId;
                        return;
                    }
                    Dictionary<string, object> tb = target.Dict["bounds"] as Dictionary<string, object>;
                    if (tb != null)
                    {
                        outX = Convert.ToInt32(tb["x"]) + Convert.ToInt32(tb["width"]) / 2;
                        outY = Convert.ToInt32(tb["y"]) + Convert.ToInt32(tb["height"]) / 2;
                    }

                    ExpandCollapsePattern ecp = null;
                    object pat;
                    if (target.LiveElement.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pat) && pat is ExpandCollapsePattern)
                    {
                        ecp = (ExpandCollapsePattern)pat;
                        ecp.Expand();
                        Thread.Sleep(60);
                    }

                    AutomationElementCollection subItems = target.LiveElement.FindAll(
                        TreeScope.Descendants,
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem));
                    AutomationElement partialMatch = null;
                    for (int i = 0; i < subItems.Count; i++)
                    {
                        AutomationElement sub = subItems[i];
                        string nm = sub.Current.Name ?? string.Empty;
                        if (string.Equals(nm.Trim(), wantVal, StringComparison.OrdinalIgnoreCase))
                        {
                            object sp;
                            if (sub.TryGetCurrentPattern(SelectionItemPattern.Pattern, out sp) && sp is SelectionItemPattern)
                            {
                                ((SelectionItemPattern)sp).Select();
                                selected = true;
                                break;
                            }
                        }
                        if (partialMatch == null && nm.IndexOf(wantVal, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            partialMatch = sub;
                        }
                    }
                    if (!selected && partialMatch != null)
                    {
                        object sp2;
                        if (partialMatch.TryGetCurrentPattern(SelectionItemPattern.Pattern, out sp2) && sp2 is SelectionItemPattern)
                        {
                            ((SelectionItemPattern)sp2).Select();
                            selected = true;
                        }
                    }

                    if (!selected)
                    {
                        try
                        {
                            Condition topPopupCond = new OrCondition(
                                new PropertyCondition(AutomationElement.ClassNameProperty, "ComboLBox"),
                                new AndCondition(
                                    new PropertyCondition(AutomationElement.ProcessIdProperty, (int)info.Pid),
                                    new OrCondition(
                                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.List),
                                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window),
                                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Pane),
                                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Menu)
                                    )
                                )
                            );
                            AutomationElementCollection topPopups = AutomationElement.RootElement.FindAll(TreeScope.Children, topPopupCond);
                            for (int pIdx = 0; pIdx < topPopups.Count && !selected; pIdx++)
                            {
                                AutomationElement popup = topPopups[pIdx];
                                if (popup == null) continue;
                                try
                                {
                                    if (popup.Current.IsOffscreen) continue;
                                    int popPid = popup.Current.ProcessId;
                                    if (popPid <= 0 || (info.Pid > 0 && popPid != (int)info.Pid)) continue;
                                    IntPtr popHwnd = new IntPtr(popup.Current.NativeWindowHandle);
                                    string popCls = popup.Current.ClassName ?? string.Empty;
                                    bool isOwnedPopup = popHwnd != IntPtr.Zero && (
                                        popHwnd == hwnd
                                        || NativeMethods.GetWindow(popHwnd, NativeMethods.GW_OWNER) == hwnd
                                        || NativeMethods.GetAncestor(popHwnd, NativeMethods.GA_ROOTOWNER) == hwnd
                                        || string.Equals(popCls, "ComboLBox", StringComparison.OrdinalIgnoreCase)
                                    );
                                    if (!isOwnedPopup) continue;
                                }
                                catch
                                {
                                    continue;
                                }
                                AutomationElementCollection popItems = popup.FindAll(
                                    TreeScope.Descendants,
                                    new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem));
                                for (int j = 0; j < popItems.Count; j++)
                                {
                                    AutomationElement itemEl = popItems[j];
                                    string nm = itemEl.Current.Name ?? string.Empty;
                                    if (string.Equals(nm.Trim(), wantVal, StringComparison.OrdinalIgnoreCase))
                                    {
                                        object spPop;
                                        if (itemEl.TryGetCurrentPattern(SelectionItemPattern.Pattern, out spPop) && spPop is SelectionItemPattern)
                                        {
                                            ((SelectionItemPattern)spPop).Select();
                                            selected = true;
                                            break;
                                        }
                                        object invPop;
                                        if (itemEl.TryGetCurrentPattern(InvokePattern.Pattern, out invPop) && invPop is InvokePattern)
                                        {
                                            ((InvokePattern)invPop).Invoke();
                                            selected = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        catch
                        {
                        }
                    }

                    if (!selected && target.LiveElement.TryGetCurrentPattern(ValuePattern.Pattern, out pat) && pat is ValuePattern)
                    {
                        ValuePattern vp = (ValuePattern)pat;
                        if (!vp.Current.IsReadOnly)
                        {
                            vp.SetValue(wantVal);
                            selected = true;
                        }
                    }

                    if (ecp != null)
                    {
                        try { ecp.Collapse(); } catch { }
                    }
                }
                catch (Exception ex)
                {
                    errMsg = ex.Message;
                }
            });
            mta.IsBackground = true;
            mta.SetApartmentState(ApartmentState.MTA);
            mta.Start();
            mta.Join(2400);

            if (!string.IsNullOrEmpty(errCode))
            {
                return ErrorResult(errCode, errMsg);
            }
            if (!selected)
            {
                return ErrorResult("OPTION_NOT_FOUND", errMsg ?? ("未能选中目标选项: " + wantVal));
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["op"] = "select_option";
            res["ref"] = refId;
            res["value"] = wantVal;
            res["x"] = outX;
            res["y"] = outY;
            res["delivery"] = "uia_select";
            res["mouseMode"] = mouseMode;
            res["physicalCursorMoved"] = false;
            res["focusStolen"] = false;
            return res;
        }

        private static Dictionary<string, object> ExecuteFocusRef(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            EscEmergencyGuard escGuard)
        {
            string refId = JsonUtil.GetString(step, "ref", string.Empty).Trim();
            if (string.IsNullOrEmpty(refId))
            {
                return ErrorResult("MISSING_REF", "focus_ref 缺少控件引用 ref");
            }
            if (info.IsElectron)
            {
                return ErrorResult("ELECTRON_UIA_DISABLED", "Electron 窗口启用了 0ms 防卡顿守卫，不支持 UIA SetFocus");
            }
            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            bool focused = false;
            Dictionary<string, object> matchedDict = null;
            string errNote = null;

            Thread mta = new Thread((ThreadStart)delegate
            {
                try
                {
                    string walkNote;
                    List<UiaMtaItem> items = WalkUiaTreeMta(hwnd, info.Rect, true, out walkNote);
                    for (int i = 0; i < items.Count; i++)
                    {
                        if (string.Equals(items[i].RefId, refId, StringComparison.OrdinalIgnoreCase))
                        {
                            matchedDict = items[i].Dict;
                            if (items[i].LiveElement != null)
                            {
                                items[i].LiveElement.SetFocus();
                                focused = true;
                            }
                            break;
                        }
                    }
                }
                catch (Exception ex)
                {
                    errNote = ex.Message;
                }
            });
            mta.IsBackground = true;
            mta.SetApartmentState(ApartmentState.MTA);
            mta.Start();
            mta.Join(2000);

            if (!focused)
            {
                return ErrorResult("FOCUS_REF_FAILED", errNote ?? ("未能聚焦指定控件: " + refId));
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["op"] = "focus_ref";
            res["ref"] = refId;
            res["element"] = matchedDict;
            return res;
        }

        private static Dictionary<string, object> ExecuteWaitFor(
            IntPtr hwnd,
            WindowInfo info,
            Dictionary<string, object> step,
            EscEmergencyGuard escGuard)
        {
            int waitMs = JsonUtil.GetInt(step, "ms", JsonUtil.GetInt(step, "timeoutMs", 500));
            if (waitMs < 0) waitMs = 0;
            if (waitMs > 30000) waitMs = 30000;
            string wantText = JsonUtil.GetString(step, "text", string.Empty).Trim();

            Stopwatch sw = Stopwatch.StartNew();
            bool matched = string.IsNullOrEmpty(wantText);
            long nextUiaPollMs = 0;

            while (sw.ElapsedMilliseconds < waitMs)
            {
                if (escGuard.IsEscTriggered())
                {
                    return EscAbortedResult();
                }

                if (!matched && !info.IsElectron && sw.ElapsedMilliseconds >= nextUiaPollMs && IsWindowResponsive(hwnd))
                {
                    string note;
                    List<Dictionary<string, object>> els = CollectUiaElementsMta(hwnd, info.Rect, out note);
                    for (int i = 0; i < els.Count; i++)
                    {
                        string nm = Convert.ToString(els[i]["name"] ?? string.Empty);
                        if (nm.IndexOf(wantText, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            matched = true;
                            break;
                        }
                    }
                    if (matched) break;
                    nextUiaPollMs = sw.ElapsedMilliseconds + 180;
                }

                int slice = (int)Math.Min(100, Math.Max(10, waitMs - sw.ElapsedMilliseconds));
                Thread.Sleep(slice);
            }

            if (escGuard.IsEscTriggered()) return EscAbortedResult();

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["op"] = "wait_for";
            res["matched"] = matched;
            res["elapsedMs"] = (int)sw.ElapsedMilliseconds;
            return res;
        }

        private static Dictionary<string, object> EscAbortedResult()
        {
            InputController.ReleaseAllModifiers();
            return ErrorResult("USER_ESC_ABORTED", "用户按下 Esc 紧急中断");
        }

        public static Dictionary<string, object> ErrorResult(string code, string message)
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = false;
            res["code"] = code ?? "WORKER_ERROR";
            res["error"] = message ?? "CUA worker error";
            return res;
        }
    }

    internal static class NativeMessagingRelay
    {
        private sealed class BrokerEndpointInfo
        {
            public string BaseUrl;
            public string Token;
        }

        private static volatile bool _stopping;
        private static readonly object StdoutLock = new object();

        public static int Run()
        {
            string sessionId = Guid.NewGuid().ToString("N");
            Stream stdin = Console.OpenStandardInput();
            Stream stdout = Console.OpenStandardOutput();

            BrokerEndpointInfo initialCfg = LoadBrokerConfig();
            if (initialCfg != null)
            {
                Dictionary<string, object> hello = new Dictionary<string, object>();
                hello["type"] = "nm_hello";
                hello["sessionId"] = sessionId;
                hello["pid"] = Process.GetCurrentProcess().Id;
                PostToBroker(initialCfg, "/v1/nm-push", JsonUtil.Serialize(hello), 1500, sessionId);
            }

            Thread pollThread = new Thread((ThreadStart)delegate
            {
                PollLoop(stdout, sessionId);
            });
            pollThread.IsBackground = true;
            pollThread.Start();

            byte[] lenBuf = new byte[4];
            try
            {
                while (!_stopping)
                {
                    int gotLen = ReadExact(stdin, lenBuf, 4);
                    if (gotLen == 0)
                    {
                        break;
                    }
                    if (gotLen < 4)
                    {
                        break;
                    }

                    uint msgLen = BitConverter.ToUInt32(lenBuf, 0);
                    if (msgLen == 0) continue;
                    if (msgLen > 8 * 1024 * 1024)
                    {
                        break;
                    }

                    byte[] payloadBuf = new byte[(int)msgLen];
                    int gotBody = ReadExact(stdin, payloadBuf, (int)msgLen);
                    if (gotBody < (int)msgLen)
                    {
                        break;
                    }

                    string rawJson = Encoding.UTF8.GetString(payloadBuf);
                    BrokerEndpointInfo cfg = LoadBrokerConfig();
                    if (cfg == null)
                    {
                        continue;
                    }

                    string respRaw = PostToBroker(cfg, "/v1/nm-push", rawJson, 4500, sessionId);
                    if (!string.IsNullOrEmpty(respRaw))
                    {
                        Dictionary<string, object> respDict = JsonUtil.DeserializeDict(respRaw);
                        object replyObj;
                        if (respDict.TryGetValue("reply", out replyObj) && replyObj != null)
                        {
                            WriteNativeMessage(stdout, JsonUtil.Serialize(replyObj));
                        }
                    }
                }
            }
            finally
            {
                _stopping = true;
                BrokerEndpointInfo byeCfg = LoadBrokerConfig();
                if (byeCfg != null)
                {
                    Dictionary<string, object> bye = new Dictionary<string, object>();
                    bye["type"] = "nm_disconnect";
                    bye["sessionId"] = sessionId;
                    PostToBroker(byeCfg, "/v1/nm-push", JsonUtil.Serialize(bye), 800, sessionId);
                }
            }
            return 0;
        }

        private static void PollLoop(Stream stdout, string sessionId)
        {
            Dictionary<string, object> pollBodyObj = new Dictionary<string, object>();
            pollBodyObj["sessionId"] = sessionId;
            string pollBody = JsonUtil.Serialize(pollBodyObj);

            while (!_stopping)
            {
                BrokerEndpointInfo cfg = LoadBrokerConfig();
                if (cfg == null)
                {
                    SleepInterruptible(1000);
                    continue;
                }

                string respRaw = PostToBroker(cfg, "/v1/nm-poll", pollBody, 22000, sessionId);
                if (string.IsNullOrEmpty(respRaw))
                {
                    SleepInterruptible(800);
                    continue;
                }

                Dictionary<string, object> respDict = JsonUtil.DeserializeDict(respRaw);
                object cmdsObj;
                if (respDict.TryGetValue("commands", out cmdsObj) && cmdsObj != null)
                {
                    IEnumerable list = cmdsObj as IEnumerable;
                    if (list != null && !(cmdsObj is string))
                    {
                        foreach (object cmd in list)
                        {
                            if (_stopping) break;
                            if (cmd != null)
                            {
                                WriteNativeMessage(stdout, JsonUtil.Serialize(cmd));
                            }
                        }
                    }
                }
            }
        }

        private static void SleepInterruptible(int totalMs)
        {
            int waited = 0;
            while (!_stopping && waited < totalMs)
            {
                Thread.Sleep(100);
                waited += 100;
            }
        }

        private static int ReadExact(Stream stream, byte[] buffer, int count)
        {
            int offset = 0;
            while (offset < count)
            {
                int n = stream.Read(buffer, offset, count - offset);
                if (n <= 0)
                {
                    return offset;
                }
                offset += n;
            }
            return offset;
        }

        private static void WriteNativeMessage(Stream stdout, string json)
        {
            if (string.IsNullOrEmpty(json)) return;
            byte[] utf8 = Encoding.UTF8.GetBytes(json);
            byte[] lenBytes = BitConverter.GetBytes((uint)utf8.Length);
            lock (StdoutLock)
            {
                stdout.Write(lenBytes, 0, 4);
                stdout.Write(utf8, 0, utf8.Length);
                stdout.Flush();
            }
        }

        private static string GetBrokerFilePath()
        {
            string envOverride = Environment.GetEnvironmentVariable("PRISM_CUA_BROKER_FILE");
            if (!string.IsNullOrEmpty(envOverride) && envOverride.Trim().Length > 0)
            {
                return envOverride.Trim();
            }
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(
                Path.Combine(Path.Combine(Path.Combine(profile, ".gemini"), "antigravity"), "prism-suite"),
                "cua-broker.json");
        }

        private static BrokerEndpointInfo LoadBrokerConfig()
        {
            try
            {
                string file = GetBrokerFilePath();
                if (!File.Exists(file)) return null;
                string raw = File.ReadAllText(file, Encoding.UTF8);
                Dictionary<string, object> dict = JsonUtil.DeserializeDict(raw);
                string token = JsonUtil.GetString(dict, "token", string.Empty).Trim();
                if (token.Length == 0) return null;

                string chosenEndpoint = null;
                object epObj;
                if (dict.TryGetValue("endpoints", out epObj) && epObj is IEnumerable && !(epObj is string))
                {
                    foreach (object item in (IEnumerable)epObj)
                    {
                        string ep = Convert.ToString(item ?? string.Empty).Trim().TrimEnd('/');
                        if (ep.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase))
                        {
                            chosenEndpoint = ep;
                            break;
                        }
                        if (chosenEndpoint == null && ep.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                        {
                            chosenEndpoint = ep;
                        }
                    }
                }
                if (string.IsNullOrEmpty(chosenEndpoint)) return null;

                BrokerEndpointInfo info = new BrokerEndpointInfo();
                info.BaseUrl = chosenEndpoint;
                info.Token = token;
                return info;
            }
            catch
            {
                return null;
            }
        }

        private static string PostToBroker(BrokerEndpointInfo cfg, string path, string jsonBody, int timeoutMs, string sessionId)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(cfg.BaseUrl + path);
                req.Method = "POST";
                req.Proxy = null;
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.ContentType = "application/json; charset=utf-8";
                req.Headers["Authorization"] = "Bearer " + cfg.Token;
                req.Headers["X-Prism-Relay-Session"] = sessionId;

                byte[] bodyBytes = Encoding.UTF8.GetBytes(jsonBody ?? "{}");
                req.ContentLength = bodyBytes.Length;
                using (Stream reqStream = req.GetRequestStream())
                {
                    reqStream.Write(bodyBytes, 0, bodyBytes.Length);
                }

                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (Stream respStream = resp.GetResponseStream())
                {
                    if (respStream == null) return string.Empty;
                    using (StreamReader reader = new StreamReader(respStream, Encoding.UTF8))
                    {
                        return reader.ReadToEnd();
                    }
                }
            }
            catch
            {
                return null;
            }
        }
    }

    internal sealed class ConsentScopeOption
    {
        public string ScopeType;
        public string Hwnd;
        public string WindowTitle;
        public string ProcessName;
        public object TabId;
        public string DisplayLabel;

        public override string ToString()
        {
            return DisplayLabel;
        }
    }

    internal sealed class ConsentDialogForm : Form
    {
        private readonly ComboBox _cmbScope;
        private readonly RadioButton _rbReadOnly;
        private readonly RadioButton _rbInteractive;
        private readonly ComboBox _cmbDuration;
        private readonly Button _btnReject;
        private readonly Button _btnApprove;
        private readonly System.Windows.Forms.Timer _countdownTimer;
        private readonly System.Windows.Forms.Timer _armGuardTimer;
        private readonly Stopwatch _shownWatch;

        private int _remainingSec = 45;
        private bool _approveArmed;
        public Dictionary<string, object> ResultPayload;

        public ConsentDialogForm(Dictionary<string, object> req)
        {
            _shownWatch = new Stopwatch();
            string workspace = JsonUtil.GetString(req, "workspace", "(当前会话)");
            if (workspace.Trim().Length == 0) workspace = "(当前会话)";
            string reason = JsonUtil.GetString(req, "reason", "AI 请求受控观察或操作桌面/浏览器界面");
            if (reason.Trim().Length == 0) reason = "AI 请求受控观察或操作桌面/浏览器界面";
            bool needAct = JsonUtil.GetBool(req, "needAct", false);
            string target = JsonUtil.GetString(req, "target", string.Empty).Trim().ToLowerInvariant();
            string reqHwnd = JsonUtil.GetString(req, "hwnd", string.Empty).Trim();
            object reqTabId = req != null && req.ContainsKey("tabId") ? req["tabId"] : null;
            int reqMinutes = JsonUtil.GetInt(req, "requestedMinutes", 15);

            float dpi = 1.0f;
            try
            {
                using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
                {
                    if (g.DpiX > 0) dpi = Math.Max(1.0f, Math.Min(3.5f, g.DpiX / 96f));
                }
            }
            catch { }
            Func<int, int> S = delegate(int px) { return (int)Math.Round(px * dpi); };

            AutoScaleMode = AutoScaleMode.None;
            Text = "Prism CUA 受控授权确认";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            TopMost = true;
            KeyPreview = true;
            ClientSize = new Size(S(520), S(404));
            BackColor = Color.FromArgb(248, 250, 252);
            Font = new Font("Microsoft YaHei UI", 9f, FontStyle.Regular);
            try
            {
                string selfExe = Application.ExecutablePath;
                if (!string.IsNullOrEmpty(selfExe) && File.Exists(selfExe))
                {
                    Icon = Icon.ExtractAssociatedIcon(selfExe);
                }
            }
            catch { }

            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = S(68);
            header.BackColor = Color.FromArgb(24, 26, 34);

            Label lblHeaderTitle = new Label();
            lblHeaderTitle.Text = "Prism CUA · 桌面与浏览器受控授权";
            lblHeaderTitle.ForeColor = Color.FromArgb(248, 250, 252);
            lblHeaderTitle.Font = new Font("Microsoft YaHei UI", 11f, FontStyle.Bold);
            lblHeaderTitle.AutoSize = true;
            lblHeaderTitle.Location = new Point(S(20), S(12));

            Label lblHeaderSub = new Label();
            lblHeaderSub.Text = "已自动屏蔽 Antigravity 自身窗口、系统凭据与受保护密钥目录 · 执行中按 Esc 立即中断";
            lblHeaderSub.ForeColor = Color.FromArgb(148, 163, 184);
            lblHeaderSub.Font = new Font("Microsoft YaHei UI", 8f, FontStyle.Regular);
            lblHeaderSub.AutoSize = true;
            lblHeaderSub.MaximumSize = new Size(S(480), 0);
            lblHeaderSub.Location = new Point(S(20), S(38));

            header.Controls.Add(lblHeaderTitle);
            header.Controls.Add(lblHeaderSub);
            Controls.Add(header);

            Label lblWsTitle = new Label();
            lblWsTitle.Text = "工作区：";
            lblWsTitle.ForeColor = Color.FromArgb(71, 85, 105);
            lblWsTitle.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Bold);
            lblWsTitle.AutoSize = true;
            lblWsTitle.Location = new Point(S(20), S(82));
            Controls.Add(lblWsTitle);

            Label lblWsVal = new Label();
            lblWsVal.Text = workspace;
            lblWsVal.ForeColor = Color.FromArgb(15, 23, 42);
            lblWsVal.AutoEllipsis = true;
            lblWsVal.Size = new Size(S(396), S(22));
            lblWsVal.Location = new Point(S(104), S(82));
            Controls.Add(lblWsVal);

            Label lblReasonTitle = new Label();
            lblReasonTitle.Text = "AI 申请说明（未经核实）：";
            lblReasonTitle.ForeColor = Color.FromArgb(71, 85, 105);
            lblReasonTitle.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Bold);
            lblReasonTitle.AutoSize = true;
            lblReasonTitle.Location = new Point(S(20), S(110));
            Controls.Add(lblReasonTitle);

            string reasonDisplay = reason.StartsWith("AI 申请说明（未经核实）：", StringComparison.Ordinal)
                ? reason
                : ("AI 申请说明（未经核实）：" + reason);

            TextBox txtReason = new TextBox();
            txtReason.Text = reasonDisplay;
            txtReason.ReadOnly = true;
            txtReason.Multiline = true;
            txtReason.ScrollBars = ScrollBars.Vertical;
            txtReason.BackColor = Color.White;
            txtReason.ForeColor = Color.FromArgb(30, 41, 59);
            txtReason.BorderStyle = BorderStyle.FixedSingle;
            txtReason.Location = new Point(S(20), S(134));
            txtReason.Size = new Size(S(480), S(56));
            txtReason.TabStop = false;
            Controls.Add(txtReason);

            Label lblScope = new Label();
            lblScope.Text = "授权范围：";
            lblScope.ForeColor = Color.FromArgb(71, 85, 105);
            lblScope.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Bold);
            lblScope.AutoSize = true;
            lblScope.Location = new Point(S(20), S(202));
            Controls.Add(lblScope);

            _cmbScope = new ComboBox();
            _cmbScope.DropDownStyle = ComboBoxStyle.DropDownList;
            _cmbScope.Location = new Point(S(104), S(198));
            _cmbScope.Size = new Size(S(396), S(28));
            PopulateScopeOptions(req, target, reqHwnd, reqTabId);
            Controls.Add(_cmbScope);

            Label lblPerm = new Label();
            lblPerm.Text = "权限级别：";
            lblPerm.ForeColor = Color.FromArgb(71, 85, 105);
            lblPerm.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Bold);
            lblPerm.AutoSize = true;
            lblPerm.Location = new Point(S(20), S(238));
            Controls.Add(lblPerm);

            _rbReadOnly = new RadioButton();
            _rbReadOnly.Text = "仅允许只读观察（截图与控件树）";
            _rbReadOnly.AutoSize = true;
            _rbReadOnly.Location = new Point(S(104), S(236));
            _rbReadOnly.Checked = !needAct;
            Controls.Add(_rbReadOnly);

            _rbInteractive = new RadioButton();
            _rbInteractive.Text = "允许观察与键鼠执行（按 Esc 可随时紧急中断）";
            _rbInteractive.AutoSize = true;
            _rbInteractive.Location = new Point(S(104), S(264));
            _rbInteractive.Checked = needAct;
            Controls.Add(_rbInteractive);

            Label lblDuration = new Label();
            lblDuration.Text = "有效时长：";
            lblDuration.ForeColor = Color.FromArgb(71, 85, 105);
            lblDuration.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Bold);
            lblDuration.AutoSize = true;
            lblDuration.Location = new Point(S(20), S(300));
            Controls.Add(lblDuration);

            _cmbDuration = new ComboBox();
            _cmbDuration.DropDownStyle = ComboBoxStyle.DropDownList;
            _cmbDuration.Location = new Point(S(104), S(296));
            _cmbDuration.Size = new Size(S(220), S(28));
            _cmbDuration.Items.Add("5 分钟");
            _cmbDuration.Items.Add("15 分钟 (推荐)");
            _cmbDuration.Items.Add("30 分钟");
            if (reqMinutes <= 7) _cmbDuration.SelectedIndex = 0;
            else if (reqMinutes >= 25) _cmbDuration.SelectedIndex = 2;
            else _cmbDuration.SelectedIndex = 1;
            Controls.Add(_cmbDuration);

            _btnReject = new Button();
            _btnReject.Text = "拒绝 (45s)";
            _btnReject.Size = new Size(S(130), S(38));
            _btnReject.Location = new Point(S(226), S(348));
            _btnReject.FlatStyle = FlatStyle.Flat;
            _btnReject.BackColor = Color.FromArgb(241, 245, 249);
            _btnReject.ForeColor = Color.FromArgb(51, 65, 85);
            _btnReject.Click += delegate { FinishRejected(false); };
            Controls.Add(_btnReject);

            _btnApprove = new Button();
            _btnApprove.Text = "授权开启";
            _btnApprove.Size = new Size(S(134), S(38));
            _btnApprove.Location = new Point(S(366), S(348));
            _btnApprove.FlatStyle = FlatStyle.Flat;
            _btnApprove.BackColor = Color.FromArgb(37, 99, 235);
            _btnApprove.ForeColor = Color.White;
            _btnApprove.Enabled = false;
            _btnApprove.Click += OnApproveClick;
            Controls.Add(_btnApprove);

            /* Accidental-keypress guard: AcceptButton stays null until 450ms after Shown */
            AcceptButton = null;
            CancelButton = _btnReject;

            _armGuardTimer = new System.Windows.Forms.Timer();
            _armGuardTimer.Interval = 450;
            _armGuardTimer.Tick += delegate
            {
                _armGuardTimer.Stop();
                _approveArmed = true;
                _btnApprove.Enabled = true;
                AcceptButton = _btnApprove;
            };

            _countdownTimer = new System.Windows.Forms.Timer();
            _countdownTimer.Interval = 1000;
            _countdownTimer.Tick += delegate
            {
                _remainingSec--;
                if (_remainingSec <= 0)
                {
                    _countdownTimer.Stop();
                    FinishRejected(true);
                    return;
                }
                _btnReject.Text = "拒绝 (" + _remainingSec.ToString() + "s)";
            };

            ResultPayload = BuildRejectedPayload(false);
        }

        private void PopulateScopeOptions(Dictionary<string, object> req, string target, string reqHwnd, object reqTabId)
        {
            List<ConsentScopeOption> options = new List<ConsentScopeOption>();
            int selectedIdx = -1;
            string reqProc = JsonUtil.GetString(req, "processName", string.Empty).Trim();
            string reqTitleSub = JsonUtil.GetString(req, "titleContains", string.Empty).Trim();

            List<WindowInfo> liveWins = WindowSecurity.EnumerateSafeTopWindows();
            for (int i = 0; i < liveWins.Count; i++)
            {
                WindowInfo w = liveWins[i];
                ConsentScopeOption opt = new ConsentScopeOption();
                opt.ScopeType = "window";
                opt.Hwnd = w.HwndHex;
                opt.WindowTitle = w.Title;
                opt.ProcessName = w.ProcessName;
                opt.DisplayLabel = "指定窗口：" + TruncateForCombo(w.Title, 32) + " (" + w.ProcessName + ")";
                options.Add(opt);

                if (!string.IsNullOrEmpty(reqHwnd) && WindowSecurity.ParseHwnd(reqHwnd) == w.Hwnd)
                {
                    selectedIdx = options.Count - 1;
                }
                else if (selectedIdx < 0 && (!string.IsNullOrEmpty(reqProc) || !string.IsNullOrEmpty(reqTitleSub)))
                {
                    bool procMatch = string.IsNullOrEmpty(reqProc)
                        || ((w.ProcessName ?? string.Empty).IndexOf(reqProc, StringComparison.OrdinalIgnoreCase) >= 0);
                    bool titleMatch = string.IsNullOrEmpty(reqTitleSub)
                        || ((w.Title ?? string.Empty).IndexOf(reqTitleSub, StringComparison.OrdinalIgnoreCase) >= 0);
                    if (procMatch && titleMatch)
                    {
                        selectedIdx = options.Count - 1;
                    }
                }
            }

            ConsentScopeOption tabOpt = new ConsentScopeOption();
            tabOpt.ScopeType = "browser_tab";
            tabOpt.TabId = reqTabId;
            tabOpt.DisplayLabel = reqTabId != null
                ? ("已武装的浏览器标签页 (Tab #" + Convert.ToString(reqTabId) + ")")
                : "已武装的浏览器标签页 (Armed Browser Tab)";
            options.Add(tabOpt);
            if (selectedIdx < 0 && (target == "browser" || target == "browser_tab" || reqTabId != null))
            {
                selectedIdx = options.Count - 1;
            }

            ConsentScopeOption desktopOpt = new ConsentScopeOption();
            desktopOpt.ScopeType = "desktop_safe";
            desktopOpt.DisplayLabel = "桌面安全窗口（自动屏蔽 Antigravity / 凭据 / 密钥）";
            options.Add(desktopOpt);
            if (selectedIdx < 0)
            {
                selectedIdx = liveWins.Count > 0 ? 0 : 0;
            }

            for (int i = 0; i < options.Count; i++)
            {
                _cmbScope.Items.Add(options[i]);
            }
            if (_cmbScope.Items.Count > 0)
            {
                _cmbScope.SelectedIndex = Math.Max(0, Math.Min(_cmbScope.Items.Count - 1, selectedIdx));
            }
        }

        private static string TruncateForCombo(string s, int maxLen)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            if (s.Length <= maxLen) return s;
            return s.Substring(0, maxLen) + "...";
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            _shownWatch.Start();
            _btnReject.Focus();
            _armGuardTimer.Start();
            _countdownTimer.Start();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (!_approveArmed || _shownWatch.ElapsedMilliseconds < 450)
            {
                if (e.KeyCode == Keys.Enter || e.KeyCode == Keys.Space)
                {
                    e.Handled = true;
                    e.SuppressKeyPress = true;
                    return;
                }
            }
            base.OnKeyDown(e);
        }

        private void OnApproveClick(object sender, EventArgs e)
        {
            if (!_approveArmed || _shownWatch.ElapsedMilliseconds < 450)
            {
                return;
            }
            _countdownTimer.Stop();
            _armGuardTimer.Stop();

            int durationMinutes = 15;
            if (_cmbDuration.SelectedIndex == 0) durationMinutes = 5;
            else if (_cmbDuration.SelectedIndex == 2) durationMinutes = 30;

            ConsentScopeOption chosen = _cmbScope.SelectedItem as ConsentScopeOption;
            Dictionary<string, object> scopeDict = new Dictionary<string, object>();
            if (chosen != null)
            {
                scopeDict["type"] = chosen.ScopeType;
                scopeDict["hwnd"] = chosen.Hwnd;
                scopeDict["title"] = chosen.WindowTitle;
                scopeDict["processName"] = chosen.ProcessName;
                scopeDict["tabId"] = chosen.TabId;
            }
            else
            {
                scopeDict["type"] = "desktop_safe";
            }

            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["granted"] = true;
            res["state"] = _rbInteractive.Checked ? "ARMED_INTERACTIVE" : "ARMED_READONLY";
            res["durationMinutes"] = durationMinutes;
            res["scope"] = scopeDict;
            ResultPayload = res;

            DialogResult = DialogResult.OK;
            Close();
        }

        private void FinishRejected(bool timedOut)
        {
            _countdownTimer.Stop();
            _armGuardTimer.Stop();
            ResultPayload = BuildRejectedPayload(timedOut);
            DialogResult = DialogResult.Cancel;
            Close();
        }

        private static Dictionary<string, object> BuildRejectedPayload(bool timedOut)
        {
            Dictionary<string, object> res = new Dictionary<string, object>();
            res["ok"] = true;
            res["granted"] = false;
            res["timedOut"] = timedOut;
            res["state"] = "DISARMED";
            return res;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _countdownTimer.Dispose();
                _armGuardTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal sealed class OverlayPillForm : Form
    {
        private string _visualState = "ARMED";
        private Rectangle _btnPrimaryRect = Rectangle.Empty;
        private Rectangle _btnSecondaryRect = Rectangle.Empty;
        private string _btnPrimaryAction = "REVOKE";
        private string _btnSecondaryAction = null;
        private bool _dragging;
        private int _dragStartMouseX;
        private int _dragStartFormX;

        private float _pillDpi = 1.0f;
        private int SP(int px) { return (int)Math.Round(px * _pillDpi); }

        public OverlayPillForm()
        {
            try
            {
                using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
                {
                    if (g.DpiX > 0) _pillDpi = Math.Max(1.0f, Math.Min(3.5f, g.DpiX / 96f));
                }
            }
            catch { }
            AutoScaleMode = AutoScaleMode.None;
            Text = "PrismCuaOverlayPill";
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            DoubleBuffered = true;
            BackColor = Color.FromArgb(22, 25, 34);
            ForeColor = Color.White;
            Height = SP(30);
            Width = SP(316);

            PositionTopCenterRight();
            ApplyRoundedRegion();
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= NativeMethods.WS_EX_NOACTIVATE
                    | NativeMethods.WS_EX_TOOLWINDOW
                    | NativeMethods.WS_EX_TOPMOST;
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeMethods.WM_MOUSEACTIVATE)
            {
                m.Result = new IntPtr(NativeMethods.MA_NOACTIVATE);
                return;
            }
            base.WndProc(ref m);
        }

        private void PositionTopCenterRight()
        {
            Rectangle wa = Screen.PrimaryScreen != null
                ? Screen.PrimaryScreen.WorkingArea
                : new Rectangle(0, 0, 1280, 800);
            int targetX = wa.Left + (int)(wa.Width * 0.64) - (Width / 2);
            if (targetX + Width > wa.Right - 12) targetX = wa.Right - Width - 12;
            if (targetX < wa.Left + 12) targetX = wa.Left + 12;
            Location = new Point(targetX, wa.Top + 6);
        }

        private void ApplyRoundedRegion()
        {
            IntPtr hRgn = NativeMethods.CreateRoundRectRgn(0, 0, Width + 1, Height + 1, SP(30), SP(30));
            if (hRgn != IntPtr.Zero)
            {
                Region prevRegion = Region;
                try
                {
                    Region = Region.FromHrgn(hRgn);
                }
                finally
                {
                    NativeMethods.DeleteObject(hRgn);
                }
                if (prevRegion != null)
                {
                    prevRegion.Dispose();
                }
            }
        }

        public void ApplyStateUpdate(string stateName)
        {
            string upper = (stateName ?? string.Empty).Trim().ToUpperInvariant();
            if (upper == "EXIT" || upper == "DISARMED")
            {
                Close();
                return;
            }
            if (upper == "ARMED_READONLY" || upper == "ARMED_INTERACTIVE")
            {
                upper = "ARMED";
            }
            if (upper != "ARMED" && upper != "EXECUTING" && upper != "PAUSED_HANDOFF")
            {
                return;
            }

            _visualState = upper;
            int oldWidth = Width;
            int center = Left + oldWidth / 2;
            if (_visualState == "PAUSED_HANDOFF")
            {
                Width = SP(362);
            }
            else if (_visualState == "EXECUTING")
            {
                Width = SP(338);
            }
            else
            {
                Width = SP(292);
            }
            if (Width != oldWidth)
            {
                Rectangle wa = Screen.PrimaryScreen != null
                    ? Screen.PrimaryScreen.WorkingArea
                    : new Rectangle(0, 0, 1280, 800);
                int nx = Math.Max(wa.Left + 8, Math.Min(wa.Right - Width - 8, center - Width / 2));
                Left = nx;
                ApplyRoundedRegion();
            }
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;

            Color dotColor = Color.FromArgb(34, 197, 94);
            Color borderColor = Color.FromArgb(65, 34, 197, 94);
            string statusText = "Prism CUA 已授权";
            _btnPrimaryRect = Rectangle.Empty;
            _btnSecondaryRect = Rectangle.Empty;
            _btnPrimaryAction = "REVOKE";
            _btnSecondaryAction = null;

            if (_visualState == "EXECUTING")
            {
                dotColor = Color.FromArgb(59, 130, 246);
                borderColor = Color.FromArgb(95, 59, 130, 246);
                statusText = "正在执行 · 按 Esc 立即中断";
            }
            else if (_visualState == "PAUSED_HANDOFF")
            {
                dotColor = Color.FromArgb(249, 115, 22);
                borderColor = Color.FromArgb(95, 249, 115, 22);
                statusText = "等待人工处理";
            }

            using (Pen borderPen = new Pen(borderColor, 1.2f))
            {
                g.DrawRectangle(borderPen, 1, 1, Width - 3, Height - 3);
            }

            using (Brush dotBrush = new SolidBrush(dotColor))
            {
                int dotD = SP(10);
                g.FillEllipse(dotBrush, SP(11), (Height - dotD) / 2, dotD, dotD);
            }

            using (Font fText = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular))
            using (Font fBtn = new Font("Microsoft YaHei UI", 8f, FontStyle.Bold))
            using (Brush fgText = new SolidBrush(Color.FromArgb(241, 245, 249)))
            {
                SizeF txtSz = g.MeasureString(statusText, fText);
                g.DrawString(statusText, fText, fgText, SP(26), Math.Max(1f, (Height - txtSz.Height) / 2f));

                int btnW = SP(54);
                int btnH = SP(22);
                int btnY = (Height - btnH) / 2;

                if (_visualState == "PAUSED_HANDOFF")
                {
                    _btnSecondaryRect = new Rectangle(Width - btnW * 2 - SP(14), btnY, btnW, btnH);
                    _btnSecondaryAction = "RESUME";
                    DrawPillButton(g, _btnSecondaryRect, "继续", Color.FromArgb(34, 197, 94), fBtn);

                    _btnPrimaryRect = new Rectangle(Width - btnW - SP(8), btnY, btnW, btnH);
                    _btnPrimaryAction = "REVOKE";
                    DrawPillButton(g, _btnPrimaryRect, "终止", Color.FromArgb(239, 68, 68), fBtn);
                }
                else
                {
                    string btnLabel = _visualState == "EXECUTING" ? "中断" : "收回";
                    Color btnColor = _visualState == "EXECUTING" ? Color.FromArgb(59, 130, 246) : Color.FromArgb(71, 85, 105);
                    _btnPrimaryRect = new Rectangle(Width - btnW - SP(8), btnY, btnW, btnH);
                    _btnPrimaryAction = "REVOKE";
                    DrawPillButton(g, _btnPrimaryRect, btnLabel, btnColor, fBtn);
                }
            }
        }

        private static void DrawPillButton(Graphics g, Rectangle rect, string text, Color bg, Font font)
        {
            using (Brush b = new SolidBrush(bg))
            using (Brush fg = new SolidBrush(Color.White))
            {
                g.FillRectangle(b, rect);
                SizeF sz = g.MeasureString(text, font);
                float tx = rect.X + (rect.Width - sz.Width) / 2f;
                float ty = rect.Y + (rect.Height - sz.Height) / 2f;
                g.DrawString(text, font, fg, tx, ty);
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;

            if (!_btnPrimaryRect.IsEmpty && _btnPrimaryRect.Contains(e.Location) && !string.IsNullOrEmpty(_btnPrimaryAction))
            {
                EmitOverlayAction(_btnPrimaryAction);
                return;
            }
            if (!_btnSecondaryRect.IsEmpty && _btnSecondaryRect.Contains(e.Location) && !string.IsNullOrEmpty(_btnSecondaryAction))
            {
                EmitOverlayAction(_btnSecondaryAction);
                return;
            }

            _dragging = true;
            _dragStartMouseX = Cursor.Position.X;
            _dragStartFormX = Left;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (_dragging)
            {
                int deltaX = Cursor.Position.X - _dragStartMouseX;
                Left = _dragStartFormX + deltaX;
            }
            else
            {
                bool overBtn = (!_btnPrimaryRect.IsEmpty && _btnPrimaryRect.Contains(e.Location))
                    || (!_btnSecondaryRect.IsEmpty && _btnSecondaryRect.Contains(e.Location));
                Cursor = overBtn ? Cursors.Hand : Cursors.Default;
            }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            _dragging = false;
        }

        private static void EmitOverlayAction(string action)
        {
            try
            {
                Dictionary<string, object> evt = new Dictionary<string, object>();
                evt["action"] = action;
                Program.WriteJsonLine(evt);
            }
            catch
            {
            }
        }
    }

    internal sealed class VirtualCursorForm : Form
    {
        private const int CanvasSize = 64;
        private const int HotspotX = 14;
        private const int HotspotY = 14;

        private readonly System.Windows.Forms.Timer _animTimer;
        private double _startX;
        private double _startY;
        private double _curX;
        private double _curY;
        private double _targetX;
        private double _targetY;
        private bool _hasLastPos;
        private int _stepIndex;
        private string _currentOp = "click";

        public VirtualCursorForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            Width = CanvasSize;
            Height = CanvasSize;
            Location = new Point(-32000, -32000);

            _animTimer = new System.Windows.Forms.Timer();
            _animTimer.Interval = 16;
            _animTimer.Tick += OnAnimTick;
        }

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= NativeMethods.WS_EX_LAYERED
                    | NativeMethods.WS_EX_TRANSPARENT
                    | NativeMethods.WS_EX_NOACTIVATE
                    | NativeMethods.WS_EX_TOOLWINDOW
                    | NativeMethods.WS_EX_TOPMOST;
                return cp;
            }
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeMethods.WM_MOUSEACTIVATE)
            {
                m.Result = new IntPtr(NativeMethods.MA_NOACTIVATE);
                return;
            }
            base.WndProc(ref m);
        }

        public void TriggerPulse(int screenX, int screenY, string op)
        {
            if (IsDisposed) return;
            int vx = NativeMethods.GetSystemMetrics(NativeMethods.SM_XVIRTUALSCREEN);
            int vy = NativeMethods.GetSystemMetrics(NativeMethods.SM_YVIRTUALSCREEN);
            int vw = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SM_CXVIRTUALSCREEN));
            int vh = Math.Max(1, NativeMethods.GetSystemMetrics(NativeMethods.SM_CYVIRTUALSCREEN));

            int clampedX = Math.Max(vx, Math.Min(vx + vw - 1, screenX));
            int clampedY = Math.Max(vy, Math.Min(vy + vh - 1, screenY));

            if (!_hasLastPos || !Visible)
            {
                _startX = clampedX - 34;
                _startY = clampedY + 26;
                _curX = _startX;
                _curY = _startY;
                _hasLastPos = true;
            }
            else
            {
                _startX = _curX;
                _startY = _curY;
            }

            _targetX = clampedX;
            _targetY = clampedY;
            _currentOp = (op ?? "click").Trim().ToLowerInvariant();
            _stepIndex = 0;

            if (!Visible)
            {
                Show();
            }
            RenderLayeredFrame(1.0f, 0.0f);
            _animTimer.Start();
        }

        public void HideImmediate()
        {
            _animTimer.Stop();
            _hasLastPos = false;
            if (!IsDisposed && Visible)
            {
                Hide();
            }
        }

        private void OnAnimTick(object sender, EventArgs e)
        {
            if (IsDisposed)
            {
                _animTimer.Stop();
                return;
            }

            _stepIndex++;
            if (_stepIndex <= 7)
            {
                double t = (double)_stepIndex / 7.0;
                double ease = 1.0 - Math.Pow(1.0 - t, 3.0);
                _curX = _startX + (_targetX - _startX) * ease;
                _curY = _startY + (_targetY - _startY) * ease;
                RenderLayeredFrame(1.0f, 0.0f);
            }
            else if (_stepIndex <= 17)
            {
                _curX = _targetX;
                _curY = _targetY;
                float ripple = (float)(_stepIndex - 7) / 10.0f;
                RenderLayeredFrame(1.0f, ripple);
            }
            else if (_stepIndex <= 40)
            {
                RenderLayeredFrame(0.92f, 0.0f);
            }
            else if (_stepIndex <= 52)
            {
                float alpha = Math.Max(0.0f, 0.92f * (1.0f - (float)(_stepIndex - 40) / 12.0f));
                RenderLayeredFrame(alpha, 0.0f);
            }
            else
            {
                _animTimer.Stop();
                if (Visible) Hide();
            }
        }

        private void RenderLayeredFrame(float masterAlpha, float rippleProgress)
        {
            if (IsDisposed || !IsHandleCreated) return;
            int curAlpha = Math.Max(0, Math.Min(255, (int)Math.Round(255f * masterAlpha)));
            if (curAlpha <= 1) return;

            int accentR = 56;
            int accentG = 189;
            int accentB = 248;
            int fillR = 37;
            int fillG = 99;
            int fillB = 235;
            if (_currentOp == "type_text")
            {
                accentR = 167; accentG = 139; accentB = 250;
                fillR = 124; fillG = 58; fillB = 237;
            }
            else if (_currentOp == "scroll")
            {
                accentR = 52; accentG = 211; accentB = 153;
                fillR = 5; fillG = 150; fillB = 105;
            }

            using (Bitmap bmp = new Bitmap(CanvasSize, CanvasSize, PixelFormat.Format32bppArgb))
            {
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.Clear(Color.Transparent);

                    if (rippleProgress > 0.01f)
                    {
                        float r = 4f + rippleProgress * 18f;
                        int ripAlpha = Math.Max(0, Math.Min(255, (int)Math.Round(220f * (1f - rippleProgress) * masterAlpha)));
                        if (ripAlpha > 2)
                        {
                            using (Pen ripPen = new Pen(Color.FromArgb(ripAlpha, accentR, accentG, accentB), 2.2f))
                            {
                                g.DrawEllipse(ripPen, HotspotX - r, HotspotY - r, r * 2f, r * 2f);
                            }
                        }
                    }

                    int glowAlpha = Math.Max(0, Math.Min(255, (int)Math.Round(70f * masterAlpha)));
                    using (Brush glowBrush = new SolidBrush(Color.FromArgb(glowAlpha, accentR, accentG, accentB)))
                    {
                        g.FillEllipse(glowBrush, HotspotX - 7, HotspotY - 7, 14, 14);
                    }

                    PointF[] arrow = new PointF[]
                    {
                        new PointF(HotspotX, HotspotY),
                        new PointF(HotspotX, HotspotY + 21f),
                        new PointF(HotspotX + 5.5f, HotspotY + 16.2f),
                        new PointF(HotspotX + 9.5f, HotspotY + 24.5f),
                        new PointF(HotspotX + 13.2f, HotspotY + 22.8f),
                        new PointF(HotspotX + 9.2f, HotspotY + 14.5f),
                        new PointF(HotspotX + 16.5f, HotspotY + 14.5f)
                    };

                    using (Brush fillBrush = new SolidBrush(Color.FromArgb(curAlpha, fillR, fillG, fillB)))
                    using (Pen outlinePen = new Pen(Color.FromArgb(curAlpha, 248, 250, 252), 1.6f))
                    {
                        outlinePen.LineJoin = LineJoin.Round;
                        g.FillPolygon(fillBrush, arrow);
                        g.DrawPolygon(outlinePen, arrow);
                    }

                    Rectangle badgeRect = new Rectangle(HotspotX + 14, HotspotY + 21, 22, 13);
                    using (Brush badgeBg = new SolidBrush(Color.FromArgb(Math.Min(235, curAlpha), 15, 23, 42)))
                    using (Pen badgeBorder = new Pen(Color.FromArgb(curAlpha, accentR, accentG, accentB), 1f))
                    using (Brush badgeFg = new SolidBrush(Color.FromArgb(curAlpha, 241, 245, 249)))
                    using (Font badgeFont = new Font("Segoe UI", 6.5f, FontStyle.Bold))
                    {
                        g.FillRectangle(badgeBg, badgeRect);
                        g.DrawRectangle(badgeBorder, badgeRect);
                        g.DrawString("AI", badgeFont, badgeFg, badgeRect.X + 4f, badgeRect.Y + 0.5f);
                    }
                }

                IntPtr screenDc = NativeMethods.GetDC(IntPtr.Zero);
                if (screenDc == IntPtr.Zero) return;
                IntPtr memDc = NativeMethods.CreateCompatibleDC(screenDc);
                IntPtr hBitmap = IntPtr.Zero;
                IntPtr oldBitmap = IntPtr.Zero;
                try
                {
                    hBitmap = bmp.GetHbitmap(Color.FromArgb(0));
                    oldBitmap = NativeMethods.SelectObject(memDc, hBitmap);
                    NativeMethods.POINT dstPt = new NativeMethods.POINT();
                    dstPt.X = (int)Math.Round(_curX) - HotspotX;
                    dstPt.Y = (int)Math.Round(_curY) - HotspotY;
                    NativeMethods.SIZE sz = new NativeMethods.SIZE();
                    sz.cx = CanvasSize;
                    sz.cy = CanvasSize;
                    NativeMethods.POINT srcPt = new NativeMethods.POINT();
                    srcPt.X = 0;
                    srcPt.Y = 0;
                    NativeMethods.BLENDFUNCTION blend = new NativeMethods.BLENDFUNCTION();
                    blend.BlendOp = NativeMethods.AC_SRC_OVER;
                    blend.BlendFlags = 0;
                    blend.SourceConstantAlpha = 255;
                    blend.AlphaFormat = NativeMethods.AC_SRC_ALPHA;
                    NativeMethods.UpdateLayeredWindow(
                        Handle,
                        screenDc,
                        ref dstPt,
                        ref sz,
                        memDc,
                        ref srcPt,
                        0,
                        ref blend,
                        NativeMethods.ULW_ALPHA);
                }
                finally
                {
                    if (oldBitmap != IntPtr.Zero) NativeMethods.SelectObject(memDc, oldBitmap);
                    if (hBitmap != IntPtr.Zero) NativeMethods.DeleteObject(hBitmap);
                    if (memDc != IntPtr.Zero) NativeMethods.DeleteDC(memDc);
                    NativeMethods.ReleaseDC(IntPtr.Zero, screenDc);
                }
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _animTimer.Stop();
                _animTimer.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal static class Program
    {
        private static IntPtr _selfJobHandle = IntPtr.Zero;
        private static readonly object TextStdoutLock = new object();
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);

        [STAThread]
        private static int Main(string[] args)
        {
            ConfigureDpiAwareness();

            int parentPid = ParseIntArg(args, "--parent-pid", 0);
            SetupOrphanProtection(parentPid);

            if (IsNativeMessagingRelayInvocation(args))
            {
                return NativeMessagingRelay.Run();
            }

            if (HasFlag(args, "--version") || HasFlag(args, "--self-check"))
            {
                Dictionary<string, object> ver = new Dictionary<string, object>();
                ver["ok"] = true;
                ver["version"] = "0.9.5";
                ver["platform"] = "win32";
                WriteJsonLine(ver);
                return 0;
            }

            if (HasFlag(args, "--release-modifiers"))
            {
                InputController.ReleaseAllModifiers();
                Dictionary<string, object> rel = new Dictionary<string, object>();
                rel["ok"] = true;
                rel["released"] = true;
                WriteJsonLine(rel);
                return 0;
            }

            if (HasFlag(args, "--consent"))
            {
                return RunConsentMode();
            }

            if (HasFlag(args, "--overlay"))
            {
                return RunOverlayMode();
            }

            string subCmd = ParseStringArg(args, "--cmd", string.Empty).Trim().ToLowerInvariant();
            if (subCmd.Length > 0)
            {
                return RunWorkerSubCommand(subCmd);
            }

            WriteJsonLine(DesktopWorker.ErrorResult("INVALID_ARGS", "未指定有效的运行模式 (--nm-relay | --consent | --overlay | --cmd)"));
            return 1;
        }

        private static void ConfigureDpiAwareness()
        {
            try
            {
                if (NativeMethods.SetProcessDpiAwarenessContext(NativeMethods.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
                {
                    return;
                }
            }
            catch
            {
            }
            try
            {
                NativeMethods.SetProcessDPIAware();
            }
            catch
            {
            }
        }

        private static void SetupOrphanProtection(int parentPid)
        {
            try
            {
                IntPtr hJob = NativeMethods.CreateJobObjectW(IntPtr.Zero, null);
                if (hJob != IntPtr.Zero)
                {
                    NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                    info.BasicLimitInformation.LimitFlags = NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                    int size = Marshal.SizeOf(typeof(NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
                    IntPtr ptr = Marshal.AllocHGlobal(size);
                    try
                    {
                        Marshal.StructureToPtr(info, ptr, false);
                        if (NativeMethods.SetInformationJobObject(hJob, NativeMethods.JobObjectExtendedLimitInformation, ptr, (uint)size))
                        {
                            if (NativeMethods.AssignProcessToJobObject(hJob, Process.GetCurrentProcess().Handle))
                            {
                                _selfJobHandle = hJob;
                            }
                            else
                            {
                                NativeMethods.CloseHandle(hJob);
                            }
                        }
                        else
                        {
                            NativeMethods.CloseHandle(hJob);
                        }
                    }
                    finally
                    {
                        Marshal.FreeHGlobal(ptr);
                    }
                }
            }
            catch
            {
            }

            if (parentPid > 0)
            {
                IntPtr hParent = NativeMethods.OpenProcess(NativeMethods.SYNCHRONIZE, false, (uint)parentPid);
                if (hParent != IntPtr.Zero)
                {
                    Thread watcher = new Thread((ThreadStart)delegate
                    {
                        try
                        {
                            NativeMethods.WaitForSingleObject(hParent, NativeMethods.INFINITE);
                        }
                        finally
                        {
                            NativeMethods.CloseHandle(hParent);
                        }
                        try
                        {
                            InputController.ReleaseAllModifiers();
                        }
                        catch
                        {
                        }
                        Environment.Exit(0);
                    });
                    watcher.IsBackground = true;
                    watcher.Start();
                }
            }
        }

        private static bool IsNativeMessagingRelayInvocation(string[] args)
        {
            if (args == null) return false;
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i] ?? string.Empty;
                if (string.Equals(a, "--nm-relay", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
                if (a.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase)
                    || a.StartsWith("extension://", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool HasFlag(string[] args, string flag)
        {
            if (args == null) return false;
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static string ParseStringArg(string[] args, string flag, string fallback)
        {
            if (args == null) return fallback;
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase))
                {
                    return args[i + 1] ?? fallback;
                }
            }
            return fallback;
        }

        private static int ParseIntArg(string[] args, string flag, int fallback)
        {
            string raw = ParseStringArg(args, flag, null);
            if (string.IsNullOrEmpty(raw)) return fallback;
            int val;
            if (int.TryParse(raw.Trim(), out val)) return val;
            return fallback;
        }

        private static Dictionary<string, object> ReadStdinJsonDict()
        {
            try
            {
                Stream s = Console.OpenStandardInput();
                if (s != null && s != Stream.Null)
                {
                    using (StreamReader reader = new StreamReader(s, Utf8NoBom, true, 4096, true))
                    {
                        string raw = reader.ReadToEnd();
                        return JsonUtil.DeserializeDict(raw);
                    }
                }
            }
            catch
            {
            }
            return new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        }

        internal static void WriteJsonLine(object obj)
        {
            try
            {
                string line = JsonUtil.Serialize(obj) + "\n";
                byte[] bytes = Utf8NoBom.GetBytes(line);
                lock (TextStdoutLock)
                {
                    Stream s = Console.OpenStandardOutput();
                    if (s != null && s != Stream.Null)
                    {
                        s.Write(bytes, 0, bytes.Length);
                        s.Flush();
                    }
                }
            }
            catch
            {
            }
        }

        private static int RunConsentMode()
        {
            Dictionary<string, object> req = ReadStdinJsonDict();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (ConsentDialogForm dlg = new ConsentDialogForm(req))
            {
                Application.Run(dlg);
                WriteJsonLine(dlg.ResultPayload);
            }
            return 0;
        }

        private static int RunOverlayMode()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (OverlayPillForm pill = new OverlayPillForm())
            using (VirtualCursorForm vcursor = new VirtualCursorForm())
            {
                vcursor.Text = "PrismCuaVirtualCursor";
                EscEmergencyGuard overlayEscGuard = null;
                System.Windows.Forms.Timer escPollTimer = null;
                bool escEmitted = false;
                bool escSuspended = false;

                ThreadStart emitEscOnce = delegate
                {
                    if (escEmitted || escSuspended) return;
                    escEmitted = true;
                    if (escPollTimer != null) escPollTimer.Stop();
                    if (overlayEscGuard != null) overlayEscGuard.TemporarilySuspendHotKey();
                    try
                    {
                        InputController.ReleaseAllModifiers();
                    }
                    catch
                    {
                    }
                    lock (TextStdoutLock)
                    {
                        Console.Out.WriteLine("{\"event\":\"user_esc_aborted\"}");
                        Console.Out.Flush();
                    }
                };

                overlayEscGuard = new EscEmergencyGuard(emitEscOnce);
                escPollTimer = new System.Windows.Forms.Timer();
                escPollTimer.Interval = 45;
                escPollTimer.Tick += delegate
                {
                    if (!escEmitted && !escSuspended && overlayEscGuard != null && overlayEscGuard.IsEscTriggered())
                    {
                        emitEscOnce();
                    }
                };

                try
                {
                    Thread stdinThread = new Thread((ThreadStart)delegate
                    {
                        try
                        {
                            Stream s = Console.OpenStandardInput();
                            if (s != null && s != Stream.Null)
                            {
                                using (StreamReader reader = new StreamReader(s, Utf8NoBom, true, 1024, true))
                                {
                                    string line;
                                    while ((line = reader.ReadLine()) != null)
                                    {
                                        string trimmed = line.Trim();
                                        if (trimmed.Length == 0) continue;

                                        string nextState = trimmed;
                                        int vx = -99999;
                                        int vy = -99999;
                                        string vop = "click";
                                        if (trimmed.StartsWith("{", StringComparison.Ordinal))
                                        {
                                            Dictionary<string, object> d = JsonUtil.DeserializeDict(trimmed);
                                            nextState = JsonUtil.GetString(d, "state", string.Empty);
                                            if (string.IsNullOrEmpty(nextState))
                                            {
                                                nextState = JsonUtil.GetString(d, "cmd", "ARMED");
                                            }
                                            vx = JsonUtil.GetInt(d, "x", -99999);
                                            vy = JsonUtil.GetInt(d, "y", -99999);
                                            vop = JsonUtil.GetString(d, "op", "click");
                                        }

                                        string captured = nextState;
                                        int capX = vx;
                                        int capY = vy;
                                        string capOp = vop;
                                        if (!pill.IsDisposed)
                                        {
                                            try
                                            {
                                                pill.BeginInvoke((MethodInvoker)delegate
                                                {
                                                    if (pill.IsDisposed) return;
                                                    string upper = (captured ?? string.Empty).Trim().ToUpperInvariant();
                                                    if (upper == "VIRTUAL_CURSOR" || upper == "VIRTUAL_MOVE")
                                                    {
                                                        if (!vcursor.IsDisposed && capX > -90000 && capY > -90000)
                                                        {
                                                            vcursor.TriggerPulse(capX, capY, capOp);
                                                        }
                                                        return;
                                                    }
                                                    if (upper == "HIDE_CURSOR")
                                                    {
                                                        if (!vcursor.IsDisposed) vcursor.HideImmediate();
                                                        return;
                                                    }
                                                    if (upper == "SUSPEND_ESC")
                                                    {
                                                        escSuspended = true;
                                                        if (overlayEscGuard != null)
                                                        {
                                                            overlayEscGuard.TemporarilySuspendHotKey();
                                                            overlayEscGuard.ClearSyntheticMessages();
                                                        }
                                                        pill.ApplyStateUpdate("EXECUTING");
                                                        return;
                                                    }
                                                    if (upper == "EXIT" || upper == "DISARMED" || upper == "PAUSED_HANDOFF")
                                                    {
                                                        escSuspended = true;
                                                        if (overlayEscGuard != null)
                                                        {
                                                            overlayEscGuard.TemporarilySuspendHotKey();
                                                            overlayEscGuard.ClearSyntheticMessages();
                                                        }
                                                        if (!vcursor.IsDisposed) vcursor.HideImmediate();
                                                    }
                                                    else if (upper == "ARMED" || upper == "ARMED_READONLY" || upper == "ARMED_INTERACTIVE" || upper == "EXECUTING")
                                                    {
                                                        if (overlayEscGuard != null)
                                                        {
                                                            overlayEscGuard.ClearSyntheticMessages();
                                                            overlayEscGuard.RegisterEscHotKey();
                                                        }
                                                        escSuspended = false;
                                                    }
                                                    pill.ApplyStateUpdate(captured);
                                                });
                                            }
                                            catch
                                            {
                                                break;
                                            }
                                        }
                                        if (string.Equals(captured, "EXIT", StringComparison.OrdinalIgnoreCase))
                                        {
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        catch
                        {
                        }
                        try
                        {
                            if (!pill.IsDisposed && pill.IsHandleCreated)
                            {
                                pill.BeginInvoke((MethodInvoker)delegate
                                {
                                    if (!vcursor.IsDisposed) vcursor.HideImmediate();
                                    if (!pill.IsDisposed) pill.Close();
                                });
                            }
                        }
                        catch
                        {
                        }
                    });
                    stdinThread.IsBackground = true;
                    pill.FormClosed += delegate
                    {
                        escPollTimer.Stop();
                        overlayEscGuard.TemporarilySuspendHotKey();
                        if (!vcursor.IsDisposed)
                        {
                            vcursor.HideImmediate();
                            vcursor.Close();
                        }
                    };
                    pill.Shown += delegate
                    {
                        IntPtr ensureHandle = vcursor.Handle;
                        if (ensureHandle != IntPtr.Zero) { }
                        escPollTimer.Start();
                        stdinThread.Start();
                    };
                    Application.Run(pill);
                }
                finally
                {
                    if (escPollTimer != null)
                    {
                        escPollTimer.Stop();
                        escPollTimer.Dispose();
                    }
                    if (overlayEscGuard != null)
                    {
                        overlayEscGuard.Dispose();
                    }
                }
            }
            return 0;
        }

        private static int RunWorkerSubCommand(string subCmd)
        {
            try
            {
                if (subCmd == "release-modifiers")
                {
                    InputController.ReleaseAllModifiers();
                    Dictionary<string, object> rel = new Dictionary<string, object>();
                    rel["ok"] = true;
                    rel["released"] = true;
                    WriteJsonLine(rel);
                    return 0;
                }
                if (subCmd == "list-windows")
                {
                    WriteJsonLine(DesktopWorker.RunListWindows());
                    return 0;
                }
                if (subCmd == "observe")
                {
                    Dictionary<string, object> req = ReadStdinJsonDict();
                    WriteJsonLine(DesktopWorker.RunObserve(req));
                    return 0;
                }
                if (subCmd == "act")
                {
                    Dictionary<string, object> req = ReadStdinJsonDict();
                    WriteJsonLine(DesktopWorker.RunAct(req));
                    return 0;
                }
                WriteJsonLine(DesktopWorker.ErrorResult("UNKNOWN_SUBCOMMAND", "未知的 --cmd 子命令: " + subCmd));
                return 1;
            }
            catch (Exception ex)
            {
                InputController.ReleaseAllModifiers();
                WriteJsonLine(DesktopWorker.ErrorResult("UNHANDLED_WORKER_EXCEPTION", ex.Message));
                return 1;
            }
        }
    }
}
