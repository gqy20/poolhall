# PoolHall · 一键启动
#
# 薄转发层：真实命令面仍由 packages/cli 承载（docs/cli.md），这里只做参数默认值。
# 刻意不用 `pnpm exec`：它会产生一个包装进程，且**不转发 SIGTERM** 给 node 子进程——
# 杀包装层只会把真进程留成占端口的孤儿。故一律直接 exec node，信号可直达。
#
# 无编译步骤：Node >= 26 原生 type-stripping 直跑 .ts（AGENTS.md §2.3）。

PORT     ?= 8800
TABLES   ?= 2
SEED     ?= 42
A        ?= synthetic:oracle
B        ?= synthetic:oracle
MAXSHOTS ?= 60
AGENT    ?= default
TRIALS   ?= 20

CLI := node packages/cli/src/main.ts
MCP := node packages/mcp/src/main.ts

.DEFAULT_GOAL := help
.PHONY: help install dev table stop demo mcp test lint typecheck scan

help: ## 显示本帮助
	@echo "PoolHall · make <target>   （变量可用 KEY=VALUE 覆盖，如 make dev PORT=9000）"
	@echo ""
	@awk 'BEGIN {FS = ":.*## "} /^[a-z][a-z -]*:.*## / {printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "  变量：PORT=$(PORT) TABLES=$(TABLES) SEED=$(SEED) A=$(A) B=$(B) MAXSHOTS=$(MAXSHOTS)"
	@echo "  选手 spec：synthetic:oracle / synthetic:no-comp / synthetic:random / llm / external"
	@echo "  注意：A/B 用 llm 时需先配 .env（ANTHROPIC_AUTH_TOKEN / BASE_URL / MODEL）"

install: ## pnpm install（唯一前置；无 build 步骤）
	@pnpm install

# 大厅的意义就是等真人 Agent 推门入座，dev 单独回落到 external（命令行可覆盖）
dev: A = external
dev: B = external

dev: ## 常驻大厅：多桌 · 动态认座 · 选桌观战（默认等外部 Agent 入座，A/B=external）
	@echo "大厅 → http://localhost:$(PORT)   观战 /table/t1 …   Ctrl-C 关闭"
	@exec $(CLI) lobby --port $(PORT) --tables $(TABLES) --seed $(SEED) --a $(A) --b $(B) --max-shots $(MAXSHOTS)

table: ## 单桌实时对局（WS 在 PORT，前端页在 PORT+1）
	@echo "WS → ws://localhost:$(PORT)   前端页 → http://localhost:$$(( $(PORT) + 1 ))   Ctrl-C 关闭"
	@exec $(CLI) web-match --port $(PORT) --seed $(SEED) --a $(A) --b $(B) --max-shots $(MAXSHOTS)

stop: ## 清理遗留的 lobby / web-match 进程（含被 pnpm 包装的孤儿）
	@node scripts/stop.ts

demo: ## 零配置冒烟：纯物理打一杆（不联网、不读 .env）
	@$(CLI) demo

mcp: ## 校准挑战 MCP server（stdio；正常由 MCP 客户端 spawn，手起会因 stdin 关闭而退出）
	@exec $(MCP) --seed $(SEED) --trials $(TRIALS) --agent $(AGENT)

test lint typecheck scan: ## 转发同名 pnpm 脚本（质量门，见 AGENTS.md §6）
	@pnpm $@
