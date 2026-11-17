import {
  type ActionResult,
  type AppInfo,
  type AppRef,
  type AppState,
  type ClickOptions,
  type PermissionReport,
  type PlatformAdapter,
  type ScrollOptions,
  type Target,
  type TypeOptions,
  type WindowInfo,
  UnsupportedPlatformError,
} from "@zov/core";

/**
 * Windows Platform Adapter.
 * Status: Experimental / Skeleton.
 * Strictly enforces Zero Fake-Success Policy: all unverified native Windows
 * operations throw UnsupportedPlatformError with zero shell/PowerShell execution.
 */
export class WindowsAdapter implements PlatformAdapter {
  readonly platform = "win32" as const;
  readonly status = "experimental" as const;

  async listApps(): Promise<AppInfo[]> {
    throw new UnsupportedPlatformError("listApps", "win32");
  }

  async listWindows(_appRef?: AppRef): Promise<WindowInfo[]> {
    throw new UnsupportedPlatformError("listWindows", "win32");
  }

  async getActiveWindow(): Promise<WindowInfo | null> {
    throw new UnsupportedPlatformError("getActiveWindow", "win32");
  }

  async getAppState(
    _appRef: AppRef,
    _options: { detail?: "compact" | "full"; include_screenshot?: boolean } = {}
  ): Promise<AppState> {
    throw new UnsupportedPlatformError("getAppState (UIAutomation)", "win32");
  }

  async takeScreenshot(_options?: { window_id?: number; display_id?: number }): Promise<{
    base64: string;
    width: number;
    height: number;
  }> {
    throw new UnsupportedPlatformError("takeScreenshot", "win32");
  }

  async launchApp(_nameOrPath: string): Promise<AppInfo> {
    throw new UnsupportedPlatformError("launchApp", "win32");
  }

  async focusApp(_appRef: AppRef): Promise<boolean> {
    throw new UnsupportedPlatformError("focusApp", "win32");
  }

  async focusWindow(_windowId: number): Promise<boolean> {
    throw new UnsupportedPlatformError("focusWindow", "win32");
  }

  async moveWindow(_windowId: number, _x: number, _y: number): Promise<boolean> {
    throw new UnsupportedPlatformError("moveWindow", "win32");
  }

  async resizeWindow(_windowId: number, _width: number, _height: number): Promise<boolean> {
    throw new UnsupportedPlatformError("resizeWindow", "win32");
  }

  async minimizeWindow(_windowId: number): Promise<boolean> {
    throw new UnsupportedPlatformError("minimizeWindow", "win32");
  }

  async maximizeWindow(_windowId: number): Promise<boolean> {
    throw new UnsupportedPlatformError("maximizeWindow", "win32");
  }

  async click(_target: Target, _options: ClickOptions = {}): Promise<ActionResult> {
    throw new UnsupportedPlatformError("click", "win32");
  }

  async doubleClick(_target: Target, _options: ClickOptions = {}): Promise<ActionResult> {
    throw new UnsupportedPlatformError("double_click", "win32");
  }

  async rightClick(_target: Target, _options: ClickOptions = {}): Promise<ActionResult> {
    throw new UnsupportedPlatformError("right_click", "win32");
  }

  async movePointer(_x: number, _y: number): Promise<ActionResult> {
    throw new UnsupportedPlatformError("move_pointer", "win32");
  }

  async scroll(_options: ScrollOptions): Promise<ActionResult> {
    throw new UnsupportedPlatformError("scroll", "win32");
  }

  async typeText(_text: string, _options?: TypeOptions, _target?: Target): Promise<ActionResult> {
    throw new UnsupportedPlatformError("type_text", "win32");
  }

  async pressKey(_key: string, _modifiers: string[] = []): Promise<ActionResult> {
    throw new UnsupportedPlatformError("press_key", "win32");
  }

  async hotkey(_keys: string[]): Promise<ActionResult> {
    throw new UnsupportedPlatformError("hotkey", "win32");
  }

  async setValue(_target: Target, _value: string): Promise<ActionResult> {
    throw new UnsupportedPlatformError("set_value", "win32");
  }

  async performAction(_target: Target, _actionName: string): Promise<ActionResult> {
    throw new UnsupportedPlatformError("perform_action", "win32");
  }

  async checkPermissions(): Promise<PermissionReport> {
    return {
      accessibility: false,
      screen_recording: false,
    };
  }

  async requestAccess(): Promise<PermissionReport> {
    return this.checkPermissions();
  }
}
