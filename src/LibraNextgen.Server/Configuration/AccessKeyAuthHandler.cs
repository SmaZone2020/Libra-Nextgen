using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Configuration;

public class AccessKeyAuthHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    private readonly AccessKeyService _keyService;

    public AccessKeyAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        AccessKeyService keyService)
        : base(options, logger, encoder)
    {
        _keyService = keyService;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authHeader = Request.Headers.Authorization.FirstOrDefault();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return AuthenticateResult.NoResult();

        var token = authHeader["Bearer ".Length..].Trim();
        if (!token.StartsWith("lnk_"))
            return AuthenticateResult.NoResult();

        var key = await _keyService.ValidateAsync(token);
        if (key == null)
            return AuthenticateResult.Fail("Invalid or expired access key");

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, key.CreatedByUserId),
            new Claim(ClaimTypes.Name, key.CreatedByUserName),
            new Claim(ClaimTypes.Role, key.Role),
        };

        var identity = new ClaimsIdentity(claims, Scheme.Name);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, Scheme.Name);

        return AuthenticateResult.Success(ticket);
    }
}
