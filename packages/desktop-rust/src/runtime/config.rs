use std::collections::BTreeMap;
use std::env;
use std::path::PathBuf;

const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:3000";
const DEFAULT_BACKEND_WS_URL: &str = "ws://127.0.0.1:3000/ws";
const DEFAULT_NODE_ENV: &str = "production";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeConfig {
    backend_url: String,
    backend_ws_url: String,
    node_env: String,
    db_path: PathBuf,
    client_secret: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RuntimeConfigInput {
    pub backend_url: Option<String>,
    pub backend_ws_url: Option<String>,
    pub node_env: Option<String>,
    pub db_path: Option<PathBuf>,
    pub client_secret: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendRequestConfig {
    pub url: String,
    pub headers: BTreeMap<String, String>,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self::new(RuntimeConfigInput::default())
    }
}

impl RuntimeConfig {
    pub fn new(input: RuntimeConfigInput) -> Self {
        Self::new_with_env(input, env::var_os("DB_PATH"))
    }

    pub fn new_with_env(
        input: RuntimeConfigInput,
        env_db_path: Option<impl Into<PathBuf>>,
    ) -> Self {
        let node_env = input
            .node_env
            .unwrap_or_else(|| DEFAULT_NODE_ENV.to_string());
        let db_path = match (input.db_path, env_db_path) {
            (Some(path), _) => path,
            (None, Some(path)) => path.into(),
            (None, None) => default_db_path(&node_env),
        };

        Self {
            backend_url: input
                .backend_url
                .unwrap_or_else(|| DEFAULT_BACKEND_URL.to_string()),
            backend_ws_url: input
                .backend_ws_url
                .unwrap_or_else(|| DEFAULT_BACKEND_WS_URL.to_string()),
            node_env,
            db_path,
            client_secret: input.client_secret.unwrap_or_default(),
        }
    }

    pub fn apply(&mut self, input: RuntimeConfigInput) {
        self.apply_with_env(input, env::var_os("DB_PATH"));
    }

    pub fn apply_with_env(
        &mut self,
        input: RuntimeConfigInput,
        env_db_path: Option<impl Into<PathBuf>>,
    ) {
        let node_env_changed = input.node_env.is_some();
        if let Some(backend_url) = input.backend_url {
            self.backend_url = backend_url;
        }
        if let Some(backend_ws_url) = input.backend_ws_url {
            self.backend_ws_url = backend_ws_url;
        }
        if let Some(node_env) = input.node_env {
            self.node_env = node_env;
        }
        if let Some(client_secret) = input.client_secret {
            self.client_secret = client_secret;
        }

        if let Some(db_path) = input.db_path {
            self.db_path = db_path;
        } else if let Some(env_path) = env_db_path {
            self.db_path = env_path.into();
        } else if node_env_changed {
            self.db_path = default_db_path(&self.node_env);
        }
    }

    pub fn backend_url(&self) -> &str {
        &self.backend_url
    }

    pub fn backend_ws_url(&self) -> &str {
        &self.backend_ws_url
    }

    pub fn node_env(&self) -> &str {
        &self.node_env
    }

    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    pub fn client_secret(&self) -> &str {
        &self.client_secret
    }

    pub fn backend_request(&self, path: &str) -> BackendRequestConfig {
        let mut headers = BTreeMap::new();
        if !self.client_secret.is_empty() {
            headers.insert("X-Client-Secret".to_string(), self.client_secret.clone());
        }

        BackendRequestConfig {
            url: format!("{}{}", self.backend_url, path),
            headers,
        }
    }
}

pub fn default_db_path(node_env: &str) -> PathBuf {
    let base = if node_env == "production" {
        ".twirchat"
    } else {
        ".twirchat-dev"
    };
    home_dir().join(base).join("db.sqlite")
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}
