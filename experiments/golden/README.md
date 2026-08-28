# golden 对拍 · pooltool 交叉验证

对拍脚手架：poolhall 引擎的自家 golden（`scripts/golden.ts` → `packages/engine/src/__tests__/golden/scenes.json`）
+ pooltool 0.6.0 参考轨迹（`pooltool_ref.json`），测试入口
`packages/engine/src/__tests__/golden.test.ts`。

## 环境（一次性，已验证 2026-08）

pooltool-billiards 0.6.0 在 Linux 上有硬伤：钉死 `panda3d==1.11.0.dev3702`（不在 PyPI，
官方 wheel 源 TLS 也常不通）。绕法：

```bash
# 1. 下载 wheel 并 no-deps 安装（绕开 panda3d dev 依赖钉死）
pip download pooltool-billiards==0.6.0 --no-deps -d /tmp/ptdl
uv pip install --no-deps /tmp/ptdl/pooltool_billiards-0.6.0-*.whl
# 2. 手补依赖（渲染层用正式版 panda3d 1.10.14 顶替，物理对拍不受影响）
uv pip install numpy numpy-quaternion attrs cattrs scipy pandas tqdm brotli typer \
  rich toml pydantic numba "panda3d==1.10.14" cattrs msgpack msgpack-numpy pyyaml \
  panda3d-simplepbr panda3d-gltf pillow h5py
# 3. 验证
uv run python -c "import pooltool as pt; print(pt.__version__)"
```

## 坐标与参数换算（对拍双方都对齐后的结论）

| 项 | poolhall | pooltool 0.6.0 | 映射 |
|----|----------|----------------|------|
| 长边 | x 轴（1.9812m） | y 轴（l=1.9812 沿 y） | pt_x = ph_y, pt_y = ph_x |
| y 方向 | 向下（屏幕系） | 向上 | 隐含在转置里 |
| 角度 | angle 度，0=+x，屏幕逆时针 | phi 数学角 | **phi = 90 + angle**（不是 90−angle！） |
| 出杆 | strike(power)→球速 0.5–8 m/s | V0 是**杆速**，球速 = V0×2M/(M+m)，M=0.567,m=0.17 → ×1.538 | V0 = speed×(M+m)/(2M) |
| ω 初值 | strike 恒 0（v0 冻结） | a=b=0（中心击打）→ w=0 ✓ | 一致 |

## 物理模型对齐

- 球-球：两边都用等质量弹性无摩擦（pooltool `FrictionlessElastic`；poolhall `resolveBallBall` e_b）
- 库边：pooltool 用 `Han2005Linear/Circular`；poolhall v0 是简化模型（e_c + 切向保留 0.9），
  **多次吃库后轨迹会发散——这是已知且在意的差异**（v2 引入速度相关库边模型时收敛）
- 对拍断言分级：首碰时刻 <10ms、球-球事件序列语义对齐、终态方向一致；
  多库反弹终态只做定性断言（方向/进袋/台内）

## 复跑

```bash
uv run python gen_ref.py          # 重新生成 pooltool_ref.json
cd ../.. && pnpm -F engine test   # TS 侧对拍测试
```
