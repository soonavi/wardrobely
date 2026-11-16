/**
 * Alert that also works in a browser.
 *
 * React Native's `Alert.alert` is a no-op on react-native-web, which silently
 * kills every confirmation in the app there: sign out, delete account, delete
 * outfit, and any flow that awaits the user's answer. This is the same call
 * with the same signature; on web it falls back to the browser's own dialogs.
 *
 * Import `Alert` from here instead of from "react-native".
 */
import { Alert as NativeAlert, Platform, type AlertButton, type AlertOptions } from "react-native";

function webAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const text = [title, message].filter(Boolean).join("\n\n");
  const list = buttons ?? [];
  if (typeof window === "undefined") return;
  if (list.length <= 1) {
    window.alert(text);
    list[0]?.onPress?.();
    return;
  }
  // Two or more buttons: OK means the action (the last non-cancel button),
  // Cancel means the cancel button. A three-way choice collapses to that
  // pair - the browser has no richer dialog to offer.
  const cancel = list.find((b) => b.style === "cancel");
  const action = [...list].reverse().find((b) => b !== cancel) ?? list[list.length - 1];
  if (window.confirm(text)) action?.onPress?.();
  else cancel?.onPress?.();
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions): void {
    if (Platform.OS === "web") webAlert(title, message, buttons);
    else NativeAlert.alert(title, message, buttons, options);
  },
};
