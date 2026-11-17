# 班级匿名信箱

这是一个极简的 B/S 匿名留言系统：

- 学员扫描二维码后直接留言，不需要注册、登录或填写身份信息。
- 教师通过 `/admin` 密码登录后台，只能查看、标记已读和删除留言。
- 程序不会主动保存 IP 地址、浏览器信息或设备信息。
- 数据保存在 `data/messages.json`，部署时请做好文件备份和访问保护。

## 本地运行

需要 Node.js 20 或更高版本。当前项目没有第三方依赖，直接运行即可：

```bash
node server.js
```

打开：

- 学员页面：http://localhost:3000
- 教师后台：http://localhost:3000/admin

本地演示密码：`teacher1234`。

## 部署前配置

复制 `.env.example` 为 `.env`，至少修改：

```text
ADMIN_PASSWORD=你的强密码
PUBLIC_URL=https://你的域名
```

部署环境不要使用默认演示密码。

## Docker 运行

```bash
cp .env.example .env
# 编辑 .env，设置 ADMIN_PASSWORD 和 PUBLIC_URL
docker compose up -d --build
```

容器会监听服务器的 3000 端口。公网部署时，建议再用 Caddy 或 Nginx 反向代理到 443，并启用 HTTPS。

## 二维码

二维码内容只需要设置为：

```text
https://你的域名/
```

不要把教师后台地址或密码放进二维码。

## 数据与隐私

- 留言数据位于 `data/messages.json`。
- 本版本不提供留言回复和查询码。
- 删除操作会从数据文件中移除留言，删除前请确认不需要保留。
- 服务器、云平台或反向代理可能有自己的访问日志；若要尽量保持匿名，需要在部署时关闭或缩短相关日志留存。
- 涉及正在发生的人身安全风险时，应直接联系老师、家长或学校，而不要只依赖匿名信箱。
