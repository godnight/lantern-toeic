import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';

/** The web page may choose only a persisted theme, never an arbitrary color. */
export class ThemeColors {
  background: string;
  statusContent: string;
  constructor(background: string, statusContent: string) {
    this.background = background; this.statusContent = statusContent;
  }
}

export function themeColors(theme: string): ThemeColors | undefined {
  switch (theme) {
    case 'paper': return new ThemeColors('#F5F5F5', '#252626');
    case 'crystal': return new ThemeColors('#181A19', '#EDF0EE');
    case 'hollow': return new ThemeColors('#101820', '#ECF1F4');
    case 'silk': return new ThemeColors('#201822', '#F2E9E4');
    case 'whale-bay': return new ThemeColors('#F4F1E9', '#213642');
    case 'whale-moon': return new ThemeColors('#0F1B30', '#EDF3F9');
    default: return undefined;
  }
}

function channelLuminance(value: number): number {
  const normalized: number = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function luminance(red: number, green: number, blue: number): number {
  return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

/** Best-effort initial rollback if the existing system status text is known.
 * Readback is ARGB or RGB. Account for its alpha against each fixed candidate;
 * if neither yields readable contrast, do not alter the unknown window state. */
export function safeBackgroundForStatus(color: string): string | undefined {
  if (typeof color !== 'string' || !/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color)) return undefined;
  const digits: string = color.substring(1);
  const offset: number = digits.length === 8 ? 2 : 0;
  const alpha: number = digits.length === 8 ? parseInt(digits.substring(0, 2), 16) / 255 : 1;
  const red: number = parseInt(digits.substring(offset, offset + 2), 16);
  const green: number = parseInt(digits.substring(offset + 2, offset + 4), 16);
  const blue: number = parseInt(digits.substring(offset + 4, offset + 6), 16);
  const light: number = contrastOnBackground(red, green, blue, alpha, 245, 245, 245);
  const dark: number = contrastOnBackground(red, green, blue, alpha, 24, 26, 25);
  if (Math.max(light, dark) < 4.5) return undefined;
  return light >= dark ? '#F5F5F5' : '#181A19';
}

function contrastOnBackground(red: number, green: number, blue: number, alpha: number,
  bgRed: number, bgGreen: number, bgBlue: number): number {
  const foreground: number = luminance(red * alpha + bgRed * (1 - alpha),
    green * alpha + bgGreen * (1 - alpha), blue * alpha + bgBlue * (1 - alpha));
  const background: number = luminance(bgRed, bgGreen, bgBlue);
  return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
}

// Only the OS numeric code is safe to emit; never log the exception or its message.
function errorCode(error: BusinessError): string {
  try {
    const code: number = error.code;
    if (typeof code === 'number' && Number.isFinite(code) && Number.isInteger(code)) return String(code);
  } catch { /* An unavailable or unreadable code is deliberately anonymous. */ }
  return 'unknown';
}

class WindowSlot {
  busy: boolean = false;
  target: window.Window;
  confirmed: ThemeColors | undefined = undefined;
  constructor(target: window.Window) { this.target = target; }
}

/** Process-local window coordinator. A slot belongs to exactly one WindowStage.
 * Calls on that window are serialized, so a slow old Promise cannot overtake a
 * newer accepted theme. A new stage gets a separate slot, never an old window. */
export class ThemeWindowController {
  private foreground: boolean = false;
  private slot: WindowSlot | undefined = undefined;
  private desired: ThemeColors | undefined = undefined;
  private revision: number = 0;

  setForeground(foreground: boolean): void {
    this.foreground = foreground;
    if (!foreground) this.invalidate();
    else if (this.slot) this.pump(this.slot);
  }

  /** Called only after this stage's loadContent promise has resolved. */
  setReadyWindow(target: window.Window): void {
    this.slot = new WindowSlot(target);
    this.pump(this.slot);
  }

  clearWindow(): void {
    this.slot = undefined;
    this.invalidate();
  }

  invalidate(): void {
    this.desired = undefined;
    this.revision++;
  }

  accept(theme: string): boolean {
    const colors: ThemeColors | undefined = themeColors(theme);
    if (!this.foreground || colors === undefined) return false;
    this.desired = colors;
    this.revision++;
    if (this.slot) this.pump(this.slot);
    return true;
  }

  private pump(slot: WindowSlot): void {
    if (slot.busy || this.slot !== slot || !this.foreground || this.desired === undefined) return;
    slot.busy = true;
    void this.applyPending(slot);
  }

  private async applyPending(slot: WindowSlot): Promise<void> {
    try {
      while (this.slot === slot && this.foreground && this.desired !== undefined) {
        const colors: ThemeColors = this.desired;
        const revision: number = this.revision;
        let rollback: string | undefined = slot.confirmed?.background;
        if (rollback === undefined) {
          try {
            const status: window.SystemBarProperties = slot.target.getWindowSystemBarProperties();
            console.info('LANTERN theme read ok');
            rollback = safeBackgroundForStatus(status.statusBarContentColor || '');
          } catch (error) {
            console.warn('LANTERN theme read failed code=' + errorCode(error as BusinessError));
          }
          if (rollback === undefined) {
            console.warn('LANTERN theme safe fallback unavailable code=unknown');
            break;
          }
        }
        let phase: string = 'background';
        try {
          // Keep the default safe-area layout: only the window background and
          // status-bar text/icon color change; the gesture area remains system-owned.
          slot.target.setWindowBackgroundColor(colors.background);
          console.info('LANTERN theme background ok');
          phase = 'status';
          await slot.target.setWindowSystemBarProperties({ statusBarContentColor: colors.statusContent });
          console.info('LANTERN theme status ok');
          slot.confirmed = colors;
        } catch (error) {
          console.warn('LANTERN theme ' + phase + ' failed code=' + errorCode(error as BusinessError));
          // This slot serializes all writes, so a newer accepted theme has not
          // yet been applied. Restore the pair even after backgrounding, then
          // let the loop apply any newer request. A retired window is untouched.
          if (this.slot === slot) {
            try {
              slot.target.setWindowBackgroundColor(rollback);
              console.info('LANTERN theme rollback ok');
            } catch (rollbackError) {
              console.warn('LANTERN theme rollback failed code=' + errorCode(rollbackError as BusinessError));
            }
          }
        }
        if (this.revision === revision) break;
      }
    } finally {
      slot.busy = false;
    }
  }
}

export const themeWindow: ThemeWindowController = new ThemeWindowController();
