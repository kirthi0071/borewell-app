// Small wrappers so the same code runs in the Android app (Capacitor) and in a normal browser.
import { Capacitor } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();

// Open WhatsApp / maps / phone dialer links outside the app.
export async function openExternal(url) {
  if (isNative) {
    try { const { AppLauncher } = await import("@capacitor/app-launcher"); await AppLauncher.openUrl({ url }); return; } catch (e) { /* fall through */ }
  }
  window.open(url, "_blank", "noopener");
}

function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
}

// Save/share a generated file (PDF). On Android this opens the share sheet (WhatsApp, Drive, Files…).
export async function shareFile(blob, filename, title) {
  if (isNative) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const { Share } = await import("@capacitor/share");
    const data = await blobToBase64(blob);
    const r = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title, files: [r.uri], dialogTitle: title });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function shareText(text, title) {
  if (isNative) {
    try { const { Share } = await import("@capacitor/share"); await Share.share({ title, text, dialogTitle: title }); return true; } catch (e) { return false; }
  }
  if (navigator.share) { try { await navigator.share({ title, text }); return true; } catch (e) { return false; } }
  return false;
}

// Android hardware back button
export async function onBackButton(handler) {
  if (!isNative) return;
  const { App } = await import("@capacitor/app");
  App.addListener("backButton", ({ canGoBack }) => { if (!handler()) App.minimizeApp(); });
}
