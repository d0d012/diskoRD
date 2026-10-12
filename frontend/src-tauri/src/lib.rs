use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
  AppHandle, Manager, WindowEvent,
};

fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Must be first: a second launch (e.g. from a diskord:// link) hands its
    // arguments to the running instance and focuses it instead of opening a new one.
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      show_main_window(app);
    }))
    .plugin(tauri_plugin_deep_link::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    // Closing the window hides it to the tray so voice and notifications keep running.
    // The app only quits from the tray menu (or Cmd+Q on macOS).
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .setup(|app| {
      let open = MenuItem::with_id(app, "open", "Open diskoRD", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit diskoRD", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &quit])?;
      let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("diskoRD")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => show_main_window(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
            show_main_window(tray.app_handle());
          }
        });
      // macOS draws template icons white or black to match the menu bar; Windows gets white.
      #[cfg(target_os = "macos")]
      {
        tray = tray.icon(tauri::include_image!("icons/tray-template.png")).icon_as_template(true);
      }
      #[cfg(not(target_os = "macos"))]
      {
        tray = tray.icon(tauri::include_image!("icons/tray.png"));
      }
      tray.build(app)?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Installed builds register the scheme via the bundle; dev builds do it at runtime.
      #[cfg(any(windows, target_os = "linux"))]
      {
        use tauri_plugin_deep_link::DeepLinkExt;
        let _ = app.deep_link().register_all();
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      // macOS: clicking the Dock icon brings the hidden window back.
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = _event {
        show_main_window(_app);
      }
    });
}
