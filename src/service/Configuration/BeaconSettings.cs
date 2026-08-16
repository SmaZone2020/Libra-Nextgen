namespace LibraNextgen.Service.Configuration;

/// <summary>
/// Shared secret used to authenticate agent registration. Agents are built with
/// this value injected, and the server rejects registrations that don't match.
/// An empty secret disables agent authentication (development only).
/// </summary>
public class BeaconSettings
{
    public const string SectionName = "Beacon";

    public string Secret { get; set; } = string.Empty;
}
