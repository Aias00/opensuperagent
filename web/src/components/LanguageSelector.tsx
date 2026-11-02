import {
  t as tr,
  useLanguagePreference,
  type LanguagePreference,
} from "../i18n";
export function LanguageSelector() {
  const { preference, setPreference } = useLanguagePreference();
  return (
    <label className="language-selector">
      <span>{tr("lang.label")}</span>
      <select
        aria-label={tr("lang.label")}
        value={preference}
        onChange={(event) =>
          setPreference(event.target.value as LanguagePreference)
        }
      >
        <option value="auto">{tr("lang.auto")}</option>
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
