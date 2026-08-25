using System.Security.Cryptography;
using System.Text;
var bytes = File.ReadAllBytes(Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "Libra-Nextgen", "jwt-rsa-key.bin"));
var xml = Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser));
using var rsa = RSA.Create();
rsa.FromXmlString(xml);
Console.WriteLine(rsa.ExportPkcs8PrivateKeyPem());
