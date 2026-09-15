namespace LibraNextgen.Mobile.Services;

/// <summary>
/// Startup failures the user can be told about in one line.
/// </summary>
public sealed class LocalServiceException(string message, Exception? inner = null) : Exception(message, inner);
