/**
 * @poolhall/cli · 薄壳
 *
 * 命令面见 docs/cli.md：play / run / replay / render / trace / debug / experiment。
 */
import { CORE_VERSION } from "@poolhall/core";
import { ENGINE_VERSION } from "@poolhall/engine";

export const CLI_VERSION = "0.1.0";

export function versionBanner(): string {
  return `poolhall ${CLI_VERSION} (engine ${ENGINE_VERSION}, core ${CORE_VERSION})`;
}

export type { RenderOpts } from "./render.ts";
export { renderTable, renderTrace } from "./render.ts";
