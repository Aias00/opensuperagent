import type { ToolDefinition } from "@tomsun28/pizza";
import { constants, existsSync, realpathSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileTypeFromFile } from "file-type";
import type { WorkerDefinitionSpec } from "../types.js";
import type { CliBuiltinCommand } from "../worker/commands.js";
import { validateWorkerTools } from "../worker/definition.js";

type Pizza = typeof import("@tomsun28/pizza");

/** Reuse Pizza's parser, file tools, shell backend, skill loader and results. */
export function nativeWorkerTools(
  pizza: Pizza,
  definition: WorkerDefinitionSpec,
  cwd: string,
  skillsDir: string,
  taskCommands: CliBuiltinCommand[],
): ToolDefinition[] {
  validateWorkerTools(definition);
  const allowShell = definition.cli?.allowShell ?? false;
  const skills = pizza.loadSkillsFromDir({ dir: skillsDir, source: "task" }).skills;

  // These operations only enforce filesystem scope; parsing, edits, image
  // handling, output truncation and command execution remain native Pizza.
  const workspace = realpathSync(cwd);
  const snapshots = skills.map((skill) => realpathSync(skill.baseDir));
  const scopedPath = (path: string, writable = false) => {
    let parent = resolve(path);
    while (!existsSync(parent) && dirname(parent) !== parent)
      parent = dirname(parent);
    const target = resolve(realpathSync(parent), relative(parent, resolve(path)));
    const roots = writable ? [workspace] : [workspace, ...snapshots];
    const allowed = roots.some((root) => {
      const rel = relative(root, target);
      return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    });
    if (!allowed) throw new Error(`Path escapes workspace: ${path}`);
    return target;
  };
  const read: Parameters<Pizza["createReadToolDefinition"]>[1] = {
    operations: {
      readFile: (path) => readFile(scopedPath(path)),
      access: (path) => access(scopedPath(path), constants.R_OK),
      async detectImageMimeType(path) {
        const type = await fileTypeFromFile(scopedPath(path));
        return type?.mime.startsWith("image/") ? type.mime : undefined;
      },
    },
  };
  const write: Parameters<Pizza["createWriteToolDefinition"]>[1] = {
    operations: {
      writeFile: (path, content) => writeFile(scopedPath(path, true), content),
      mkdir: async (path) => {
        await mkdir(scopedPath(path, true), { recursive: true });
      },
    },
  };
  const edit: Parameters<Pizza["createEditToolDefinition"]>[1] = {
    operations: {
      readFile: (path) => readFile(scopedPath(path, true)),
      writeFile: (path, content) => writeFile(scopedPath(path, true), content),
      access: (path) =>
        access(scopedPath(path, true), constants.R_OK | constants.W_OK),
    },
  };
  const shell = pizza.createLocalBashOperations();
  const cli = pizza.createBashToolDefinition(cwd, {
    skill: { getSkills: () => skills },
    dynamicBuiltins: () => taskCommands,
    read, write, edit,
    operations: {
      exec(command, workspace, options) {
        if (!allowShell)
          throw new Error("Shell commands are not permitted by this Worker");
        return shell.exec(command, workspace, options);
      },
    },
  });
  const guardedCli = pizza.defineTool({
    ...cli,
    description: `${cli.description}\nWorker permissions: underscore commands ${[...definition.tools, ...taskCommands.map((command) => command.name)].join(", ") || "none"}; shell commands ${allowShell ? "allowed" : "not allowed"}.`,
    async execute(id, params, signal, onUpdate, ctx) {
      // Restricted Workers require a literal token. Native CLI parses the
      // arguments and control syntax; shell operations have a second gate.
      const command = params.command;
      const builtin = command.trimStart()
        .match(/^(_[a-z_]+)(?=\s|$)/i)?.[1]?.toLowerCase();
      if (builtin) {
        if (!definition.tools.includes(builtin) && !taskCommands.some((command) => command.name === builtin))
          throw new Error(`Command ${builtin} is not permitted by this Worker`);
      } else if (!allowShell) {
        throw new Error("Shell commands are not permitted by this Worker");
      }
      return cli.execute(id, params, signal, onUpdate, ctx);
    },
  });
  return [guardedCli];
}
