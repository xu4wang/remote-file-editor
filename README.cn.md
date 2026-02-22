# Remote File Editor（远程文件编辑器）

![remote access VPS](image.png)

一个带有 VS Code 风格布局的轻量级 Web IDE：
- 基于 Monaco 的代码编辑器，支持语法高亮
- 文件树浏览，读取与保存均带有路径安全检查
- 图片查看与简单编辑（调整尺寸、灰度处理、显示字节大小）
- 终端风格面板（通过 API 驱动）：在提示符后输入命令，结果显示在下一行，然后提示符重新出现
- 终端面板支持折叠/展开与拖拽调整高度
- JWT 认证，密码保护的管理入口
- 支持 Cmd/Ctrl+S 保存文件，关闭未保存标签时会弹出确认
- 针对文本和图片文件的逐标签回退：丢弃该标签的未保存更改
- 工作区文件：保存和恢复编辑状态（.workspace）
- 所有 UI 文本为英文，图标优先的操作风格

![alt text](image-1.png)

## 快速开始（Quick Start）

1）配置环境变量（可选）并启动

```bash
# 可选：在项目根目录创建 .env：
# ADMIN_PASSWORD=admin
# JWT_SECRET=dev-secret
# WORKSPACE_DIR=/absolute/path/to/your/workspace
# PORT=5174

bash ./start.sh
```

默认值：
- ADMIN_PASSWORD: admin
- JWT_SECRET: dev-secret
- WORKSPACE_DIR: 项目目录
- PORT: 5174（后端）和 5173（前端，Vite）

2）打开应用
- 前端： http://localhost:5173
- 后端： http://localhost:5174

3）登录
- 密码为 ADMIN_PASSWORD（默认：admin）

## 功能概览

- 编辑器（Editor）
  - 使用 Monaco 编辑器，自动布局，始终启用自动换行
  - 根据文件扩展名自动识别语言
  - 文本文件与图片文件均以标签形式展示
  - Cmd/Ctrl+S 保存当前文件
  - 逐标签回退：将当前标签恢复到最近一次打开/保存时的内容（文本和图片均支持）

- 图片编辑器（Image Editor）
  - 选中图片文件后自动打开
  - 显示当前图片尺寸（宽度/高度）
  - 支持锁定宽高比进行尺寸调整
  - 灰度模式开关，实时预览效果
  - 根据预览图像显示当前图片大小（字节/KB/MB）
  - “Apply” 按钮将变换后的图片写回当前标签（之后可以继续保存到磁盘）

- 文件系统（File System）
  - 带刷新功能的树形视图
  - 只允许在 WORKSPACE_DIR 下读取和保存文件（强制路径校验）
  - 可以在终端里通过 `cd` 变更工作目录

- 工作区（Workspace）
  - 工作区文件以 `.workspace` 结尾
  - 在文件树中点击 `.workspace` 条目不会打开编辑标签
  - 而是加载一个工作区：设置文件树根目录，重新打开列出的文件，并恢复当前激活的标签
  - 顶部栏的 “Save WS as” 按钮可以保存当前工作区
    - 每次都会提示输入工作区文件名
    - 使用相对路径，将文件保存到后端的 baseDir（WORKSPACE_DIR）下
  - 工作区文件格式示例：

    ```json
    {
      "rootPath": "relative/path/to/root-or-null",
      "openFiles": [
        "relative/path/to/file-1",
        "relative/path/to/file-2"
      ],
      "activePath": "relative/path/to/file-1"
    }
    ```

- 终端风格面板（Terminal-like Panel，API 模式）
  - 在提示符后输入内容然后回车
  - 输出显示在下一行，然后新的提示符出现
  - `cd <dir>` 可以改变工作目录
  - `clear` 清空面板内容
  - 支持折叠/展开以及拖拽调整高度

- 认证（Auth）
  - 使用 POST /api/auth/login，Body 为 { password }
  - 所有文件操作和命令执行相关的 API 都需要 Bearer Token
  - 登录表单支持在密码输入框中按回车直接提交

- 工具链（Tooling）
  - `npm run lint`：运行 ESLint
  - `npm run typecheck`：运行 TypeScript 项目引用检查
  - `npm test`：运行基于 Vitest 的测试

## API 端点（API Endpoints）

- POST /api/auth/login
  - Body: { "password": "..." }
  - Response: { "token": "..." }

- GET /api/fs/tree
  - Headers: Authorization: Bearer \<token\>
  - Query: path（可选，在 WORKSPACE_DIR 下的相对路径）

- GET /api/fs/read
  - Headers: Authorization: Bearer \<token\>
  - Query: path（必填，相对路径）

- POST /api/fs/save
  - Headers: Authorization: Bearer \<token\>，Content-Type: application/json
  - Body: { "path": "<relative>", "content": "<text>" }

- GET /api/fs/chdir
  - Headers: Authorization: Bearer \<token\>
  - Query: cwd（当前相对路径），target（目标相对路径）

- POST /api/exec
  - Headers: Authorization: Bearer \<token\>，Content-Type: application/json
  - Body: { "cmd": "<command>", "args": [], "cwd": "<relative>" }
  - 说明：`shell: true`；返回合并后的 stdout/stderr

## 手动启动（Manual Start，备用方案）

```bash
export ADMIN_PASSWORD=admin
export JWT_SECRET=dev-secret
export WORKSPACE_DIR="$PWD"
export PORT=5174
npm install
npm run dev
```

前端： http://localhost:5173  
后端： http://localhost:5174

## 生产环境部署（Production Deployment）

在生产环境中，应用由两部分组成：
- 构建后的静态前端，位于 dist 目录
- 独立端口上的 Node.js API 服务器（Express）

推荐使用反向代理统一对外暴露。

### 1）构建前端

```bash
git clone <this-repo>
cd remote-file-editor
npm ci
npm run build
# 构建结果在 ./dist
```

### 2）将 API 服务器作为服务运行

通过环境变量来约束访问控制与可编辑范围：
- ADMIN_PASSWORD：登录所需密码
- JWT_SECRET：用于签发 Token 的随机长字符串
- WORKSPACE_DIR：允许编辑的绝对路径
- PORT：API 服务器端口（默认 5174）

在 Linux 上使用 systemd 示例：

```ini
# /etc/systemd/system/remote-file-editor.service
[Unit]
Description=Remote File Editor API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/remote-file-editor
Environment=ADMIN_PASSWORD=change-me
Environment=JWT_SECRET=$(openssl rand -hex 32)
Environment=WORKSPACE_DIR=/srv/code
Environment=PORT=5174
ExecStart=/usr/bin/node server/index.js
Restart=always
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
```

然后执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now remote-file-editor
sudo systemctl status remote-file-editor
```

使用 PM2 的替代方式：

```bash
npm i -g pm2
ADMIN_PASSWORD=change-me \
JWT_SECRET=$(openssl rand -hex 32) \
WORKSPACE_DIR=/srv/code \
PORT=5174 \
pm2 start server/index.js --name remote-file-editor
pm2 save
pm2 startup
```

### 3）提供构建后的前端

推荐：使用 Nginx 提供 dist 目录的静态资源，并将 /api 代理到 Node API。

```nginx
server {
    listen 80;
    server_name example.com;

    root /opt/remote-file-editor/dist;
    index index.html;

    # 提供 SPA
    location / {
        try_files $uri /index.html;
    }

    # 代理 API
    location /api/ {
        proxy_pass http://127.0.0.1:5174;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

重载配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

快速本地静态服务（仅用于 dist）：

```bash
npx serve -s dist -l 8080
# 通过 http://localhost:8080 访问，确保 /api 指向正确的 API（通过反向代理或 CORS）
```

### 4）安全与运维注意事项

- 为 ADMIN_PASSWORD 和 JWT_SECRET 设置足够强度的值。
- 将 WORKSPACE_DIR 限制在专用目录中；API 会在该根目录内强制执行路径安全校验。
- 推荐将 API 放在反向代理和 TLS（Nginx/Caddy）之后。
- 日志与持久化：确保进程管理工具配置了自动重启和持久化。
- CORS：为了方便开发，目前 API 默认允许跨域。生产环境推荐让前端与 API 部署在同一域名下，从根本上避免 CORS 问题。

