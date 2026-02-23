use std::path::PathBuf;
use std::process::Command;

/// Ensures that a given file path ends with the `.pdf` extension.
pub fn ensure_pdf_extension(path: &str) -> String {
    if path.to_ascii_lowercase().ends_with(".pdf") {
        path.to_string()
    } else {
        format!("{path}.pdf")
    }
}

/// Ensures that a given file path ends with the `.docx` extension.
pub fn ensure_docx_extension(path: &str) -> String {
    if path.to_ascii_lowercase().ends_with(".docx") {
        path.to_string()
    } else {
        format!("{path}.docx")
    }
}

/// Creates a standard `std::process::Command` with the proper PATH footprint
/// ensuring that binaries installed via package managers (like Homebrew on macOS
/// or apt on Linux) are locatable.
pub fn base_command(binary: &str) -> Command {
    let mut cmd = Command::new(binary);
    cmd.env(
        "PATH",
        "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    );
    cmd
}

/// Resolves the absolute path to a system binary (like pdftoppm, ghostscript, etc.).
pub fn resolve_binary_path(command: &str) -> Result<String, String> {
    let absolute_candidates = [
        format!("/usr/bin/{command}"),
        format!("/bin/{command}"),
        format!("/usr/local/bin/{command}"),
    ];

    for candidate in &absolute_candidates {
        if std::path::Path::new(candidate).exists() {
            return Ok(candidate.clone());
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            let candidate = PathBuf::from(dir).join(command);
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().to_string());
            }
        }
    }

    Err(format!(
        "Required command `{command}` not found. Ensure required system dependencies are installed."
    ))
}
