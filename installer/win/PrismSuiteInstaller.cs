using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Anti-Claude Prism Suite 一键安装器")]
[assembly: AssemblyDescription("Anti-Claude Prism Suite Standalone All-in-One Installer (Kernel + Extensions + prism-files + prism-cua + chrome-bridge)")]
[assembly: AssemblyProduct("Anti-Claude Prism Suite")]
[assembly: AssemblyVersion("0.9.0.0")]
[assembly: AssemblyFileVersion("0.9.0.0")]

namespace AntiClaudePrismSuiteInstaller
{
    [ComImport]
    [Guid("00021401-0000-0000-C000-000000000046")]
    internal class ShellLinkCoClass
    {
    }

    [ComImport]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("000214F9-0000-0000-C000-000000000046")]
    internal interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cch, IntPtr pfd, uint fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cch);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cch);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cch);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out ushort pwHotkey);
        void SetHotkey(ushort wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cch, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, uint dwReserved);
        void Resolve(IntPtr hwnd, uint fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }

    internal sealed class NodeRuntimeResolution
    {
        public string ExePath;
        public bool UseElectronAsNode;
    }

    internal sealed class PayloadEntry
    {
        public string ResourceName;
        public string Category; // "kernel", "extensions", "chrome-bridge", "plugin", or "plugin-cua"
        public string RelativePath;
    }

    internal sealed class CliOptions
    {
        public bool SilentInstall;
        public bool SilentUninstall;
        public bool WithKernel;
        public bool NoWsl;
        public string TestUserDir;
        public string TestPluginsDir;
    }

    internal sealed class WslDetectionResult
    {
        public List<string> Targets = new List<string>();
        public List<string> DistrosChecked = new List<string>();
        public string Summary;
    }

    internal static class InstallerCore
    {
        private const string ManifestResourceName = "payload.manifest.txt";
        private static readonly string[] ExtensionFileNames = new string[]
        {
            "prism-suite.css",
            "prism-suite.js",
            "prism-suite-fx.css",
            "prism-suite-fx.js",
            "prism-suite-workflow.css",
            "prism-suite-workflow.js"
        };

        private static readonly string[] GeneratedExtensionFileNames = new string[]
        {
            "prism-suite-00-prefs.js"
        };

        private static readonly string[] KernelUserLayerFileNames = new string[]
        {
            "config.json",
            "custom.css",
            "custom.js",
            "i18n.override.json"
        };

        public static string GetDefaultExtensionsDir()
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(
                Path.Combine(
                    Path.Combine(
                        Path.Combine(Path.Combine(profile, ".gemini"), "antigravity"),
                        "anti-claude"),
                    "user"),
                "extensions");
        }

        public static string GetDefaultPluginDir()
        {
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(
                Path.Combine(Path.Combine(Path.Combine(profile, ".gemini"), "config"), "plugins"),
                "prism-files");
        }

        public static void ResolveAntiClaudeDirsFromExtDir(string targetExtDir, out string stateDir, out string userDir)
        {
            string full = Path.GetFullPath(targetExtDir.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.Equals(Path.GetFileName(full), "extensions", StringComparison.OrdinalIgnoreCase))
            {
                userDir = Path.GetDirectoryName(full) ?? full;
            }
            else
            {
                userDir = full;
            }
            if (string.Equals(Path.GetFileName(userDir), "user", StringComparison.OrdinalIgnoreCase))
            {
                stateDir = Path.GetDirectoryName(userDir) ?? userDir;
            }
            else
            {
                stateDir = Path.Combine(userDir, ".anti-claude");
            }
        }

        public static string NormalizePrismFilesTarget(string rawPath)
        {
            if (string.IsNullOrEmpty(rawPath) || rawPath.Trim().Length == 0)
            {
                throw new ArgumentException("插件目标目录不能为空。");
            }
            string trimmed = rawPath.Trim().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if (trimmed.Length == 2
                && ((trimmed[0] >= 'A' && trimmed[0] <= 'Z') || (trimmed[0] >= 'a' && trimmed[0] <= 'z'))
                && trimmed[1] == ':')
            {
                trimmed = trimmed + "\\";
            }
            string full = Path.GetFullPath(trimmed);
            if (!string.Equals(Path.GetFileName(full), "prism-files", StringComparison.OrdinalIgnoreCase))
            {
                full = Path.Combine(full, "prism-files");
            }
            return full;
        }

        public static List<PayloadEntry> LoadManifest()
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            Stream stream = asm.GetManifestResourceStream(ManifestResourceName);
            if (stream == null)
            {
                throw new InvalidOperationException("安装包内部缺少资源清单：" + ManifestResourceName);
            }

            List<PayloadEntry> entries = new List<PayloadEntry>();
            using (stream)
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
            {
                string line;
                while ((line = reader.ReadLine()) != null)
                {
                    string clean = line.Trim();
                    if (clean.Length == 0 || clean.StartsWith("#", StringComparison.Ordinal))
                    {
                        continue;
                    }
                    int sep = clean.IndexOf('|');
                    if (sep <= 0 || sep >= clean.Length - 1)
                    {
                        continue;
                    }

                    string resourceName = clean.Substring(0, sep).Trim();
                    string targetRel = clean.Substring(sep + 1).Trim().Replace('\\', '/');

                    if (targetRel.StartsWith("extensions/", StringComparison.OrdinalIgnoreCase)
                        && resourceName.StartsWith("payload.extensions.", StringComparison.Ordinal))
                    {
                        string rel = ValidateSafeRelativePath(targetRel.Substring("extensions/".Length));
                        entries.Add(new PayloadEntry
                        {
                            ResourceName = resourceName,
                            Category = "extensions",
                            RelativePath = rel
                        });
                    }
                    else if (targetRel.StartsWith("chrome-bridge/", StringComparison.OrdinalIgnoreCase)
                        && (resourceName.StartsWith("payload.chromebridge.", StringComparison.Ordinal)
                            || resourceName.StartsWith("payload.chrome-bridge.", StringComparison.Ordinal)))
                    {
                        string rel = ValidateSafeRelativePath(targetRel.Substring("chrome-bridge/".Length));
                        entries.Add(new PayloadEntry
                        {
                            ResourceName = resourceName,
                            Category = "chrome-bridge",
                            RelativePath = rel
                        });
                    }
                    else if (targetRel.StartsWith("plugin-cua/", StringComparison.OrdinalIgnoreCase)
                        && (resourceName.StartsWith("payload.plugincua.", StringComparison.Ordinal)
                            || resourceName.StartsWith("payload.plugin-cua.", StringComparison.Ordinal)))
                    {
                        string rel = ValidateSafeRelativePath(targetRel.Substring("plugin-cua/".Length));
                        entries.Add(new PayloadEntry
                        {
                            ResourceName = resourceName,
                            Category = "plugin-cua",
                            RelativePath = rel
                        });
                    }
                    else if (targetRel.StartsWith("plugin/", StringComparison.OrdinalIgnoreCase)
                        && resourceName.StartsWith("payload.plugin.", StringComparison.Ordinal))
                    {
                        string rel = ValidateSafeRelativePath(targetRel.Substring("plugin/".Length));
                        entries.Add(new PayloadEntry
                        {
                            ResourceName = resourceName,
                            Category = "plugin",
                            RelativePath = rel
                        });
                    }
                    else if (targetRel.StartsWith("kernel/", StringComparison.OrdinalIgnoreCase)
                        && resourceName.StartsWith("payload.kernel.", StringComparison.Ordinal))
                    {
                        string rel = ValidateSafeRelativePath(targetRel.Substring("kernel/".Length));
                        entries.Add(new PayloadEntry
                        {
                            ResourceName = resourceName,
                            Category = "kernel",
                            RelativePath = rel
                        });
                    }
                }
            }

            if (entries.Count == 0)
            {
                throw new InvalidOperationException("安装包清单中未包含任何有效文件。");
            }
            return entries;
        }

        private static string ValidateSafeRelativePath(string rel)
        {
            if (string.IsNullOrEmpty(rel) || Path.IsPathRooted(rel))
            {
                throw new InvalidOperationException("非法清单相对路径：" + rel);
            }
            string[] parts = rel.Split(new char[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 0)
            {
                throw new InvalidOperationException("清单相对路径为空。");
            }
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i] == "." || parts[i] == "..")
                {
                    throw new InvalidOperationException("清单相对路径包含非法跳转段：" + rel);
                }
            }
            return string.Join(Path.DirectorySeparatorChar.ToString(), parts);
        }

        private const uint MOVEFILE_REPLACE_EXISTING = 0x00000001;
        private const uint MOVEFILE_WRITE_THROUGH = 0x00000008;

        private static readonly Guid FOLDERID_Desktop = new Guid("B4BFCC3A-DB2C-424C-B029-7FE99A87C641");
        private static readonly Regex SafeWslDistroRegex = new Regex("^[A-Za-z0-9._-]+$", RegexOptions.CultureInvariant);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool MoveFileExW(string lpExistingFileName, string lpNewFileName, uint dwFlags);

        [DllImport("shell32.dll", ExactSpelling = true)]
        private static extern int SHGetKnownFolderPath(
            [MarshalAs(UnmanagedType.LPStruct)] Guid rfid,
            uint dwFlags,
            IntPtr hToken,
            out IntPtr ppszPath);

        private static bool MoveReplaceFileAtomic(string srcTmpPath, string destPath)
        {
            if (MoveFileExW(srcTmpPath, destPath, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH))
            {
                return true;
            }
            // Fallback without WRITE_THROUGH for network/UNC redirectors (e.g. \\wsl.localhost 9P shares)
            return MoveFileExW(srcTmpPath, destPath, MOVEFILE_REPLACE_EXISTING);
        }

        private static void CleanupUnlockedOldSiblings(string parentDir, string baseFileName)
        {
            if (string.IsNullOrEmpty(parentDir) || string.IsNullOrEmpty(baseFileName)) return;
            try
            {
                string[] stale = Directory.GetFiles(parentDir, baseFileName + ".old.*");
                for (int i = 0; i < stale.Length; i++)
                {
                    try
                    {
                        if (!IsExistingReparsePoint(stale[i]))
                        {
                            File.Delete(stale[i]);
                        }
                    }
                    catch
                    {
                        // Still held by a running process; will be cleaned on next update/prune
                    }
                }
            }
            catch
            {
            }
        }

        private static void WriteResourceToFile(Assembly asm, string resourceName, string destPath)
        {
            string parent = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(parent))
            {
                if (IsExistingReparsePoint(parent))
                {
                    throw new InvalidOperationException("安全拦截：拒绝向重解析点目录写入文件：" + parent);
                }
                Directory.CreateDirectory(parent);
            }
            if (IsExistingReparsePoint(destPath))
            {
                throw new InvalidOperationException("安全拦截：拒绝覆盖重解析点文件：" + destPath);
            }
            string tmpPath = destPath + ".prism-tmp-" + Guid.NewGuid().ToString("N");
            bool createdTmp = false;
            try
            {
                using (Stream src = asm.GetManifestResourceStream(resourceName))
                {
                    if (src == null)
                    {
                        throw new InvalidOperationException("未找到内嵌资源：" + resourceName);
                    }
                    using (FileStream dst = new FileStream(tmpPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        createdTmp = true;
                        src.CopyTo(dst);
                        dst.Flush(true);
                    }
                }
                if (IsExistingReparsePoint(destPath))
                {
                    throw new InvalidOperationException("安全拦截：目标文件被替换为重解析点：" + destPath);
                }

                if (!MoveReplaceFileAtomic(tmpPath, destPath))
                {
                    int firstErr = Marshal.GetLastWin32Error();
                    bool hotSwapped = false;
                    if (File.Exists(destPath) && !IsExistingReparsePoint(destPath))
                    {
                        try
                        {
                            FileAttributes curAttrs = File.GetAttributes(destPath);
                            if ((curAttrs & FileAttributes.ReadOnly) != 0)
                            {
                                File.SetAttributes(destPath, curAttrs & ~FileAttributes.ReadOnly);
                            }
                        }
                        catch { }

                        string oldPath = destPath + ".old." + unchecked((uint)Environment.TickCount).ToString();
                        if (File.Exists(oldPath))
                        {
                            oldPath = oldPath + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
                        }
                        if (!IsExistingReparsePoint(destPath) && MoveFileExW(destPath, oldPath, MOVEFILE_REPLACE_EXISTING))
                        {
                            if (MoveReplaceFileAtomic(tmpPath, destPath))
                            {
                                hotSwapped = true;
                                try { File.Delete(oldPath); } catch { }
                            }
                            else
                            {
                                int secondErr = Marshal.GetLastWin32Error();
                                try { MoveFileExW(oldPath, destPath, MOVEFILE_REPLACE_EXISTING); } catch { }
                                throw new IOException(string.Format("原子替换运行中文件失败（Win32={0}）：{1}", secondErr, destPath));
                            }
                        }
                    }

                    if (!hotSwapped)
                    {
                        throw new IOException(string.Format("原子写入目标文件失败（Win32={0}）：{1}", firstErr, destPath));
                    }
                }

                createdTmp = false;
                CleanupUnlockedOldSiblings(parent, Path.GetFileName(destPath));
            }
            finally
            {
                if (createdTmp)
                {
                    try
                    {
                        if (File.Exists(tmpPath)) File.Delete(tmpPath);
                    }
                    catch
                    {
                    }
                }
            }
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct STARTUPINFOW
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool CreateProcessW(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFOW lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        /// <summary>
        /// Spawn a child process with bInheritHandles = FALSE and CREATE_NO_WINDOW so a detached
        /// grandchild (e.g. daemon.mjs) can NEVER inherit open stdout/stderr pipes from callers of Setup.exe.
        /// </summary>
        private static bool RunProcessNoHandleInherit(string exePath, string arguments, string workingDir, int timeoutMs)
        {
            return RunProcessNoHandleInherit(exePath, arguments, workingDir, timeoutMs, false);
        }

        private static IntPtr BuildUnicodeEnvironmentBlock(Dictionary<string, string> overrides)
        {
            SortedDictionary<string, string> merged = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (System.Collections.DictionaryEntry de in Environment.GetEnvironmentVariables())
            {
                string k = de.Key as string;
                if (!string.IsNullOrEmpty(k) && !k.Contains("="))
                {
                    merged[k] = Convert.ToString(de.Value) ?? string.Empty;
                }
            }
            if (overrides != null)
            {
                foreach (KeyValuePair<string, string> kv in overrides)
                {
                    if (kv.Value == null) merged.Remove(kv.Key);
                    else merged[kv.Key] = kv.Value;
                }
            }
            StringBuilder sb = new StringBuilder();
            foreach (KeyValuePair<string, string> kv in merged)
            {
                sb.Append(kv.Key).Append('=').Append(kv.Value).Append('\0');
            }
            sb.Append('\0');
            byte[] bytes = Encoding.Unicode.GetBytes(sb.ToString());
            IntPtr block = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, block, bytes.Length);
            return block;
        }

        private static bool IsProcessRunningElevated()
        {
            try
            {
                using (System.Security.Principal.WindowsIdentity id = System.Security.Principal.WindowsIdentity.GetCurrent())
                {
                    System.Security.Principal.WindowsPrincipal pr = new System.Security.Principal.WindowsPrincipal(id);
                    return pr.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
                }
            }
            catch
            {
                return false;
            }
        }

        private static List<string> EnumerateShortcutFilesSafe(string rootDir)
        {
            List<string> results = new List<string>();
            if (string.IsNullOrEmpty(rootDir) || !Directory.Exists(rootDir)) return results;
            Stack<string> dirs = new Stack<string>();
            dirs.Push(rootDir);
            int visited = 0;
            while (dirs.Count > 0 && visited < 256)
            {
                string cur = dirs.Pop();
                visited++;
                if (cur != rootDir && IsExistingReparsePoint(cur)) continue;
                try
                {
                    string[] files = Directory.GetFiles(cur, "*Antigravity*.lnk", SearchOption.TopDirectoryOnly);
                    for (int i = 0; i < files.Length; i++)
                    {
                        if (!IsExistingReparsePoint(files[i])) results.Add(files[i]);
                    }
                }
                catch { }
                try
                {
                    string[] subDirs = Directory.GetDirectories(cur, "*", SearchOption.TopDirectoryOnly);
                    for (int i = 0; i < subDirs.Length; i++)
                    {
                        if (!IsExistingReparsePoint(subDirs[i])) dirs.Push(subDirs[i]);
                    }
                }
                catch { }
            }
            return results;
        }

        private static bool RunProcessNoHandleInherit(string exePath, string arguments, string workingDir, int timeoutMs, bool useElectronAsNode)
        {
            const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
            const uint CREATE_NO_WINDOW = 0x08000000;
            const uint WAIT_OBJECT_0 = 0x00000000;

            Dictionary<string, string> envOverrides = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            envOverrides["ANTI_CLAUDE_NO_NETWORK"] = "1";
            if (useElectronAsNode)
            {
                envOverrides["ELECTRON_RUN_AS_NODE"] = "1";
            }
            IntPtr envBlock = BuildUnicodeEnvironmentBlock(envOverrides);
            try
            {
                STARTUPINFOW si = new STARTUPINFOW();
                si.cb = Marshal.SizeOf(typeof(STARTUPINFOW));
                PROCESS_INFORMATION pi;
                StringBuilder cmdLine = new StringBuilder();
                cmdLine.Append('"').Append(exePath).Append('"');
                if (!string.IsNullOrEmpty(arguments))
                {
                    cmdLine.Append(' ').Append(arguments);
                }

                bool started = CreateProcessW(
                    exePath,
                    cmdLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    false, // bInheritHandles = FALSE: strictly prevents pipe inheritance into daemon.mjs
                    CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                    envBlock,
                    workingDir,
                    ref si,
                    out pi);

                if (!started)
                {
                    throw new InvalidOperationException("CreateProcessW failed with Win32 error " + Marshal.GetLastWin32Error());
                }

                try
                {
                    uint waitRes = WaitForSingleObject(pi.hProcess, (uint)Math.Max(1000, timeoutMs));
                    if (waitRes != WAIT_OBJECT_0)
                    {
                        try { TerminateProcess(pi.hProcess, 1); } catch { }
                        return false;
                    }
                    uint exitCode = 1;
                    if (!GetExitCodeProcess(pi.hProcess, out exitCode))
                    {
                        return false;
                    }
                    return exitCode == 0;
                }
                finally
                {
                    if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
                    if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
                }
            }
            finally
            {
                if (envBlock != IntPtr.Zero) Marshal.FreeHGlobal(envBlock);
            }
        }

        private static string ComputeFileSha256(string path)
        {
            if (!File.Exists(path)) return string.Empty;
            try
            {
                using (SHA256 sha = SHA256.Create())
                using (FileStream fs = File.OpenRead(path))
                {
                    byte[] hash = sha.ComputeHash(fs);
                    return BitConverter.ToString(hash).Replace("-", string.Empty).ToLowerInvariant();
                }
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string GetUserDesktopFolderPath()
        {
            IntPtr ptr = IntPtr.Zero;
            try
            {
                int hr = SHGetKnownFolderPath(FOLDERID_Desktop, 0, IntPtr.Zero, out ptr);
                if (hr == 0 && ptr != IntPtr.Zero)
                {
                    string known = Marshal.PtrToStringUni(ptr);
                    if (!string.IsNullOrEmpty(known))
                    {
                        return known;
                    }
                }
            }
            catch
            {
            }
            finally
            {
                if (ptr != IntPtr.Zero)
                {
                    try { Marshal.FreeCoTaskMem(ptr); } catch { }
                }
            }
            return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        }

        private static bool TryReadShortcut(string lnkPath, out string targetPath, out string arguments)
        {
            targetPath = string.Empty;
            arguments = string.Empty;
            object comObj = null;
            try
            {
                comObj = new ShellLinkCoClass();
                IPersistFile persist = (IPersistFile)comObj;
                persist.Load(lnkPath, 0);
                IShellLinkW link = (IShellLinkW)comObj;
                StringBuilder sbTarget = new StringBuilder(1024);
                link.GetPath(sbTarget, sbTarget.Capacity, IntPtr.Zero, 0);
                StringBuilder sbArgs = new StringBuilder(2048);
                link.GetArguments(sbArgs, sbArgs.Capacity);
                targetPath = sbTarget.ToString();
                arguments = sbArgs.ToString();
                return true;
            }
            catch
            {
                return false;
            }
            finally
            {
                if (comObj != null && Marshal.IsComObject(comObj))
                {
                    try { Marshal.FinalReleaseComObject(comObj); } catch { }
                }
            }
        }

        private static bool IsTrustedExecutableLocation(string candidatePath, bool elevated)
        {
            if (string.IsNullOrEmpty(candidatePath)) return false;
            if (!elevated) return true;
            try
            {
                string full = Path.GetFullPath(candidatePath);
                string[] trustedRoots = new string[]
                {
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                };
                for (int i = 0; i < trustedRoots.Length; i++)
                {
                    string root = trustedRoots[i];
                    if (string.IsNullOrEmpty(root)) continue;
                    string normRoot = Path.GetFullPath(root).TrimEnd('\\') + "\\";
                    if (full.StartsWith(normRoot, StringComparison.OrdinalIgnoreCase)) return true;
                }
            }
            catch { }
            return false;
        }

        private static List<string> CollectWindowsNodeCandidates()
        {
            List<string> candidates = new List<string>();
            bool elevated = IsProcessRunningElevated();
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

            // Standard protected/user-owned install directories always take priority over arbitrary %PATH%
            if (!string.IsNullOrEmpty(pf)) candidates.Add(Path.Combine(Path.Combine(pf, "nodejs"), "node.exe"));
            if (!string.IsNullOrEmpty(pf86)) candidates.Add(Path.Combine(Path.Combine(pf86, "nodejs"), "node.exe"));
            if (!string.IsNullOrEmpty(localApp)) candidates.Add(Path.Combine(Path.Combine(localApp, "Programs"), Path.Combine("nodejs", "node.exe")));
            if (!string.IsNullOrEmpty(profile)) candidates.Add(Path.Combine(Path.Combine(profile, ".volta"), Path.Combine("bin", "node.exe")));

            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            string[] pathDirs = pathEnv.Split(new char[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
            for (int i = 0; i < pathDirs.Length; i++)
            {
                try
                {
                    string dir = pathDirs[i].Trim().Trim('"');
                    if (dir.Length > 0)
                    {
                        string cand = Path.Combine(dir, "node.exe");
                        if (IsTrustedExecutableLocation(cand, elevated))
                        {
                            candidates.Add(cand);
                        }
                    }
                }
                catch { }
            }

            // nvm-windows symlink or active dir
            string nvmSymlink = Environment.GetEnvironmentVariable("NVM_SYMLINK");
            if (!string.IsNullOrEmpty(nvmSymlink))
            {
                string nvmCand = Path.Combine(nvmSymlink.Trim().Trim('"'), "node.exe");
                if (IsTrustedExecutableLocation(nvmCand, elevated)) candidates.Add(nvmCand);
            }
            if (!string.IsNullOrEmpty(appData))
            {
                string nvmDir = Path.Combine(appData, "nvm");
                if (Directory.Exists(nvmDir))
                {
                    try
                    {
                        string[] sub = Directory.GetDirectories(nvmDir, "v*");
                        Array.Sort(sub, StringComparer.OrdinalIgnoreCase);
                        for (int s = sub.Length - 1; s >= 0; s--)
                        {
                            candidates.Add(Path.Combine(sub[s], "node.exe"));
                        }
                    }
                    catch { }
                }
            }
            return candidates;
        }

        private static int GetNodeMajorVersion(string nodeExe, bool useElectronAsNode)
        {
            if (string.IsNullOrEmpty(nodeExe) || !File.Exists(nodeExe)) return 0;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExe;
                psi.Arguments = "--version";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                if (useElectronAsNode)
                {
                    psi.EnvironmentVariables["ELECTRON_RUN_AS_NODE"] = "1";
                }
                string raw = RunProcessAndReadStdout(psi, 3000);
                if (string.IsNullOrEmpty(raw)) return 0;
                Match m = Regex.Match(raw.Trim(), @"v?(\d+)\.\d+");
                if (m.Success)
                {
                    int major = 0;
                    if (int.TryParse(m.Groups[1].Value, out major))
                    {
                        return major;
                    }
                }
            }
            catch
            {
            }
            return 0;
        }

        public static string FindWindowsNodeExe()
        {
            List<string> candidates = CollectWindowsNodeCandidates();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string firstExisting = null;
            for (int i = 0; i < candidates.Count; i++)
            {
                try
                {
                    if (string.IsNullOrEmpty(candidates[i]) || !File.Exists(candidates[i])) continue;
                    string full = Path.GetFullPath(candidates[i]);
                    if (!seen.Add(full)) continue;
                    if (firstExisting == null) firstExisting = full;
                    if (GetNodeMajorVersion(full, false) >= 22)
                    {
                        return full;
                    }
                }
                catch { }
            }
            return firstExisting;
        }

        public static string FindAntigravityExe()
        {
            List<string> candidates = new List<string>();
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

            if (!string.IsNullOrEmpty(localApp))
            {
                candidates.Add(Path.Combine(Path.Combine(localApp, "Programs"), Path.Combine("Antigravity", "Antigravity.exe")));
                candidates.Add(Path.Combine(Path.Combine(localApp, "Programs"), Path.Combine("antigravity", "Antigravity.exe")));
            }
            if (!string.IsNullOrEmpty(pf))
            {
                candidates.Add(Path.Combine(pf, Path.Combine("Antigravity", "Antigravity.exe")));
            }
            if (!string.IsNullOrEmpty(pf86))
            {
                candidates.Add(Path.Combine(pf86, Path.Combine("Antigravity", "Antigravity.exe")));
            }
            candidates.Add(@"D:\Program Files\Antigravity\Antigravity.exe");

            for (int i = 0; i < candidates.Count; i++)
            {
                try
                {
                    if (!string.IsNullOrEmpty(candidates[i]) && File.Exists(candidates[i]))
                    {
                        return Path.GetFullPath(candidates[i]);
                    }
                }
                catch { }
            }

            bool elevated = IsProcessRunningElevated();
            // Probe running Antigravity process if open
            try
            {
                Process[] procs = Process.GetProcessesByName("Antigravity");
                for (int p = 0; p < procs.Length; p++)
                {
                    try
                    {
                        string modFile = procs[p].MainModule.FileName;
                        if (!string.IsNullOrEmpty(modFile) && File.Exists(modFile) && IsTrustedExecutableLocation(modFile, elevated))
                        {
                            return Path.GetFullPath(modFile);
                        }
                    }
                    catch { }
                    finally
                    {
                        try { procs[p].Dispose(); } catch { }
                    }
                }
            }
            catch { }

            // Fallback: discover custom install path from Desktop / Start Menu shortcuts via IShellLinkW
            string[] shortcutRoots = new string[]
            {
                GetUserDesktopFolderPath(),
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms)
            };
            HashSet<string> visitedRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int r = 0; r < shortcutRoots.Length; r++)
            {
                string root = shortcutRoots[r];
                if (string.IsNullOrEmpty(root) || !visitedRoots.Add(root) || !Directory.Exists(root)) continue;
                List<string> links = EnumerateShortcutFilesSafe(root);
                for (int k = 0; k < links.Count; k++)
                {
                    string scTarget;
                    string scArgs;
                    if (TryReadShortcut(links[k], out scTarget, out scArgs)
                        && !string.IsNullOrEmpty(scTarget)
                        && scTarget.EndsWith("Antigravity.exe", StringComparison.OrdinalIgnoreCase)
                        && File.Exists(scTarget)
                        && IsTrustedExecutableLocation(scTarget, elevated))
                    {
                        return Path.GetFullPath(scTarget);
                    }
                }
            }

            return null;
        }

        public static NodeRuntimeResolution ResolveNodeOrElectronRuntime()
        {
            List<string> nodeCandidates = CollectWindowsNodeCandidates();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < nodeCandidates.Count; i++)
            {
                try
                {
                    if (string.IsNullOrEmpty(nodeCandidates[i]) || !File.Exists(nodeCandidates[i])) continue;
                    string full = Path.GetFullPath(nodeCandidates[i]);
                    if (!seen.Add(full)) continue;
                    if (GetNodeMajorVersion(full, false) >= 22)
                    {
                        return new NodeRuntimeResolution
                        {
                            ExePath = full,
                            UseElectronAsNode = false
                        };
                    }
                }
                catch { }
            }

            string agyExe = FindAntigravityExe();
            if (!string.IsNullOrEmpty(agyExe) && File.Exists(agyExe))
            {
                return new NodeRuntimeResolution
                {
                    ExePath = agyExe,
                    UseElectronAsNode = true
                };
            }

            return null;
        }

        public static int EnsureDebugPortOnUserShortcuts(Action<string> log)
        {
            int updated = 0;
            try
            {
                string[] rawRoots = new string[]
                {
                    GetUserDesktopFolderPath(),
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs)
                };
                HashSet<string> seenRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int r = 0; r < rawRoots.Length; r++)
                {
                    string root = rawRoots[r];
                    if (string.IsNullOrEmpty(root) || !seenRoots.Add(root) || !Directory.Exists(root)) continue;
                    List<string> links = EnumerateShortcutFilesSafe(root);
                    for (int k = 0; k < links.Count; k++)
                    {
                        if (IsExistingReparsePoint(links[k])) continue;
                        object comObj = null;
                        try
                        {
                            comObj = new ShellLinkCoClass();
                            IPersistFile persist = (IPersistFile)comObj;
                            persist.Load(links[k], 0);
                            IShellLinkW link = (IShellLinkW)comObj;

                            StringBuilder sbTarget = new StringBuilder(1024);
                            link.GetPath(sbTarget, sbTarget.Capacity, IntPtr.Zero, 0);
                            string targetPath = sbTarget.ToString();
                            if (!targetPath.EndsWith("Antigravity.exe", StringComparison.OrdinalIgnoreCase)) continue;

                            StringBuilder sbArgs = new StringBuilder(4096);
                            link.GetArguments(sbArgs, sbArgs.Capacity);
                            if (sbArgs.Length >= sbArgs.Capacity - 64) continue; // Guard against truncating abnormally long arguments
                            string args = sbArgs.ToString();
                            if (args.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0) continue;

                            string nextArgs = string.IsNullOrEmpty(args.Trim())
                                ? "--remote-debugging-port=0"
                                : (args.Trim() + " --remote-debugging-port=0");
                            link.SetArguments(nextArgs);
                            persist.Save(links[k], true);
                            updated++;
                            log(string.Format("  [快捷方式] 已自动启用 CDP 调试端口: {0}", links[k]));
                        }
                        catch
                        {
                            // Safely skip read-only or locked shortcuts
                        }
                        finally
                        {
                            if (comObj != null && Marshal.IsComObject(comObj))
                            {
                                try { Marshal.FinalReleaseComObject(comObj); } catch { }
                            }
                        }
                    }
                }
            }
            catch
            {
            }
            return updated;
        }

        private static bool IsExistingReparsePoint(string path)
        {
            try
            {
                FileAttributes attrs = File.GetAttributes(path);
                return (attrs & FileAttributes.ReparsePoint) != 0;
            }
            catch (FileNotFoundException)
            {
                return false;
            }
            catch (DirectoryNotFoundException)
            {
                return false;
            }
            catch
            {
                return true;
            }
        }

        private static string TrimTrailingSepPreserveRoot(string fullPath)
        {
            string full = Path.GetFullPath(fullPath);
            string root = Path.GetPathRoot(full) ?? string.Empty;
            if (string.Equals(full, root, StringComparison.OrdinalIgnoreCase))
            {
                return root;
            }
            return full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        private static void AssertSafeManagedDirectory(string dirPath, string anchorDir)
        {
            string fullTarget = TrimTrailingSepPreserveRoot(dirPath);
            string walkRoot = !string.IsNullOrEmpty(anchorDir)
                ? TrimTrailingSepPreserveRoot(anchorDir)
                : (Path.GetPathRoot(fullTarget) ?? string.Empty);

            if (string.IsNullOrEmpty(walkRoot))
            {
                throw new InvalidOperationException("无法解析目标目录根路径：" + fullTarget);
            }

            // Allow legitimate disk-relocation NTFS Junctions on C:\Users or %USERPROFILE% itself
            // while strictly blocking any symlink/junction inside %USERPROFILE%\.gemini\... downward!
            string rawProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string cleanProfile = !string.IsNullOrEmpty(rawProfile) ? TrimTrailingSepPreserveRoot(rawProfile) : string.Empty;
            bool startedAtUserProfile = false;
            if (!string.IsNullOrEmpty(cleanProfile)
                && (string.Equals(fullTarget, cleanProfile, StringComparison.OrdinalIgnoreCase)
                    || IsInsideRoot(fullTarget, cleanProfile))
                && (string.Equals(walkRoot, Path.GetPathRoot(cleanProfile) ?? string.Empty, StringComparison.OrdinalIgnoreCase)
                    || IsInsideRoot(cleanProfile, walkRoot)
                    || string.Equals(walkRoot, cleanProfile, StringComparison.OrdinalIgnoreCase)))
            {
                walkRoot = cleanProfile;
                startedAtUserProfile = true;
            }

            string rootPath = Path.GetPathRoot(walkRoot) ?? string.Empty;
            if (!startedAtUserProfile
                && !string.Equals(walkRoot, rootPath, StringComparison.OrdinalIgnoreCase)
                && IsExistingReparsePoint(walkRoot))
            {
                throw new InvalidOperationException("安全拦截：锚点父目录为符号链接或目录联接：" + walkRoot);
            }

            if (string.Equals(fullTarget, walkRoot, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            string prefix = walkRoot.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                ? walkRoot
                : (walkRoot + Path.DirectorySeparatorChar);
            if (!fullTarget.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安全拦截：目标路径越出受管锚点目录：" + fullTarget);
            }

            string rel = fullTarget.Substring(prefix.Length);
            string[] parts = rel.Split(new char[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries);
            string walk = walkRoot;
            for (int i = 0; i < parts.Length; i++)
            {
                walk = Path.Combine(walk, parts[i]);
                if (IsExistingReparsePoint(walk))
                {
                    throw new InvalidOperationException("安全拦截：拒绝穿过符号链接或目录联接写入：" + walk);
                }
            }
        }

        public static int InstallKernel(string targetExtDir, List<PayloadEntry> entries, bool activateHostDaemon, Action<string> log)
        {
            string stateDir;
            string userDir;
            ResolveAntiClaudeDirsFromExtDir(targetExtDir, out stateDir, out userDir);
            string fullStateDir = TrimTrailingSepPreserveRoot(stateDir);
            string fullUserDir = TrimTrailingSepPreserveRoot(userDir);
            string stateRoot = Path.GetPathRoot(fullStateDir) ?? string.Empty;
            string userRoot = Path.GetPathRoot(fullUserDir) ?? string.Empty;
            string runtimeDir = Path.Combine(fullStateDir, "runtime");
            string runtimeFullRoot = Path.GetFullPath(runtimeDir);
            string baseDir = Path.Combine(fullStateDir, "base");
            string incomingDir = Path.Combine(fullStateDir, "incoming");

            AssertSafeManagedDirectory(fullStateDir, stateRoot);
            AssertSafeManagedDirectory(fullUserDir, userRoot);
            AssertSafeManagedDirectory(runtimeDir, stateRoot);
            AssertSafeManagedDirectory(baseDir, stateRoot);
            AssertSafeManagedDirectory(incomingDir, stateRoot);

            Directory.CreateDirectory(runtimeDir);
            Directory.CreateDirectory(fullUserDir);
            Directory.CreateDirectory(baseDir);

            Assembly asm = Assembly.GetExecutingAssembly();
            HashSet<string> expectedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int count = 0;
            for (int i = 0; i < entries.Count; i++)
            {
                PayloadEntry entry = entries[i];
                if (!string.Equals(entry.Category, "kernel", StringComparison.Ordinal))
                {
                    continue;
                }
                string dest = Path.GetFullPath(Path.Combine(runtimeDir, entry.RelativePath));
                if (!IsInsideRoot(dest, runtimeFullRoot))
                {
                    throw new InvalidOperationException("安全拦截：内核资源路径越出 runtime 目录：" + dest);
                }
                string destDir = Path.GetDirectoryName(dest) ?? runtimeDir;
                AssertSafeManagedDirectory(destDir, stateRoot);
                WriteResourceToFile(asm, entry.ResourceName, dest);
                expectedFiles.Add(dest);
                count++;
            }

            if (count == 0)
            {
                return 0;
            }

            PruneObsoletePluginEntries(runtimeDir, Path.GetFullPath(runtimeDir), expectedFiles, true);

            // Sync user-layer base templates safely without overwriting user customizations
            for (int u = 0; u < KernelUserLayerFileNames.Length; u++)
            {
                string fName = KernelUserLayerFileNames[u];
                string srcTemplate = Path.Combine(Path.Combine(runtimeDir, "user"), fName);
                if (!File.Exists(srcTemplate)) continue;

                string livePath = Path.Combine(userDir, fName);
                string basePath = Path.Combine(baseDir, fName);
                if (IsExistingReparsePoint(livePath) || IsExistingReparsePoint(basePath))
                {
                    throw new InvalidOperationException("安全拦截：拒绝覆盖符号链接或重解析点配置文件：" + livePath);
                }
                string srcHash = ComputeFileSha256(srcTemplate);

                if (!File.Exists(livePath))
                {
                    File.Copy(srcTemplate, livePath, true);
                    File.Copy(srcTemplate, basePath, true);
                }
                else
                {
                    string liveHash = ComputeFileSha256(livePath);
                    string baseHash = ComputeFileSha256(basePath);
                    if (string.Equals(liveHash, srcHash, StringComparison.OrdinalIgnoreCase))
                    {
                        if (!string.Equals(baseHash, srcHash, StringComparison.OrdinalIgnoreCase))
                        {
                            File.Copy(srcTemplate, basePath, true);
                        }
                    }
                    else if (!string.IsNullOrEmpty(baseHash) && string.Equals(liveHash, baseHash, StringComparison.OrdinalIgnoreCase))
                    {
                        File.Copy(srcTemplate, livePath, true);
                        File.Copy(srcTemplate, basePath, true);
                    }
                    else if (!string.Equals(baseHash, srcHash, StringComparison.OrdinalIgnoreCase))
                    {
                        AssertSafeManagedDirectory(incomingDir, stateRoot);
                        Directory.CreateDirectory(incomingDir);
                        string incFile = Path.Combine(incomingDir, fName);
                        if (IsExistingReparsePoint(incFile))
                        {
                            throw new InvalidOperationException("安全拦截：incoming 目标文件为重解析点：" + incFile);
                        }
                        File.Copy(srcTemplate, incFile, true);
                    }
                }
            }

            log(string.Format("[完成] 内置 Anti-Claude v3.1.9 运行时内核已部署至 {0}（共 {1} 个文件）", runtimeDir, count));

            if (activateHostDaemon)
            {
                EnsureDebugPortOnUserShortcuts(log);
                NodeRuntimeResolution rt = ResolveNodeOrElectronRuntime();
                string installScript = Path.Combine(runtimeDir, "install.mjs");
                if (rt != null && !string.IsNullOrEmpty(rt.ExePath) && File.Exists(installScript))
                {
                    try
                    {
                        bool keepAgentsRule = false;
                        string stateFile = Path.Combine(stateDir, "install-state.json");
                        if (File.Exists(stateFile))
                        {
                            try
                            {
                                string stRaw = File.ReadAllText(stateFile, Encoding.UTF8);
                                if (stRaw.IndexOf("\"agentsRule\": true", StringComparison.Ordinal) >= 0
                                    || stRaw.IndexOf("\"agentsRule\":true", StringComparison.Ordinal) >= 0)
                                {
                                    keepAgentsRule = true;
                                }
                            }
                            catch { }
                        }

                        string installArgs = keepAgentsRule
                            ? string.Format("\"{0}\" install --no-auto-update", installScript)
                            : string.Format("\"{0}\" install --no-auto-update --no-agents-rule", installScript);

                        bool finishedInTime = RunProcessNoHandleInherit(rt.ExePath, installArgs, runtimeDir, 25000, rt.UseElectronAsNode);
                        if (!finishedInTime)
                        {
                            log("  [提示] Anti-Claude 内核守护进程激活超时，将在下次登录时通过启动项自动拉起。");
                        }
                        else if (rt.UseElectronAsNode)
                        {
                            log("  [内核] 已复用 Antigravity 内置 Electron Node 运行时（ELECTRON_RUN_AS_NODE=1，免装 Node.js）激活后台守护进程与开机自启");
                        }
                        else
                        {
                            log("  [内核] 已激活 Anti-Claude v3.1.9 后台 CDP 守护进程与开机自启（无需再单独安装 Anti-Claude）");
                        }
                    }
                    catch (Exception ex)
                    {
                        log("  [提示] 自动拉起守护进程失败（内核文件已就位）：" + ex.Message);
                    }
                }
                else
                {
                    log("  [提示] 未检测到系统 Node.js (>=22) 或本机 Antigravity.exe；内核文件已就位，安装 Antigravity 或 Node.js 后重跑安装器即可自动拉起守护进程。");
                }
            }

            return count;
        }

        public static void UninstallKernel(string targetExtDir, bool deactivateHostDaemon, Action<string> log)
        {
            string stateDir;
            string userDir;
            ResolveAntiClaudeDirsFromExtDir(targetExtDir, out stateDir, out userDir);
            string runtimeDir = Path.Combine(stateDir, "runtime");
            string installScript = Path.Combine(runtimeDir, "install.mjs");

            if (deactivateHostDaemon)
            {
                NodeRuntimeResolution rt = ResolveNodeOrElectronRuntime();
                if (rt != null && !string.IsNullOrEmpty(rt.ExePath) && File.Exists(installScript))
                {
                    try
                    {
                        string uninstallArgs = string.Format("\"{0}\" uninstall", installScript);
                        RunProcessNoHandleInherit(rt.ExePath, uninstallArgs, runtimeDir, 20000, rt.UseElectronAsNode);
                    }
                    catch { }
                }

                // Fallback: ensure Windows Startup VBS is removed even if runtime was absent
                try
                {
                    string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                    string vbs = Path.Combine(Path.Combine(Path.Combine(Path.Combine(appData, "Microsoft"), "Windows"), "Start Menu"), @"Programs\Startup\Anti-Claude-Daemon.vbs");
                    if (File.Exists(vbs)) File.Delete(vbs);
                }
                catch { }
            }
            else
            {
                string baseDir = Path.Combine(stateDir, "base");
                for (int u = 0; u < KernelUserLayerFileNames.Length; u++)
                {
                    string fName = KernelUserLayerFileNames[u];
                    string livePath = Path.Combine(userDir, fName);
                    string basePath = Path.Combine(baseDir, fName);
                    if (File.Exists(livePath) && File.Exists(basePath)
                        && string.Equals(ComputeFileSha256(livePath), ComputeFileSha256(basePath), StringComparison.OrdinalIgnoreCase))
                    {
                        try { File.Delete(livePath); } catch { }
                    }
                }
                try { if (Directory.Exists(baseDir)) Directory.Delete(baseDir, true); } catch { }
                string incDir = Path.Combine(stateDir, "incoming");
                try { if (Directory.Exists(incDir)) Directory.Delete(incDir, true); } catch { }
            }

            if (Directory.Exists(runtimeDir) && !IsExistingReparsePoint(runtimeDir))
            {
                try
                {
                    Directory.Delete(runtimeDir, true);
                    log(string.Format("[完成] 已移除内置 Anti-Claude 运行时目录: {0}", runtimeDir));
                }
                catch (Exception ex)
                {
                    log("[提示] 清理 runtime 目录部分文件被占用：" + ex.Message);
                }
            }
        }

        public static string ResolveChromeBridgeTargetFromExtDir(string targetExtDir)
        {
            string stateDir;
            string userDir;
            ResolveAntiClaudeDirsFromExtDir(targetExtDir, out stateDir, out userDir);
            string fullState = TrimTrailingSepPreserveRoot(stateDir);
            string stateName = Path.GetFileName(fullState) ?? string.Empty;
            string stateParent = Path.GetDirectoryName(fullState);
            if (!string.IsNullOrEmpty(stateParent)
                && !string.Equals(stateParent, fullState, StringComparison.OrdinalIgnoreCase)
                && (string.Equals(stateName, "anti-claude", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(stateName, ".anti-claude", StringComparison.OrdinalIgnoreCase)))
            {
                return Path.Combine(Path.Combine(stateParent, "prism-suite"), "chrome-bridge");
            }
            return Path.Combine(Path.Combine(fullState, "prism-suite"), "chrome-bridge");
        }

        public static int InstallExtensions(string targetExtDir, List<PayloadEntry> entries, Action<string> log)
        {
            if (string.IsNullOrEmpty(targetExtDir) || targetExtDir.Trim().Length == 0)
            {
                throw new ArgumentException("Anti-Claude 扩展目标目录不能为空。");
            }

            string resolvedDir = Path.GetFullPath(targetExtDir.Trim());
            Directory.CreateDirectory(resolvedDir);

            Assembly asm = Assembly.GetExecutingAssembly();
            int count = 0;
            for (int i = 0; i < entries.Count; i++)
            {
                PayloadEntry entry = entries[i];
                if (!string.Equals(entry.Category, "extensions", StringComparison.Ordinal))
                {
                    continue;
                }
                string dest = Path.Combine(resolvedDir, entry.RelativePath);
                WriteResourceToFile(asm, entry.ResourceName, dest);
                count++;
                log(string.Format("  [扩展] 已写入: {0}", dest));
            }
            log(string.Format("[完成] Anti-Claude 棱镜扩展已安装至 {0}（共 {1} 个文件）", resolvedDir, count));

            // Deploy Chrome/Edge MV3 CUA Bridge unpacked directory alongside prism-suite state
            string bridgeDir = ResolveChromeBridgeTargetFromExtDir(targetExtDir);
            string bridgeRoot = Path.GetPathRoot(bridgeDir) ?? string.Empty;
            AssertSafeManagedDirectory(bridgeDir, bridgeRoot);
            HashSet<string> bridgeExpected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int bridgeCount = 0;
            for (int i = 0; i < entries.Count; i++)
            {
                PayloadEntry entry = entries[i];
                if (!string.Equals(entry.Category, "chrome-bridge", StringComparison.Ordinal))
                {
                    continue;
                }
                if (bridgeCount == 0)
                {
                    Directory.CreateDirectory(bridgeDir);
                }
                string dest = Path.GetFullPath(Path.Combine(bridgeDir, entry.RelativePath));
                if (!IsInsideRoot(dest, Path.GetFullPath(bridgeDir)))
                {
                    throw new InvalidOperationException("安全拦截：浏览器扩展桥路径越界：" + dest);
                }
                WriteResourceToFile(asm, entry.ResourceName, dest);
                bridgeExpected.Add(dest);
                bridgeCount++;
            }
            if (bridgeCount > 0)
            {
                PruneObsoletePluginEntries(bridgeDir, Path.GetFullPath(bridgeDir), bridgeExpected, true);
                log(string.Format("[完成] Chrome/Edge 受控浏览器桥扩展已部署至 {0}（共 {1} 个文件）", bridgeDir, bridgeCount));
            }

            return count;
        }

        public static int UninstallExtensions(string targetExtDir, Action<string> log)
        {
            if (string.IsNullOrEmpty(targetExtDir) || targetExtDir.Trim().Length == 0)
            {
                throw new ArgumentException("Anti-Claude 扩展目标目录不能为空。");
            }

            string resolvedDir = Path.GetFullPath(targetExtDir.Trim());
            for (int g = 0; g < GeneratedExtensionFileNames.Length; g++)
            {
                try
                {
                    File.Delete(Path.Combine(resolvedDir, GeneratedExtensionFileNames[g]));
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
            }
            int removed = 0;
            for (int i = 0; i < ExtensionFileNames.Length; i++)
            {
                string fp = Path.Combine(resolvedDir, ExtensionFileNames[i]);
                if (File.Exists(fp))
                {
                    File.Delete(fp);
                    removed++;
                    log(string.Format("  [扩展] 已移除: {0}", fp));
                }
            }
            if (removed == 0)
            {
                log(string.Format("[跳过] 未在 {0} 中发现 Prism Suite 扩展文件", resolvedDir));
            }
            else
            {
                log(string.Format("[完成] 已从 {0} 干净移除 {1} 个扩展文件（其余扩展已保留）", resolvedDir, removed));
            }

            string bridgeDir = ResolveChromeBridgeTargetFromExtDir(targetExtDir);
            if (Directory.Exists(bridgeDir) && !IsExistingReparsePoint(bridgeDir))
            {
                try
                {
                    Directory.Delete(bridgeDir, true);
                    log(string.Format("[完成] 已移除 Chrome/Edge 受控扩展桥目录: {0}", bridgeDir));
                    string suiteParent = Path.GetDirectoryName(bridgeDir);
                    if (!string.IsNullOrEmpty(suiteParent)
                        && string.Equals(Path.GetFileName(suiteParent), "prism-suite", StringComparison.OrdinalIgnoreCase)
                        && Directory.Exists(suiteParent)
                        && !IsExistingReparsePoint(suiteParent)
                        && Directory.GetFiles(suiteParent).Length == 0
                        && Directory.GetDirectories(suiteParent).Length == 0)
                    {
                        Directory.Delete(suiteParent, false);
                    }
                }
                catch (Exception ex)
                {
                    log("[提示] 清理 chrome-bridge 目录时部分文件占用：" + ex.Message);
                }
            }

            return removed;
        }

        public static int InstallPlugin(string rawPluginTargetDir, List<PayloadEntry> entries, Action<string> log)
        {
            string targetDir = NormalizePrismFilesTarget(rawPluginTargetDir);
            if (!string.Equals(Path.GetFileName(targetDir), "prism-files", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安全拦截：插件目录末尾必须为 prism-files：" + targetDir);
            }

            string parentPluginsDir = Path.GetDirectoryName(targetDir);
            if (!string.IsNullOrEmpty(parentPluginsDir))
            {
                Directory.CreateDirectory(parentPluginsDir);
            }

            bool existed = Directory.Exists(targetDir);
            // Preserve root directory inode in-place so running MCP server processes (Windows/WSL) never lose cwd
            Directory.CreateDirectory(targetDir);
            if (existed)
            {
                log(string.Format("  [插件] 正在原地增量更新（保留目录句柄）: {0}", targetDir));
            }

            Assembly asm = Assembly.GetExecutingAssembly();
            HashSet<string> expectedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int count = 0;
            for (int i = 0; i < entries.Count; i++)
            {
                PayloadEntry entry = entries[i];
                if (!string.Equals(entry.Category, "plugin", StringComparison.Ordinal))
                {
                    continue;
                }
                string dest = Path.GetFullPath(Path.Combine(targetDir, entry.RelativePath));
                WriteResourceToFile(asm, entry.ResourceName, dest);
                expectedFiles.Add(dest);
                count++;
            }

            int pruned = PruneObsoletePluginEntries(targetDir, Path.GetFullPath(targetDir), expectedFiles, true);
            if (pruned > 0)
            {
                log(string.Format("  [插件] 已清理 {0} 个旧版残留条目", pruned));
            }
            log(string.Format("[完成] Prism 工作台插件 (prism-files) 已部署至 {0}（共 {1} 个文件）", targetDir, count));

            // Deploy companion default-off CUA plugin (prism-cua) in-place preserving directory inode when present in manifest
            if (!string.IsNullOrEmpty(parentPluginsDir))
            {
                string cuaTargetDir = Path.GetFullPath(Path.Combine(parentPluginsDir, "prism-cua"));
                if (string.Equals(Path.GetFileName(cuaTargetDir), "prism-cua", StringComparison.OrdinalIgnoreCase)
                    && !IsExistingReparsePoint(cuaTargetDir))
                {
                    HashSet<string> cuaExpected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    int cuaCount = 0;
                    for (int i = 0; i < entries.Count; i++)
                    {
                        PayloadEntry entry = entries[i];
                        if (!string.Equals(entry.Category, "plugin-cua", StringComparison.Ordinal))
                        {
                            continue;
                        }
                        if (cuaCount == 0)
                        {
                            Directory.CreateDirectory(cuaTargetDir);
                        }
                        string cuaDest = Path.GetFullPath(Path.Combine(cuaTargetDir, entry.RelativePath));
                        if (!IsInsideRoot(cuaDest, cuaTargetDir))
                        {
                            throw new InvalidOperationException("安全拦截：prism-cua 资源路径越界：" + cuaDest);
                        }
                        WriteResourceToFile(asm, entry.ResourceName, cuaDest);
                        cuaExpected.Add(cuaDest);
                        cuaCount++;
                    }
                    if (cuaCount > 0)
                    {
                        PruneObsoletePluginEntries(cuaTargetDir, cuaTargetDir, cuaExpected, true);
                        log(string.Format("[完成] Prism 电脑操控受控插件 (prism-cua，默认关闭) 已部署至 {0}（共 {1} 个文件）", cuaTargetDir, cuaCount));
                        count += cuaCount;
                    }
                }
            }

            return count;
        }

        private static bool IsReparsePoint(string path)
        {
            try
            {
                FileAttributes attrs = File.GetAttributes(path);
                return (attrs & FileAttributes.ReparsePoint) != 0;
            }
            catch
            {
                return true;
            }
        }

        private static bool IsInsideRoot(string fullPath, string rootFull)
        {
            string normRoot = rootFull.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return fullPath.StartsWith(normRoot, StringComparison.OrdinalIgnoreCase);
        }

        private static int PruneObsoletePluginEntries(string dirPath, string rootFull, HashSet<string> expectedFiles, bool isRoot)
        {
            int removed = 0;
            try
            {
                if (!isRoot && IsReparsePoint(dirPath))
                {
                    return 0;
                }
                string[] files = Directory.GetFiles(dirPath);
                for (int i = 0; i < files.Length; i++)
                {
                    string full = Path.GetFullPath(files[i]);
                    if (!IsInsideRoot(full, rootFull) || IsReparsePoint(full))
                    {
                        continue;
                    }
                    if (!expectedFiles.Contains(full))
                    {
                        try
                        {
                            File.Delete(full);
                            removed++;
                        }
                        catch
                        {
                            // Ignore transient lock on non-critical stale file
                        }
                    }
                }
                string[] subDirs = Directory.GetDirectories(dirPath);
                for (int i = 0; i < subDirs.Length; i++)
                {
                    string subFull = Path.GetFullPath(subDirs[i]);
                    if (!IsInsideRoot(subFull, rootFull) || IsReparsePoint(subFull))
                    {
                        continue;
                    }
                    removed += PruneObsoletePluginEntries(subFull, rootFull, expectedFiles, false);
                }
                if (!isRoot && Directory.GetFiles(dirPath).Length == 0 && Directory.GetDirectories(dirPath).Length == 0)
                {
                    try
                    {
                        Directory.Delete(dirPath, false);
                        removed++;
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }
            return removed;
        }

        public static string CheckDebugPortShortcutStatus()
        {
            try
            {
                List<string> searchRoots = new List<string>();
                HashSet<string> seenRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                string[] candidates = new string[]
                {
                    GetUserDesktopFolderPath(),
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory),
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                    Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms)
                };
                for (int i = 0; i < candidates.Length; i++)
                {
                    if (!string.IsNullOrEmpty(candidates[i]) && seenRoots.Add(candidates[i]) && Directory.Exists(candidates[i]))
                    {
                        searchRoots.Add(candidates[i]);
                    }
                }

                int foundShortcuts = 0;
                int withDebugPort = 0;
                for (int r = 0; r < searchRoots.Count; r++)
                {
                    string[] links;
                    try
                    {
                        links = Directory.GetFiles(searchRoots[r], "*Antigravity*.lnk", SearchOption.AllDirectories);
                    }
                    catch
                    {
                        continue;
                    }
                    for (int k = 0; k < links.Length; k++)
                    {
                        try
                        {
                            string targetPath;
                            string args;
                            if (TryReadShortcut(links[k], out targetPath, out args))
                            {
                                if (!string.IsNullOrEmpty(targetPath)
                                    && !targetPath.EndsWith("Antigravity.exe", StringComparison.OrdinalIgnoreCase))
                                {
                                    continue;
                                }
                                foundShortcuts++;
                                if (!string.IsNullOrEmpty(args)
                                    && args.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0)
                                {
                                    withDebugPort++;
                                }
                                continue;
                            }

                            foundShortcuts++;
                            byte[] raw = File.ReadAllBytes(links[k]);
                            string ascii = Encoding.ASCII.GetString(raw);
                            string utf16 = Encoding.Unicode.GetString(raw);
                            if (ascii.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0
                                || utf16.IndexOf("--remote-debugging-port", StringComparison.OrdinalIgnoreCase) >= 0)
                            {
                                withDebugPort++;
                            }
                        }
                        catch
                        {
                        }
                    }
                }

                if (withDebugPort > 0)
                {
                    return string.Format("已检测到 {0}/{1} 个 Antigravity 快捷方式包含 --remote-debugging-port（支持启动后直接挂载内置内核与扩展）", withDebugPort, foundShortcuts);
                }
                if (foundShortcuts > 0)
                {
                    return string.Format("检测到 {0} 个 Antigravity 快捷方式未开启调试端口；点击「一键安装」时将自动补齐 --remote-debugging-port=0", foundShortcuts);
                }
                return "未在桌面/开始菜单扫描到 Antigravity 快捷方式（切号自动重启时会自动附带调试端口参数）";
            }
            catch
            {
                return "快捷方式调试端口自检已跳过";
            }
        }

        public static bool UninstallPlugin(string rawPluginTargetDir, Action<string> log)
        {
            string targetDir = NormalizePrismFilesTarget(rawPluginTargetDir);
            if (!string.Equals(Path.GetFileName(targetDir), "prism-files", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException("安全拦截：拒绝删除非 prism-files 目录：" + targetDir);
            }

            bool removedAny = false;
            if (Directory.Exists(targetDir) && !IsExistingReparsePoint(targetDir))
            {
                Directory.Delete(targetDir, true);
                log(string.Format("[完成] 已干净移除插件目录: {0}（其余同级插件未受影响）", targetDir));
                removedAny = true;
            }
            else
            {
                log(string.Format("[跳过] 未发现插件目录: {0}", targetDir));
            }

            string parentPluginsDir = Path.GetDirectoryName(targetDir);
            if (!string.IsNullOrEmpty(parentPluginsDir))
            {
                string cuaTargetDir = Path.GetFullPath(Path.Combine(parentPluginsDir, "prism-cua"));
                if (string.Equals(Path.GetFileName(cuaTargetDir), "prism-cua", StringComparison.OrdinalIgnoreCase)
                    && Directory.Exists(cuaTargetDir)
                    && !IsExistingReparsePoint(cuaTargetDir))
                {
                    Directory.Delete(cuaTargetDir, true);
                    log(string.Format("[完成] 已干净移除插件目录: {0}", cuaTargetDir));
                    removedAny = true;
                }
            }

            return removedAny;
        }

        public static WslDetectionResult DetectWslPluginTargets()
        {
            WslDetectionResult result = new WslDetectionResult();
            List<string> distros = ListWslDistrosWithTimeout(3000);
            result.DistrosChecked.AddRange(distros);

            HashSet<string> seenTargets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < distros.Count; i++)
            {
                string distro = distros[i];
                if (string.Equals(distro, "docker-desktop", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(distro, "docker-desktop-data", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                bool foundForDistro = false;
                string linuxHome = QueryWslHomeWithTimeout(distro, 3000);
                if (!string.IsNullOrEmpty(linuxHome))
                {
                    string relHome = linuxHome.Trim().TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string uncUserHome = ResolveWslUncPath(distro, relHome);
                    if (!string.IsNullOrEmpty(uncUserHome))
                    {
                        string target = TryBuildGeminiPluginTarget(uncUserHome);
                        if (!string.IsNullOrEmpty(target))
                        {
                            foundForDistro = true;
                            if (seenTargets.Add(target))
                            {
                                result.Targets.Add(target);
                            }
                        }
                    }
                }

                // Fallback: scan /home/* if $HOME query failed or did not point to an existing .gemini directory.
                if (!foundForDistro)
                {
                    string homeRoot = ResolveWslUncPath(distro, "home");
                    if (!string.IsNullOrEmpty(homeRoot))
                    {
                        try
                        {
                            string[] userDirs = Directory.GetDirectories(homeRoot);
                            for (int u = 0; u < userDirs.Length; u++)
                            {
                                string target = TryBuildGeminiPluginTarget(userDirs[u]);
                                if (!string.IsNullOrEmpty(target) && seenTargets.Add(target))
                                {
                                    result.Targets.Add(target);
                                }
                            }
                        }
                        catch
                        {
                            // Safely ignore inaccessible or stopped distro shares.
                        }
                    }
                }
            }

            if (result.Targets.Count > 0)
            {
                result.Summary = string.Format("已检测到 {0} 个 WSL 目标：{1}",
                    result.Targets.Count,
                    string.Join("；", result.Targets.ToArray()));
            }
            else if (distros.Count > 0)
            {
                result.Summary = string.Format("检测到 WSL 发行版（{0}），但未发现 ~/.gemini 目录（已跳过）",
                    string.Join(", ", distros.ToArray()));
            }
            else
            {
                result.Summary = "未检测到可用的 WSL 环境（仅安装至 Windows 本地目录）";
            }
            return result;
        }

        private static string TryBuildGeminiPluginTarget(string userHomeUnc)
        {
            try
            {
                string geminiDir = Path.Combine(userHomeUnc, ".gemini");
                string pluginsDir = Path.Combine(Path.Combine(geminiDir, "config"), "plugins");
                if (Directory.Exists(pluginsDir) || Directory.Exists(geminiDir))
                {
                    return Path.Combine(pluginsDir, "prism-files");
                }
            }
            catch
            {
                // Ignore transient UNC errors.
            }
            return null;
        }

        private static string ResolveWslUncPath(string distro, string relativeSubPath)
        {
            if (string.IsNullOrEmpty(distro) || !Regex.IsMatch(distro, "^[A-Za-z0-9._-]+$"))
            {
                return null;
            }
            string[] prefixes = new string[]
            {
                @"\\wsl.localhost\" + distro,
                @"\\wsl$\" + distro
            };
            for (int i = 0; i < prefixes.Length; i++)
            {
                try
                {
                    string candidate = string.IsNullOrEmpty(relativeSubPath)
                        ? prefixes[i]
                        : Path.Combine(prefixes[i], relativeSubPath);
                    if (Directory.Exists(candidate))
                    {
                        return candidate;
                    }
                }
                catch
                {
                    // Try next UNC prefix.
                }
            }
            return null;
        }

        private static string QueryWslHomeWithTimeout(string distro, int timeoutMs)
        {
            if (string.IsNullOrEmpty(distro) || !Regex.IsMatch(distro, "^[A-Za-z0-9._-]+$"))
            {
                return null;
            }
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "wsl.exe";
                psi.Arguments = string.Format("-d \"{0}\" -- sh -c \"printf %s \\\"$HOME\\\" </dev/null\"", distro);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;

                string raw = RunProcessAndReadStdout(psi, timeoutMs);
                if (string.IsNullOrEmpty(raw))
                {
                    return null;
                }
                string[] lines = raw.Replace("\uFEFF", string.Empty).Replace("\0", string.Empty)
                    .Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = lines.Length - 1; i >= 0; i--)
                {
                    string candidate = lines[i].Trim();
                    if (candidate.StartsWith("/", StringComparison.Ordinal))
                    {
                        return candidate;
                    }
                }
            }
            catch
            {
                // Safely ignore query failures and let fallback handle it.
            }
            return null;
        }

        private static List<string> ListWslDistrosWithTimeout(int timeoutMs)
        {
            List<string> distros = new List<string>();
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "wsl.exe";
                psi.Arguments = "-l -q";
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.EnvironmentVariables.Remove("WSL_UTF8");
                psi.StandardOutputEncoding = Encoding.Unicode;

                string raw = RunProcessAndReadStdout(psi, timeoutMs);
                if (string.IsNullOrEmpty(raw))
                {
                    return distros;
                }

                string cleaned = raw.Replace("\uFEFF", string.Empty).Replace("\0", string.Empty);
                string[] lines = cleaned.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                for (int i = 0; i < lines.Length; i++)
                {
                    string name = lines[i].Trim();
                    if (name.Length > 0 && SafeWslDistroRegex.IsMatch(name) && seen.Add(name))
                    {
                        distros.Add(name);
                    }
                }
            }
            catch
            {
                // WSL not installed or unavailable; safely ignore.
            }
            return distros;
        }

        private static string RunProcessAndReadStdout(ProcessStartInfo psi, int timeoutMs)
        {
            StringBuilder output = new StringBuilder();
            psi.RedirectStandardInput = true;
            using (ManualResetEvent outDone = new ManualResetEvent(false))
            using (ManualResetEvent errDone = new ManualResetEvent(false))
            using (Process proc = new Process())
            {
                proc.StartInfo = psi;
                proc.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null)
                    {
                        try { outDone.Set(); } catch { }
                    }
                    else
                    {
                        lock (output)
                        {
                            output.AppendLine(e.Data);
                        }
                    }
                };
                proc.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null)
                    {
                        try { errDone.Set(); } catch { }
                    }
                };

                if (!proc.Start())
                {
                    return null;
                }
                try { proc.StandardInput.Close(); } catch { }
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                if (!proc.WaitForExit(timeoutMs))
                {
                    try { proc.CancelOutputRead(); } catch { }
                    try { proc.CancelErrorRead(); } catch { }
                    try { proc.Kill(); } catch { }
                    return null;
                }
                outDone.WaitOne(400);
                errDone.WaitOne(200);
                try { proc.CancelOutputRead(); } catch { }
                try { proc.CancelErrorRead(); } catch { }
            }

            lock (output)
            {
                return output.ToString();
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private CheckBox chkExtensions;
        private CheckBox chkWinPlugin;
        private CheckBox chkWslPlugin;
        private Label lblWslStatus;
        private TextBox txtExtDir;
        private Button btnBrowseExt;
        private TextBox txtPluginDir;
        private Button btnBrowsePlugin;
        private Button btnInstall;
        private Button btnUninstall;
        private Label lblStatus;
        private TextBox txtLog;

        private readonly List<PayloadEntry> manifestEntries;
        private List<string> detectedWslTargets = new List<string>();
        private volatile bool isBusy;

        public MainForm(List<PayloadEntry> entries)
        {
            manifestEntries = entries;
            InitializeUi();
            Shown += OnFormShown;
        }

        private void InitializeUi()
        {
            Text = "Anti-Claude Prism Suite 一键安装器 v0.9.0（独立完整版）";
            Size = new Size(740, 660);
            MinimumSize = new Size(660, 580);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            BackColor = Color.FromArgb(248, 250, 252);
            ForeColor = Color.FromArgb(15, 23, 42);
            Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);

            // Header banner
            Panel header = new Panel();
            header.Dock = DockStyle.Top;
            header.Height = 84;
            header.BackColor = Color.FromArgb(15, 23, 42);
            header.Padding = new Padding(22, 16, 22, 14);
            header.Paint += PaintHeaderAccent;

            Label lblTitle = new Label();
            lblTitle.Text = "Anti-Claude Prism Suite 一键安装器  v0.9.0";
            lblTitle.ForeColor = Color.White;
            lblTitle.Font = new Font("Microsoft YaHei UI", 13.5f, FontStyle.Bold);
            lblTitle.AutoSize = true;
            lblTitle.Location = new Point(22, 15);

            Label lblSubtitle = new Label();
            lblSubtitle.Text = "已内嵌 Anti-Claude v3.1.9 内核 + 棱镜扩展 + Prism 七合一工作台 + 受控电脑操控桥（零前置依赖）";
            lblSubtitle.ForeColor = Color.FromArgb(148, 163, 184);
            lblSubtitle.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Regular);
            lblSubtitle.AutoSize = true;
            lblSubtitle.Location = new Point(22, 48);

            header.Controls.Add(lblTitle);
            header.Controls.Add(lblSubtitle);

            // Main container
            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.ColumnCount = 1;
            root.RowCount = 4;
            root.Padding = new Padding(18, 14, 18, 16);
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));

            // Card 1: Components
            Panel cardComponents = CreateCardPanel();
            TableLayoutPanel compLayout = new TableLayoutPanel();
            compLayout.Dock = DockStyle.Top;
            compLayout.AutoSize = true;
            compLayout.ColumnCount = 1;
            compLayout.Padding = new Padding(14, 12, 14, 12);

            Label lblCompHeader = CreateSectionTitle("1. 选择安装 / 卸载组件");
            chkExtensions = new CheckBox();
            chkExtensions.Text = "内置 Anti-Claude v3.1.9 内核 + 棱镜扩展套件（8套主题 / 大纲 / 12周热力图 / 像素伙伴 / 思考中译）";
            chkExtensions.Checked = true;
            chkExtensions.AutoSize = true;
            chkExtensions.Margin = new Padding(2, 6, 2, 4);

            chkWinPlugin = new CheckBox();
            chkWinPlugin.Text = "安装 Prism 工作台与受控电脑操控插件（prism-files + 默认关闭的 prism-cua）";
            chkWinPlugin.Checked = true;
            chkWinPlugin.AutoSize = true;
            chkWinPlugin.Margin = new Padding(2, 4, 2, 4);

            chkWslPlugin = new CheckBox();
            chkWslPlugin.Text = "同步安装至检测到的 WSL Antigravity 环境";
            chkWslPlugin.Checked = false;
            chkWslPlugin.Enabled = false;
            chkWslPlugin.AutoSize = true;
            chkWslPlugin.Margin = new Padding(2, 4, 2, 2);

            lblWslStatus = new Label();
            lblWslStatus.Text = "正在后台检测 WSL Antigravity 环境...";
            lblWslStatus.ForeColor = Color.FromArgb(100, 116, 139);
            lblWslStatus.Font = new Font("Microsoft YaHei UI", 8.5f, FontStyle.Regular);
            lblWslStatus.AutoSize = true;
            lblWslStatus.MaximumSize = new Size(650, 0);
            lblWslStatus.Margin = new Padding(22, 0, 2, 2);

            compLayout.Controls.Add(lblCompHeader);
            compLayout.Controls.Add(chkExtensions);
            compLayout.Controls.Add(chkWinPlugin);
            compLayout.Controls.Add(chkWslPlugin);
            compLayout.Controls.Add(lblWslStatus);
            cardComponents.Controls.Add(compLayout);
            cardComponents.Margin = new Padding(0, 0, 0, 10);

            // Card 2: Paths
            Panel cardPaths = CreateCardPanel();
            TableLayoutPanel pathLayout = new TableLayoutPanel();
            pathLayout.Dock = DockStyle.Top;
            pathLayout.AutoSize = true;
            pathLayout.ColumnCount = 2;
            pathLayout.Padding = new Padding(14, 12, 14, 12);
            pathLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            pathLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            Label lblPathHeader = CreateSectionTitle("2. 目标目录配置");
            pathLayout.SetColumnSpan(lblPathHeader, 2);
            pathLayout.Controls.Add(lblPathHeader, 0, 0);

            Label lblExtDir = new Label();
            lblExtDir.Text = "Windows Anti-Claude 扩展目录（自动同步同级 runtime 内核）：";
            lblExtDir.AutoSize = true;
            lblExtDir.ForeColor = Color.FromArgb(51, 65, 85);
            lblExtDir.Margin = new Padding(0, 6, 0, 2);
            pathLayout.SetColumnSpan(lblExtDir, 2);
            pathLayout.Controls.Add(lblExtDir, 0, 1);

            txtExtDir = new TextBox();
            txtExtDir.Text = InstallerCore.GetDefaultExtensionsDir();
            txtExtDir.Dock = DockStyle.Fill;
            txtExtDir.Margin = new Padding(0, 2, 8, 6);

            btnBrowseExt = new Button();
            btnBrowseExt.Text = "浏览...";
            btnBrowseExt.AutoSize = true;
            btnBrowseExt.Padding = new Padding(8, 2, 8, 2);
            btnBrowseExt.Margin = new Padding(0, 1, 0, 6);
            btnBrowseExt.Click += OnBrowseExtClick;

            pathLayout.Controls.Add(txtExtDir, 0, 2);
            pathLayout.Controls.Add(btnBrowseExt, 1, 2);

            Label lblPluginDir = new Label();
            lblPluginDir.Text = "Windows Antigravity 插件目录：";
            lblPluginDir.AutoSize = true;
            lblPluginDir.ForeColor = Color.FromArgb(51, 65, 85);
            lblPluginDir.Margin = new Padding(0, 4, 0, 2);
            pathLayout.SetColumnSpan(lblPluginDir, 2);
            pathLayout.Controls.Add(lblPluginDir, 0, 3);

            txtPluginDir = new TextBox();
            txtPluginDir.Text = InstallerCore.GetDefaultPluginDir();
            txtPluginDir.Dock = DockStyle.Fill;
            txtPluginDir.Margin = new Padding(0, 2, 8, 2);

            btnBrowsePlugin = new Button();
            btnBrowsePlugin.Text = "浏览...";
            btnBrowsePlugin.AutoSize = true;
            btnBrowsePlugin.Padding = new Padding(8, 2, 8, 2);
            btnBrowsePlugin.Margin = new Padding(0, 1, 0, 2);
            btnBrowsePlugin.Click += OnBrowsePluginClick;

            pathLayout.Controls.Add(txtPluginDir, 0, 4);
            pathLayout.Controls.Add(btnBrowsePlugin, 1, 4);

            cardPaths.Controls.Add(pathLayout);
            cardPaths.Margin = new Padding(0, 0, 0, 12);

            // Action bar
            TableLayoutPanel actionBar = new TableLayoutPanel();
            actionBar.Dock = DockStyle.Top;
            actionBar.AutoSize = true;
            actionBar.ColumnCount = 3;
            actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            actionBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
            actionBar.Margin = new Padding(0, 0, 0, 10);

            btnInstall = new Button();
            btnInstall.Text = "一键安装 / 更新";
            btnInstall.Size = new Size(168, 38);
            btnInstall.BackColor = Color.FromArgb(37, 99, 235);
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Font = new Font("Microsoft YaHei UI", 10f, FontStyle.Bold);
            btnInstall.Cursor = Cursors.Hand;
            btnInstall.Margin = new Padding(0, 0, 10, 0);
            btnInstall.Click += OnInstallClick;

            btnUninstall = new Button();
            btnUninstall.Text = "干净卸载";
            btnUninstall.Size = new Size(124, 38);
            btnUninstall.BackColor = Color.White;
            btnUninstall.ForeColor = Color.FromArgb(51, 65, 85);
            btnUninstall.FlatStyle = FlatStyle.Flat;
            btnUninstall.FlatAppearance.BorderColor = Color.FromArgb(203, 213, 225);
            btnUninstall.FlatAppearance.BorderSize = 1;
            btnUninstall.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);
            btnUninstall.Cursor = Cursors.Hand;
            btnUninstall.Margin = new Padding(0, 0, 12, 0);
            btnUninstall.Click += OnUninstallClick;

            lblStatus = new Label();
            lblStatus.Text = "就绪";
            lblStatus.ForeColor = Color.FromArgb(100, 116, 139);
            lblStatus.Dock = DockStyle.Fill;
            lblStatus.TextAlign = ContentAlignment.MiddleRight;

            actionBar.Controls.Add(btnInstall, 0, 0);
            actionBar.Controls.Add(btnUninstall, 1, 0);
            actionBar.Controls.Add(lblStatus, 2, 0);

            // Log area
            Panel logCard = CreateCardPanel();
            logCard.Dock = DockStyle.Fill;
            logCard.Padding = new Padding(12, 10, 12, 12);

            Label lblLogTitle = CreateSectionTitle("执行日志");
            lblLogTitle.Dock = DockStyle.Top;
            lblLogTitle.Padding = new Padding(0, 0, 0, 6);

            txtLog = new TextBox();
            txtLog.Dock = DockStyle.Fill;
            txtLog.Multiline = true;
            txtLog.ReadOnly = true;
            txtLog.ScrollBars = ScrollBars.Vertical;
            txtLog.WordWrap = true;
            txtLog.BorderStyle = BorderStyle.FixedSingle;
            txtLog.BackColor = Color.FromArgb(248, 250, 252);
            txtLog.ForeColor = Color.FromArgb(30, 41, 59);
            txtLog.Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Regular);

            logCard.Controls.Add(txtLog);
            logCard.Controls.Add(lblLogTitle);

            root.Controls.Add(cardComponents, 0, 0);
            root.Controls.Add(cardPaths, 0, 1);
            root.Controls.Add(actionBar, 0, 2);
            root.Controls.Add(logCard, 0, 3);

            Controls.Add(root);
            Controls.Add(header);
        }

        private static void PaintHeaderAccent(object sender, PaintEventArgs e)
        {
            Panel p = sender as Panel;
            if (p == null) return;
            using (SolidBrush b = new SolidBrush(Color.FromArgb(37, 99, 235)))
            {
                e.Graphics.FillRectangle(b, 0, p.Height - 3, p.Width, 3);
            }
        }

        private static Panel CreateCardPanel()
        {
            Panel p = new Panel();
            p.Dock = DockStyle.Top;
            p.AutoSize = true;
            p.BackColor = Color.White;
            p.BorderStyle = BorderStyle.FixedSingle;
            return p;
        }

        private static Label CreateSectionTitle(string text)
        {
            Label lbl = new Label();
            lbl.Text = text;
            lbl.ForeColor = Color.FromArgb(15, 23, 42);
            lbl.Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold);
            lbl.AutoSize = true;
            lbl.Margin = new Padding(0, 0, 0, 4);
            return lbl;
        }

        private void OnFormShown(object sender, EventArgs e)
        {
            AppendLog(string.Format("已载入内嵌资源清单：共 {0} 个文件（含内置 Anti-Claude v3.1.9 内核）。", manifestEntries.Count));
            AppendLog("正在检测 WSL Antigravity 环境（最多等待 3 秒）...");

            ThreadPool.QueueUserWorkItem(delegate
            {
                WslDetectionResult wsl = InstallerCore.DetectWslPluginTargets();
                string shortcutNote = InstallerCore.CheckDebugPortShortcutStatus();
                if (!IsDisposed)
                {
                    try
                    {
                        BeginInvoke((MethodInvoker)delegate
                        {
                            detectedWslTargets = wsl.Targets;
                            lblWslStatus.Text = wsl.Summary;
                            if (detectedWslTargets.Count > 0)
                            {
                                chkWslPlugin.Enabled = true;
                                chkWslPlugin.Checked = true;
                                lblWslStatus.ForeColor = Color.FromArgb(21, 128, 61);
                                AppendLog("[检测] " + wsl.Summary);
                            }
                            else
                            {
                                chkWslPlugin.Enabled = false;
                                chkWslPlugin.Checked = false;
                                lblWslStatus.ForeColor = Color.FromArgb(100, 116, 139);
                                AppendLog("[检测] " + wsl.Summary);
                            }
                            AppendLog("[自检] " + shortcutNote);
                        });
                    }
                    catch
                    {
                        // Window already closed.
                    }
                }
            });
        }

        private void OnBrowseExtClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择 Anti-Claude user\\extensions 目录";
                dlg.SelectedPath = txtExtDir.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath))
                {
                    txtExtDir.Text = dlg.SelectedPath;
                }
            }
        }

        private void OnBrowsePluginClick(object sender, EventArgs e)
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "选择 Antigravity 插件目录（将安装至 prism-files 子目录）";
                dlg.SelectedPath = txtPluginDir.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath))
                {
                    txtPluginDir.Text = InstallerCore.NormalizePrismFilesTarget(dlg.SelectedPath);
                }
            }
        }

        private void OnInstallClick(object sender, EventArgs e)
        {
            RunOperation(true, false);
        }

        private void OnUninstallClick(object sender, EventArgs e)
        {
            if (isBusy) return;

            bool doExt = chkExtensions.Checked;
            bool doWinPlugin = chkWinPlugin.Checked;
            bool doWsl = chkWslPlugin.Enabled && chkWslPlugin.Checked && detectedWslTargets.Count > 0;
            if (!doExt && !doWinPlugin && !doWsl)
            {
                MessageBox.Show(this, "请至少勾选一个需要卸载的组件。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            bool alsoRemoveKernel = false;
            if (doExt)
            {
                DialogResult choice = MessageBox.Show(
                    this,
                    "请选择卸载范围：\n\n• 点击【是】：彻底卸载棱镜扩展、工作台插件 及 内置 Anti-Claude 守护进程（恢复原版 Antigravity）\n• 点击【否】：仅移除棱镜扩展（6个文件）与 prism-files 插件，保留 Anti-Claude 基础内核\n• 点击【取消】：放弃操作",
                    "确认干净卸载",
                    MessageBoxButtons.YesNoCancel,
                    MessageBoxIcon.Question);
                if (choice == DialogResult.Cancel) return;
                alsoRemoveKernel = (choice == DialogResult.Yes);
            }
            else
            {
                DialogResult confirm = MessageBox.Show(
                    this,
                    "确定要干净移除选中的 prism-files 工作台插件目录吗？（不会影响其他插件或会话数据）",
                    "确认干净卸载",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (confirm != DialogResult.Yes) return;
            }

            RunOperation(false, alsoRemoveKernel);
        }

        private void RunOperation(bool isInstall, bool removeKernelOnUninstall)
        {
            if (isBusy) return;

            bool doExt = chkExtensions.Checked;
            bool doWinPlugin = chkWinPlugin.Checked;
            bool doWsl = chkWslPlugin.Enabled && chkWslPlugin.Checked && detectedWslTargets.Count > 0;

            if (!doExt && !doWinPlugin && !doWsl)
            {
                MessageBox.Show(this, "请至少勾选一个组件。", "提示", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            string extDir = txtExtDir.Text;
            string winPluginDir = txtPluginDir.Text;
            List<string> wslTargetsSnapshot = new List<string>(detectedWslTargets);

            SetBusyState(true, isInstall ? "正在安装..." : "正在卸载...");
            AppendLog(isInstall ? "=== 开始一键安装 / 更新（独立完整版） ===" : "=== 开始干净卸载 ===");

            Thread worker = new Thread(delegate()
            {
                string errorMessage = null;
                try
                {
                    Action<string> uiLog = delegate(string msg)
                    {
                        SafeInvoke(delegate { AppendLog(msg); });
                    };

                    if (isInstall)
                    {
                        if (doExt)
                        {
                            InstallerCore.InstallKernel(extDir, manifestEntries, true, uiLog);
                            InstallerCore.InstallExtensions(extDir, manifestEntries, uiLog);
                        }
                        if (doWinPlugin)
                        {
                            InstallerCore.InstallPlugin(winPluginDir, manifestEntries, uiLog);
                        }
                        if (doWsl)
                        {
                            for (int i = 0; i < wslTargetsSnapshot.Count; i++)
                            {
                                InstallerCore.InstallPlugin(wslTargetsSnapshot[i], manifestEntries, uiLog);
                            }
                        }
                    }
                    else
                    {
                        if (doExt)
                        {
                            InstallerCore.UninstallExtensions(extDir, uiLog);
                            if (removeKernelOnUninstall)
                            {
                                InstallerCore.UninstallKernel(extDir, true, uiLog);
                            }
                        }
                        if (doWinPlugin)
                        {
                            InstallerCore.UninstallPlugin(winPluginDir, uiLog);
                        }
                        if (doWsl)
                        {
                            for (int i = 0; i < wslTargetsSnapshot.Count; i++)
                            {
                                InstallerCore.UninstallPlugin(wslTargetsSnapshot[i], uiLog);
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    errorMessage = ex.Message;
                }

                SafeInvoke(delegate
                {
                    SetBusyState(false, errorMessage == null ? "已完成" : "发生错误");
                    if (errorMessage != null)
                    {
                        AppendLog("[错误] " + errorMessage);
                        MessageBox.Show(this, "操作失败：\n" + errorMessage, "错误", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    }
                    else
                    {
                        AppendLog(isInstall
                            ? "=== 全部安装已完成！重启一次 Antigravity 即可全面启用内置内核、扩展与工作台插件 ==="
                            : "=== 干净卸载已完成 ===");
                        MessageBox.Show(
                            this,
                            isInstall
                                ? "Anti-Claude Prism Suite v0.9.0（独立完整版）安装成功！\n\n已一并部署内置 Anti-Claude v3.1.9 增强内核、棱镜扩展套件、Chrome/Edge 扩展桥与双插件（prism-files + 默认关闭零开销的 prism-cua）。若 Antigravity 正在运行，重启一次应用即可全面生效。"
                                : "已干净卸载选中的 Anti-Claude Prism Suite 组件。",
                            isInstall ? "安装成功" : "卸载完成",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information);
                    }
                });
            });
            worker.IsBackground = true;
            try { worker.SetApartmentState(ApartmentState.STA); } catch { }
            worker.Start();
        }

        private void SetBusyState(bool busy, string statusText)
        {
            isBusy = busy;
            btnInstall.Enabled = !busy;
            btnUninstall.Enabled = !busy;
            btnBrowseExt.Enabled = !busy;
            btnBrowsePlugin.Enabled = !busy;
            txtExtDir.Enabled = !busy;
            txtPluginDir.Enabled = !busy;
            chkExtensions.Enabled = !busy;
            chkWinPlugin.Enabled = !busy;
            chkWslPlugin.Enabled = !busy && detectedWslTargets.Count > 0;
            lblStatus.Text = statusText;
        }

        private void SafeInvoke(MethodInvoker action)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired)
                {
                    BeginInvoke(action);
                }
                else
                {
                    action();
                }
            }
            catch
            {
                // Ignore if form disposed during shutdown.
            }
        }

        private void AppendLog(string message)
        {
            string line = string.Format("[{0}] {1}", DateTime.Now.ToString("HH:mm:ss"), message);
            if (txtLog.TextLength > 0)
            {
                txtLog.AppendText(Environment.NewLine);
            }
            txtLog.AppendText(line);
        }
    }

    internal static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [STAThread]
        private static int Main(string[] args)
        {
            try
            {
                SetProcessDPIAware();
            }
            catch
            {
                // Ignore on unsupported environments.
            }

            CliOptions opts = ParseArgs(args);
            if (opts.SilentInstall || opts.SilentUninstall)
            {
                return RunSilent(opts);
            }

            List<PayloadEntry> entries;
            try
            {
                entries = InstallerCore.LoadManifest();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "无法加载安装程序内置资源：\n" + ex.Message,
                    "Anti-Claude Prism Suite 安装器",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return 1;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(entries));
            return 0;
        }

        private static CliOptions ParseArgs(string[] args)
        {
            CliOptions opts = new CliOptions();
            if (args == null) return opts;

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "--silent-install", StringComparison.OrdinalIgnoreCase))
                {
                    opts.SilentInstall = true;
                }
                else if (string.Equals(a, "--silent-uninstall", StringComparison.OrdinalIgnoreCase))
                {
                    opts.SilentUninstall = true;
                }
                else if (string.Equals(a, "--with-kernel", StringComparison.OrdinalIgnoreCase))
                {
                    opts.WithKernel = true;
                }
                else if (string.Equals(a, "--no-wsl", StringComparison.OrdinalIgnoreCase))
                {
                    opts.NoWsl = true;
                }
                else if (a.StartsWith("--test-user-dir=", StringComparison.OrdinalIgnoreCase))
                {
                    opts.TestUserDir = a.Substring("--test-user-dir=".Length);
                }
                else if (string.Equals(a, "--test-user-dir", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    opts.TestUserDir = args[++i];
                }
                else if (a.StartsWith("--test-plugins-dir=", StringComparison.OrdinalIgnoreCase))
                {
                    opts.TestPluginsDir = a.Substring("--test-plugins-dir=".Length);
                }
                else if (string.Equals(a, "--test-plugins-dir", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    opts.TestPluginsDir = args[++i];
                }
            }
            return opts;
        }

        private static int RunSilent(CliOptions opts)
        {
            if (opts.SilentInstall && opts.SilentUninstall)
            {
                Console.Error.WriteLine("Cannot combine --silent-install and --silent-uninstall.");
                return 1;
            }

            try
            {
                List<PayloadEntry> entries = InstallerCore.LoadManifest();
                Action<string> consoleLog = delegate(string msg) { Console.WriteLine(msg); };

                bool isTestMode = !string.IsNullOrEmpty(opts.TestUserDir) || !string.IsNullOrEmpty(opts.TestPluginsDir);
                if (isTestMode)
                {
                    if (!string.IsNullOrEmpty(opts.TestUserDir))
                    {
                        string extTarget = Path.Combine(Path.GetFullPath(opts.TestUserDir), "extensions");
                        if (opts.SilentInstall)
                        {
                            InstallerCore.InstallKernel(extTarget, entries, false, consoleLog);
                            InstallerCore.InstallExtensions(extTarget, entries, consoleLog);
                        }
                        else
                        {
                            InstallerCore.UninstallExtensions(extTarget, consoleLog);
                            InstallerCore.UninstallKernel(extTarget, false, consoleLog);
                        }
                    }

                    if (!string.IsNullOrEmpty(opts.TestPluginsDir))
                    {
                        string pluginTarget = InstallerCore.NormalizePrismFilesTarget(opts.TestPluginsDir);
                        if (opts.SilentInstall)
                        {
                            InstallerCore.InstallPlugin(pluginTarget, entries, consoleLog);
                        }
                        else
                        {
                            InstallerCore.UninstallPlugin(pluginTarget, consoleLog);
                        }
                    }
                    return 0;
                }

                string defaultExt = InstallerCore.GetDefaultExtensionsDir();
                string defaultPlugin = InstallerCore.GetDefaultPluginDir();

                if (opts.SilentInstall)
                {
                    InstallerCore.InstallKernel(defaultExt, entries, true, consoleLog);
                    InstallerCore.InstallExtensions(defaultExt, entries, consoleLog);
                    InstallerCore.InstallPlugin(defaultPlugin, entries, consoleLog);
                    if (!opts.NoWsl)
                    {
                        WslDetectionResult wsl = InstallerCore.DetectWslPluginTargets();
                        consoleLog("[WSL] " + wsl.Summary);
                        for (int i = 0; i < wsl.Targets.Count; i++)
                        {
                            InstallerCore.InstallPlugin(wsl.Targets[i], entries, consoleLog);
                        }
                    }
                }
                else
                {
                    InstallerCore.UninstallExtensions(defaultExt, consoleLog);
                    if (opts.WithKernel)
                    {
                        InstallerCore.UninstallKernel(defaultExt, true, consoleLog);
                    }
                    InstallerCore.UninstallPlugin(defaultPlugin, consoleLog);
                    if (!opts.NoWsl)
                    {
                        WslDetectionResult wsl = InstallerCore.DetectWslPluginTargets();
                        consoleLog("[WSL] " + wsl.Summary);
                        for (int i = 0; i < wsl.Targets.Count; i++)
                        {
                            InstallerCore.UninstallPlugin(wsl.Targets[i], consoleLog);
                        }
                    }
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[Error] " + ex.Message);
                return 1;
            }
        }
    }
}
