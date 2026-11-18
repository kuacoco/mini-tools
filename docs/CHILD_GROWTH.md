# 成长手记

## 范围与数据

多孩子档案（每账号最多20个），各自独立的出生日期、参考曲线性别、身高 cm / 体重 kg / 日期 / 可选小记。支持新增、编辑、删除测量，一天一条；编辑日期会原子迁移记录，不覆盖同日记录。云端按微信 OPENID 隔离，客户端不传 owner。没有公开分享接口。首次保存测量后出生日期与性别锁定（即使删除全部记录也不解除），昵称可编辑；避免参考曲线解释被意外改变。无客户端持久化儿童健康数据。

保存带请求标识，新增/编辑重试不会重复创建；修订号防止旧编辑覆盖新记录。一个日期的新请求不会无提示覆盖旧数据。表单失败保留内容，关闭有未保存内容时确认。云函数与客户端均校验日期、单位和一位小数。0–18周岁之外不绘制参考、不推算。

## 生长参考数据（2026-11-18 核对）

选择 CDC 2000 历史参考人口，使用男/女 P3、P50、P97；不是中国儿童临床诊断标准。参考来源标示在图表下，说明中提供官方链接。体重年龄曲线只作趋势对照，不能用于判断青春期肥胖/营养状态。CDC 推荐婴幼儿临床优先 WHO 标准；本功能为了提供明确同一来源的完整0–18岁对照，保留 CDC 婴儿参考并在说明中披露限制。

官方数据与方法： https://www.cdc.gov/growthcharts/cdc-data-files.htm
推荐与解释： https://www.cdc.gov/growthcharts/information-for-healthcare-professionals.htm
WHO 5–10岁体重参考及不延伸至10岁以上的解释： https://www.who.int/tools/growth-reference-data-for-5to19-years/indicators/weight-for-age-5to10-years

原始表、文档和验证脚本已在 `project.config.json` 的打包忽略列表中；小程序仅携带约40KB的生成JSON。原始 CSV 保留于 `data/growth/source/`，来自 CDC 官方 `https://www.cdc.gov/growthcharts/data/zscore/`：

| 文件 | 内容 | SHA-256 |
|---|---|---|
| lenageinf.csv | 出生至36月卧位身长 | a334b86bc0ecde80d12cdc172dde17b4390ca53ac372b26dd0d72d8502ac2687 |
| wtageinf.csv | 出生至36月体重 | 73221dd4de82eb9a70c1e6dd45c9b9e285fa1a3d7fff4971c3b85c1be6e5feed |
| statage.csv | 2–20岁站立身高 | 45130d2a9d7c50c54a47e7ba626b66c61d4554bc2d901198cedd9419a53f7251 |
| wtage.csv | 2–20岁体重 | 3406c9d125bcb69c062a9e84eb8c0209bfe9346542bdc1d308643750dcc241b7 |

生成：`python3 scripts/build-growth-reference.py`。输出 `utils/growth-reference.json` 保留官方月龄节点和分位数精度，并保留216.5月节点用于18周岁处插值。按日历周年/月周年（月底截至当月末）计算小数月龄，对相邻官方分位数节点线性插值。低于24月用婴儿表，24月起用儿童表。两岁处的参考段分开，不跨越卧位/站立测量方式连接；实际记录点连线仅表示趋势。

图表支持身高/体重切换、当前阶段（0–2、2–6、6–12、12–18岁）和0–18岁总览。坐标范围包含所有视窗内记录（包括带外记录），不裁掉偏离值。色带P3–P97、中位虚线、实测点线，轻触点显示日期/月龄/值；时间线提供完整文字替代。真实记录不预填演示数据。时间线逆序，每次显示20条，可展开更早记录；曲线使用所有已读取的分页记录。

## 云开发配置（上线前）

新增云函数：`growthCrud`。首次部署除函数代码外，还需要下述数据库集合与权限配置。

在云环境创建以下两个集合，权限设置为**所有客户端不可读写**，只通过带 OPENID 校验的云函数访问：

- `growth_profiles`
- `growth_measurements`

建议索引：

- profiles: `openid ASC, createdAt ASC`。
- measurements: `openid ASC, childId ASC, date DESC`。

记录文档 ID 为 OPENID、孩子ID、日期的 SHA-256，天然实现一天一条。服务端校验 ownership、档案修订、记录修订；写入和改日期/删除均使用事务。测量写入与档案锁定在同一事务中，避免并发修改出生日期/性别。列表按日期游标每页100条；客户端读取全部页用于曲线。客户端不把部分分页结果当作完整读取成功。

经用户明确要求后，沿用 `.agents/skills/mp-ci/SKILL.md` 部署该云函数，再预览/上传指定分支。工作流已支持函数白名单项 `growthCrud`。

## 本地检查

`node scripts/check-repo.js`
`node --test tests/regression.test.js tests/growth.test.js`
`python3 scripts/build-growth-reference.py`
`git diff --check`

微信开发者工具/真机仍需验证：Skyline Canvas 2D、原生日期弹层、小数键盘及键盘出现后的底部表单可达性、云开发集合/事务/索引与 OPENID 隔离。浏览器预览仅用于实际模板/样式和页面交互校验，不代表小程序运行时。

## 当前验证结果

`tests/growth-browser.js` 已通过7组本地浏览器流程检查，涵盖身高/体重与年龄视窗切换、填写与微调、失败后重试、编辑删除、320/375/430px布局、短视窗表单滚动、参考说明、新建孩子和空时间线、读取失败重试。证据位于 `/tmp/growth-verification/`。静态 premium strict audit 0 findings（注意审计器不理解WXML/WXSS，不能替代运行时验证）；DESIGN.md 官方 lint 0 errors，现有token引用/spacing识别的warning仍存在。
