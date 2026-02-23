use serde::{Serialize, Serializer};
use std::fmt;

/// Application-wide error type.
#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Pdf(String),
    CommandFailed(String),
    Processing(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "IO Error: {}", e),
            Self::Pdf(e) => write!(f, "PDF Error: {}", e),
            Self::CommandFailed(e) => write!(f, "Command Execution Failed: {}", e),
            Self::Processing(e) => write!(f, "Processing Error: {}", e),
        }
    }
}

// Map standard IO errors into our Domain Error
impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        AppError::Io(error)
    }
}

// Map lopdf errors (String based in existing code)
impl From<String> for AppError {
    fn from(error: String) -> Self {
        AppError::Processing(error)
    }
}

// Convert the AppError into a String explicitly for Tauri's IPC Bridge,
// since Tauri requires errors returned to the React Frontend to be `Serialize`.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
