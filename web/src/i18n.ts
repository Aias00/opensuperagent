import { useSyncExternalStore } from "react";
import { en } from "./locales/en";
import { zh } from "./locales/zh";
import { enData } from "./locales/en-data";

export type Locale = "zh" | "en";
export type LanguagePreference = Locale | "auto";
export const LANGUAGE_STORAGE_KEY = "opensuperagent.language";
export function parseLanguagePreference(
  value: string | null,
): LanguagePreference {
  return value === "zh" || value === "en" ? value : "auto";
}
export function resolveLocale(
  preference: LanguagePreference,
  languages: readonly string[],
): Locale {
  if (preference !== "auto") return preference;
  const supported = languages.find((language) =>
    /^(zh|en)(-|$)/i.test(language),
  );
  return supported?.toLowerCase().startsWith("zh") ? "zh" : "en";
}
function readPreference(): LanguagePreference {
  try {
    return parseLanguagePreference(localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return "auto";
  }
}
let preference = readPreference();
let locale = resolveLocale(
  preference,
  typeof navigator === "undefined"
    ? []
    : (navigator.languages ?? [navigator.language]),
);
const listeners = new Set<() => void>();
function publish() {
  locale = resolveLocale(
    preference,
    typeof navigator === "undefined"
      ? []
      : (navigator.languages ?? [navigator.language]),
  );
  if (typeof document !== "undefined")
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  for (const listener of listeners) listener();
}
export function setLanguagePreference(next: LanguagePreference) {
  preference = next;
  try {
    if (next === "auto") localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  } catch {
    /* The current session still supports switching when storage is unavailable. */
  }
  publish();
}
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", publish);
  window.addEventListener("storage", (event) => {
    if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) {
      preference = readPreference();
      publish();
    }
  });
}
publish();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function useLocale() {
  return useSyncExternalStore(
    subscribe,
    () => locale,
    () => "en" as Locale,
  );
}
export function useLanguagePreference() {
  useSyncExternalStore(
    subscribe,
    () => `${preference}:${locale}`,
    () => "auto:en",
  );
  return { preference, locale, setPreference: setLanguagePreference };
}
export function getLocale() {
  return locale;
}
const messages: Record<Locale, Record<string, string>> = { en, zh };
export function translate(
  locale: Locale,
  message: string,
  values: Record<string, unknown> = {},
): string {
  const key = message.trim();
  const translated =
    messages[locale][key] ??
    (locale === "en" ? enData[key] : undefined) ??
    message;
  return translated.replace(/\{\{(\w+)\}\}/g, (token, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
export function t(message: string, values?: Record<string, unknown>) {
  return translate(locale, message, values);
}
