pub struct BrowserStealer;

impl BrowserStealer {
    /// Stub implementation. The full C# BrowserStealer is ~1120 lines with
    /// SQLite, DPAPI, BCrypt, ASN.1 parsing, LSASS token impersonation,
    /// and ChaCha20-Poly1305 decryption. This returns empty results.
    ///
    /// TODO: Implement when rusqlite + Windows DPAPI bindings are available.
    pub fn collect(_type_: &str, _offset: usize, _limit: usize) -> String {
        r#"{"total":0,"offset":0,"limit":0,"items":[]}"#.to_string()
    }
}
