# 生产部署（腾讯云轻量 + Nginx + systemd）

## 1) 环境变量

在服务器创建 `/etc/gdlab.env`：

```bash
NOTION_TOKEN=...
NOTION_DATABASE_ID=...
NEXT_PUBLIC_SITE_URL=https://quentin.fun
REVALIDATE_SECRET=...
NOTION_SNAPSHOT_DIR=/var/lib/gdlab/notion-snapshots
NOTION_SNAPSHOT_RETENTION_DAYS=90
REVALIDATE_URL=http://127.0.0.1:3000/api/internal/revalidate
```

建议权限：

```bash
chmod 600 /etc/gdlab.env
```

## 2) 应用服务

```bash
cp ops/systemd/gdlab.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gdlab.service
systemctl status gdlab.service
```

## 3) Notion 同步定时任务

```bash
cp ops/systemd/gdlab-notion-sync.service /etc/systemd/system/
cp ops/systemd/gdlab-notion-sync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now gdlab-notion-sync.timer
systemctl status gdlab-notion-sync.timer
```

手动触发一次：

```bash
systemctl start gdlab-notion-sync.service
journalctl -u gdlab-notion-sync.service -n 100 --no-pager
```

## 4) Nginx

```bash
cp ops/nginx/gdlab.conf /etc/nginx/conf.d/gdlab.conf
nginx -t
systemctl reload nginx
```

## 5) HTTPS（Let's Encrypt）

```bash
certbot --nginx -d quentin.fun -d www.quentin.fun
certbot renew --dry-run
```
