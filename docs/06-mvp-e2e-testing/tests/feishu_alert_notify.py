#!/usr/bin/env python3
"""
飞书告警转发脚本 -- 替代 PrometheusAlert
监听 Alertmanager webhook，格式化为飞书卡片消息后转发

部署: /opt/apps/prometheusalert/bin/feishu_alert.py
端口: 18081
路径: /prometheusalert?fsurl=<飞书webhook地址>

Alertmanager 配置:
  webhook_configs:
  - url: 'http://localhost:18081/prometheusalert?fsurl=https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
    send_resolved: true
"""
import json
import ssl
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler

import certifi

LISTEN_PORT = 18081

# 东八区（北京时间，UTC+8）固定偏移，避免依赖宿主机系统时区
BEIJING_TZ = timezone(timedelta(hours=8))

# 使用 certifi 提供的根证书做 SSL 校验。
# 本机/部分 Linux 的系统 Python 默认 CA 库缺失，urlopen 直连飞书会报
# SSLCertVerificationError(self-signed certificate in certificate chain)，
# 导致所有告警转发失败。certifi 自带完整 Mozilla CA 库，可绕开该问题。
SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def to_beijing_time(ts):
    """将 Alertmanager 的 UTC ISO8601 时间字符串转为北京时间(yyyy-MM-dd HH:mm:ss)。

    Alertmanager 的 startsAt/endsAt 以 UTC 表示(如 '2026-09-11T09:52:50.000Z')。
    统一转东八区显示；解析失败则原样返回。
    """
    if not ts or ts.startswith("0001-01-01"):  # Alertmanager 未结束的零值时间
        return ""
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return ts[:19].replace("T", " ")


def format_alert(alert):
    """将单条告警格式化为飞书卡片内容"""
    status = alert.get("status", "firing")
    labels = alert.get("labels", {})
    annotations = alert.get("annotations", {})
    starts_at = alert.get("startsAt", "")
    ends_at = alert.get("endsAt", "")

    alertname = labels.get("alertname", "Unknown")
    instance = labels.get("instance", "N/A")
    severity = labels.get("severity", "N/A")
    zone = labels.get("zone", "N/A")
    summary = annotations.get("summary", "")
    description = annotations.get("description", "")

    is_resolved = status == "resolved"
    icon = "🟢" if is_resolved else "🔴"
    title_prefix = "恢复" if is_resolved else "告警"

    title = f"{icon} 【测试】{title_prefix}: {alertname}"

    lines = [
        f"**状态**: {'已恢复' if is_resolved else '告警中'}",
        f"**主机**: {instance}",
        f"**区域**: {zone}",
        f"**级别**: {severity}",
    ]
    if summary:
        lines.append(f"**摘要**: {summary}")
    if description:
        lines.append(f"**详情**: {description}")
    if starts_at:
        lines.append(f"**开始**: {to_beijing_time(starts_at)}")
    if is_resolved and ends_at:
        lines.append(f"**恢复**: {to_beijing_time(ends_at)}")

    content = "\n".join(lines)
    return title, content


def send_feishu(fsurl, title, content):
    """发送飞书交互式卡片消息"""
    payload = {
        "msg_type": "interactive",
        "card": {
            "config": {"wide_screen_mode": True},
            "header": {
                "template": "red" if "告警" in title else "green",
                "title": {"tag": "plain_text", "content": title},
            },
            "elements": [
                {
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": content},
                }
            ],
        },
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        fsurl,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=10, context=SSL_CONTEXT)
        result = json.loads(resp.read().decode("utf-8"))
        if result.get("StatusCode") == 0 or result.get("code") == 0:
            return True, "OK"
        return False, f"飞书返回: {result}"
    except Exception as e:
        return False, str(e)


class AlertHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)

        if "/prometheusalert" not in parsed.path:
            self.send_response(404)
            self.end_headers()
            return

        query = urllib.parse.parse_qs(parsed.query)
        fsurl = query.get("fsurl", [None])[0]

        if not fsurl:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'missing fsurl parameter')
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'invalid JSON')
            return

        alerts = data.get("alerts", [])
        if not alerts:
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'no alerts')
            return

        success_count = 0
        fail_count = 0
        for alert in alerts:
            title, content = format_alert(alert)
            ok, msg = send_feishu(fsurl, title, content)
            if ok:
                success_count += 1
            else:
                fail_count += 1

        status = alert.get("status", "firing")
        print(
            f"[{time.strftime('%H:%M:%S')}] "
            f"{len(alerts)} alerts ({success_count} ok, {fail_count} fail)"
        )

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"success": success_count, "fail": fail_count}).encode())

    def do_GET(self):
        """健康检查"""
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"feishu_alert running\n")

    def log_message(self, *_):
        pass


def main():
    server = HTTPServer(("0.0.0.0", LISTEN_PORT), AlertHandler)
    print(f"飞书告警转发服务启动: 0.0.0.0:{LISTEN_PORT}")
    print(f"健康检查: GET http://localhost:{LISTEN_PORT}/")
    print(f"告警接收: POST http://localhost:{LISTEN_PORT}/prometheusalert?fsurl=<飞书webhook>")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止")
        server.shutdown()


if __name__ == "__main__":
    main()
