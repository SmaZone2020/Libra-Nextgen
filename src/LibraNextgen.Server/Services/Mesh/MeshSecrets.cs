using System.Security.Cryptography;
using System.Text;

namespace LibraNextgen.Service.Services.Mesh;

/// <summary>
/// At-rest protection for mesh node credentials, mirroring the JWT key file
/// convention: DPAPI (CurrentUser) on Windows, plaintext base64 elsewhere.
/// </summary>
public static class MeshSecrets
{
    public static string Protect(string secret) =>
        Convert.ToBase64String(OperatingSystem.IsWindows()
            ? ProtectedData.Protect(Encoding.UTF8.GetBytes(secret), null, DataProtectionScope.CurrentUser)
            : Encoding.UTF8.GetBytes(secret));

    public static string Unprotect(string cipher) =>
        Encoding.UTF8.GetString(OperatingSystem.IsWindows()
            ? ProtectedData.Unprotect(Convert.FromBase64String(cipher), null, DataProtectionScope.CurrentUser)
            : Convert.FromBase64String(cipher));
}
