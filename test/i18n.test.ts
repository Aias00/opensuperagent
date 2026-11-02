import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  parseLanguagePreference,
  resolveLocale,
  translate,
} from "../web/src/i18n.ts";
import { en } from "../web/src/locales/en.ts";
import { zh } from "../web/src/locales/zh.ts";
import { enData } from "../web/src/locales/en-data.ts";

it("selects Chinese or English from browser preferences and respects explicit user overrides", () => {
  assert.equal(parseLanguagePreference(null), "auto");
  assert.equal(parseLanguagePreference("unknown"), "auto");
  assert.equal(resolveLocale("auto", ["zh-CN", "en-US"]), "zh");
  assert.equal(resolveLocale("auto", ["zh-HK"]), "zh");
  assert.equal(resolveLocale("auto", ["en-GB", "zh-CN"]), "en");
  assert.equal(resolveLocale("auto", ["ja-JP"]), "en");
  assert.equal(resolveLocale("en", ["zh-CN"]), "en");
  assert.equal(resolveLocale("zh", ["en-US"]), "zh");
  assert.equal(translate("en", "overview.recentTasksMeta", { v0: 3 }), "3 goals");
  assert.equal(translate("zh", "overview.recentTasksMeta", { v0: 3 }), "3 个目标");
  assert.equal(translate("zh", "后端开发：实现服务接口"), "后端开发：实现服务接口");
});

it("has matching key sets and interpolation tokens across locales", () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(enKeys, zhKeys, "en and zh dictionaries must share keys");
  for (const key of enKeys) {
    assert.ok(
      /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(key),
      `Key is not namespaced: ${key}`,
    );
    assert.ok(
      !/[　-鿿]/.test(en[key]!),
      `English copy contains untranslated text: ${key}`,
    );
    assert.deepEqual(
      [...zh[key]!.matchAll(/\{\{\w+\}\}/g)].map((m) => m[0]).sort(),
      [...en[key]!.matchAll(/\{\{\w+\}\}/g)].map((m) => m[0]).sort(),
      `Interpolation mismatch: ${key}`,
    );
  }
  for (const [key, value] of Object.entries(enData)) {
    assert.ok(
      !/[　-鿿]/.test(value),
      `Data translation contains untranslated text: ${key}`,
    );
  }
});

it("every static tr() key exists in both locales", () => {
  const visitFile = (path: string) => {
    const ast = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "tr" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const key = node.arguments[0].text.trim();
        assert.ok(
          Object.hasOwn(en, key) && Object.hasOwn(zh, key),
          `Missing translation in ${path}: ${key}`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  };
  const walk = (dir: string) => {
    for (const file of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, file.name);
      if (file.isDirectory() && file.name !== "locales") walk(path);
      else if (/\.tsx?$/.test(file.name)) visitFile(path);
    }
  };
  walk("web/src");
});
