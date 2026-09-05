using LibraNextgen.Common.Models;
using LibraNextgen.Service.Data;

namespace LibraNextgen.Service.Services.Mesh;

/// <summary>Auth-flavor payload of a mesh node create/update operation.</summary>
public sealed record MeshAuthSpec(MeshAuthKind Kind, string? Username, string Secret);

/// <summary>Partial update for a mesh node. Null members are left untouched.</summary>
public sealed record MeshNodeUpdate(
    string? Name,
    string? Origin,
    MeshAuthSpec? Auth);

/// <summary>
/// CRUD for mesh node registrations (the hub's view of remote Libra
/// services). Raw credentials never reach the store: they are protected via
/// <see cref="MeshSecrets"/> before persistence and decrypted on demand.
/// </summary>
public class MeshNodeService
{
    public const int MaxNameLength = 64;

    private readonly IStore<MeshNode> _nodes;

    public MeshNodeService(IStore<MeshNode> nodes)
    {
        _nodes = nodes;
    }

    public async Task<List<MeshNode>> ListAsync(CancellationToken ct = default) =>
        (await _nodes.GetAllAsync(ct)).OrderBy(n => n.CreatedAt).ToList();

    public async Task<MeshNode?> GetAsync(string id, CancellationToken ct = default) =>
        await _nodes.GetByIdAsync(id, ct);

    /// <summary>Decrypt the stored secret (password or raw access key).</summary>
    public string GetSecret(MeshNode node) => MeshSecrets.Unprotect(node.SecretCipher);

    public async Task<MeshNode> CreateAsync(
        string name,
        string origin,
        MeshAuthSpec auth,
        string userId,
        string userName,
        CancellationToken ct = default)
    {
        var cleanName = NormalizeName(name);
        var cleanOrigin = NormalizeOrigin(origin);
        var (username, secretCipher) = BuildAuth(auth);

        if (await _nodes.ExistsAsync(n => n.Name == cleanName, ct))
            throw new InvalidOperationException($"A mesh node named '{cleanName}' already exists");

        var node = new MeshNode
        {
            Name = cleanName,
            Origin = cleanOrigin,
            AuthKind = auth.Kind,
            Username = username,
            SecretCipher = secretCipher,
            CreatedByUserId = userId,
            CreatedByUserName = userName,
        };

        await _nodes.InsertAsync(node, ct);
        return node;
    }

    /// <summary>Apply a partial update. Returns null when the id is unknown.</summary>
    public async Task<MeshNode?> UpdateAsync(string id, MeshNodeUpdate update, CancellationToken ct = default)
    {
        var node = await _nodes.GetByIdAsync(id, ct);
        if (node == null) return null;

        if (update.Name is not null)
            node.Name = NormalizeName(update.Name);

        if (update.Origin is not null)
            node.Origin = NormalizeOrigin(update.Origin);

        if (update.Auth is not null)
        {
            var (username, secretCipher) = BuildAuth(update.Auth);
            node.AuthKind = update.Auth.Kind;
            node.Username = username;
            node.SecretCipher = secretCipher;
        }

        node.UpdatedAt = DateTime.UtcNow;
        await _nodes.ReplaceByIdAsync(node.Id, node, ct);
        return node;
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken ct = default) =>
        await _nodes.DeleteAsync(id, ct) > 0;

    public async Task RecordConnectResultAsync(string id, bool success, string? error, CancellationToken ct = default)
    {
        var updates = new List<FieldUpdate>();
        if (success)
        {
            updates.Add(new FieldUpdate(nameof(MeshNode.LastConnectedAt), DateTime.UtcNow));
            updates.Add(new FieldUpdate(nameof(MeshNode.LastError), null));
        }
        else
        {
            updates.Add(new FieldUpdate(nameof(MeshNode.LastError), error));
        }
        await _nodes.UpdateByIdAsync(id, updates, ct);
    }

    public static string NormalizeName(string name)
    {
        var clean = name.Trim();
        if (clean.Length == 0 || clean.Length > MaxNameLength)
            throw new ArgumentException($"Mesh node name must be 1-{MaxNameLength} characters");
        return clean;
    }

    public static string NormalizeOrigin(string origin)
    {
        var clean = origin.Trim().TrimEnd('/');
        if (!Uri.TryCreate(clean, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || uri.AbsolutePath is not "/" and not "")
            throw new ArgumentException("Mesh node origin must be an http(s)://host[:port] URL without path or credentials");
        return $"{uri.Scheme}://{uri.Authority}";
    }

    private static (string Username, string SecretCipher) BuildAuth(MeshAuthSpec auth)
    {
        if (auth.Kind == MeshAuthKind.Password)
        {
            var username = (auth.Username ?? "").Trim();
            if (username.Length == 0)
                throw new ArgumentException("username is required for password auth");
            if (string.IsNullOrEmpty(auth.Secret))
                throw new ArgumentException("password is required for password auth");
            return (username, MeshSecrets.Protect(auth.Secret));
        }

        var key = (auth.Secret ?? "").Trim();
        if (key.Length == 0)
            throw new ArgumentException("access key is required for access-key auth");
        return ("", MeshSecrets.Protect(key));
    }
}
