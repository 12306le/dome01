// api/get-data.js

export default async function handler(req, res) {
  // --- 1. 单一密码安全检查 ---
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    console.error("安全警告: APP_PASSWORD 环境变量未在 Vercel 中设置。");
    return res.status(500).json({ error: '服务器安全配置不完整。' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Protected Area"');
    return res.status(401).json({ error: '需要身份验证。' });
  }

  const submittedPassword = authHeader.split(' ')[1];
  if (submittedPassword !== appPassword) {
    return res.status(403).json({ error: '禁止访问：密码错误。' });
  }

  // --- 2. WebDAV 连接逻辑 ---
  const { TARGET_URL, TARGET_USERNAME, TARGET_PASSWORD } = process.env;
  if (!TARGET_URL || !TARGET_USERNAME || !TARGET_PASSWORD) {
    console.error("配置错误: 目标 WebDAV 服务器的环境变量未完整设置。");
    return res.status(500).json({ error: '目标服务器环境变量未完整设置。' });
  }

  const targetBaseUrl = TARGET_URL.endsWith('/') ? TARGET_URL : TARGET_URL + '/';
  const targetAuth = 'Basic ' + Buffer.from(`${TARGET_USERNAME}:${TARGET_PASSWORD}`).toString('base64');
  const configUrl = `${targetBaseUrl}config.json`;

  try {
    const startTime = Date.now(); // 开始计时
    const response = await fetch(configUrl, {
      method: 'GET',
      headers: { 
        'Authorization': targetAuth, 
        'User-Agent': 'Vercel-Dashboard-App/Final' 
      }
    });
    const latency = Date.now() - startTime; // 结束计时并计算延迟

    // 将延迟时间通过自定义响应头返回给前端
    res.setHeader('X-DAV-Latency', latency);

    if (response.ok) { // 200 OK
      const data = await response.json();
      return res.status(200).json(data);
    }

    if (response.status === 404) {
      // 如果配置文件不存在，返回一个默认的、包含基础设置的结构
      console.log('配置文件不存在，返回默认结构。');
      return res.status(200).json({
        "meta": {
          "title": "新控制台",
          "favicon": "https://raw.githubusercontent.com/PKM-er/Blue-topaz-examples/main/icons/MdiBook-open-variant.svg"
        },
        "settings": {
          "theme": "light",
          "accentColor": "#007aff",
          "backgroundImage": ""
        },
        "blocks": [
          {
            "id": "block-links-default",
            "type": "links",
            "title": "示例链接",
            "icon": "🔗",
            "data": [
              { "id": "l-default", "name": "Vercel", "url": "https://vercel.com", "icon": "", "description": "应用托管平台" }
            ]
          }
        ]
      });
    }

    // 其他错误
    const errorText = await response.text();
    console.error(`从 WebDAV 获取文件失败: ${response.status}`, errorText);
    return res.status(response.status).json({ error: '从 WebDAV 获取文件失败', details: errorText });

  } catch (e) {
    console.error('访问 WebDAV 时发生网络错误:', e.message);
    return res.status(500).json({ error: '访问 WebDAV 时发生网络错误', details: e.message });
  }
}