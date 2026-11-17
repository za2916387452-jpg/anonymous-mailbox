# Vercel 部署版

此目录包含 Vercel 可识别的 Flask 入口 app.py。留言和教师会话写入 Neon/Postgres；不会使用 Vercel 临时文件保存留言。数据库表会在第一次请求时自动创建。

## 先看平台限制

Vercel 默认网址以 vercel.app 结尾。GreatFire 的近期网络测量显示，抽测的 vercel.app 地址在中国大陆访问受阻；不要未实测就把默认网址印成班级二维码。即使绑定自己的域名，也要先在校园网和不同运营商的手机流量下实测。

## 1. 把代码放进 GitHub

把本目录中的 app.py、requirements.txt、.python-version、public 目录和 README.md 上传到你的 GitHub 仓库。

如果仓库还包含原项目其他目录，后续在 Vercel 的 Root Directory 选择 vercel。若你把本目录内容直接放在仓库根目录，Root Directory 保持默认。

## 2. 在 Vercel 导入 GitHub 仓库

1. 在 Vercel 控制台点 Add New → Project。
2. 连接 GitHub，选择匿名信箱仓库并点 Import。
3. 确认 Root Directory 指向本目录。
4. Framework Preset 应自动识别 Flask；无需填写 Build Command 或 Output Directory。
5. 添加环境变量 ADMIN_PASSWORD，填一个新的强后台密码。

## 3. 连接持久数据库

1. 在 Vercel 项目中打开 Storage 或 Marketplace，选择 Neon Postgres 并创建免费数据库。
2. 把数据库接入这个 Vercel 项目。
3. 确认项目环境变量里有 DATABASE_URL。若集成使用了其他变量名，把它复制为 DATABASE_URL。
4. 将 ADMIN_PASSWORD 和 DATABASE_URL 设为 Production 环境变量；需要预览环境时再额外勾选 Preview。
5. 保存后重新部署。

不要把 DATABASE_URL 或后台密码提交到 GitHub。Neon 免费计划额度会调整，以创建时的控制台显示为准。

## 4. 检查上线

- 学生页面：部署域名根路径 /
- 教师后台：域名后加 /admin
- 教师后台登录后，可按北京时间的开始日期和结束日期导出 CSV 留言表格。
- 接口检查：域名后加 /api/health，应返回 {"ok":true}

学生二维码只放根路径。第一次运行 /api/health 或提交留言时，应用会自动创建数据库表。留言备份请从 Neon 控制台导出数据库。

## 隐私

程序不会主动保存学生 IP、浏览器或设备信息。Vercel、数据库服务和网络服务仍可能按各自规则记录访问日志；匿名留言不等于无法被任何服务追踪。
