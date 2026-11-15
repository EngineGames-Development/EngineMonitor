// Every app command must be listed here. Tauri then generates an
// `allow-<command>` permission for it, and the command is only callable from
// windows whose capability grants that permission (see capabilities/).
const COMMANDS: &[&str] = &["app_info"];

fn main() {
    let mut attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));

    // Windows: Tauri needs the Common Controls v6 manifest. tauri-build only
    // embeds it into the main executable, which makes integration-test
    // binaries fail to start (STATUS_ENTRYPOINT_NOT_FOUND). Embed it through
    // the MSVC linker for every link target instead.
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "windows" && target_env == "msvc" {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
