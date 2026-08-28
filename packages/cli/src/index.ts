/**
 * @poolhall/cli · 薄壳
 *
 * 命令面见 docs/cli.md：play / run / replay / render / trace / debug / experiment。
 * M0 骨架：仅占位 + 版本号；命令实现随 M2/M3 落地。
 */
import { CORE_VERSION } from "@poolhall/core";
import { ENGINE_VERSION } from "@poolhall/engine";

export const CLI_VERSION = "0.0.1";

export function versionBanner(): string {
  return `poolhall ${CLI_VERSION} (engine ${ENGINE_VERSION}, core ${CORE_VERSION})`;
}
