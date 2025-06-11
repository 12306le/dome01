// api/files.js
import { Readable } from 'stream';
import formidable from 'formidable';

// 关闭 Vercel 默认的 bodyParser，以便我们可以处理流式上传
export const config = {
  api: {
    bodyParser: false,
  },
};

// --- Helper Functions ---

// 使用 PROPFIND 方法列出 WebDAV 目录中的文件
async function listFiles(authConfig) {
    const { targetBaseUrl, targetAuth } = authConfig;
    const uploadsUrl = `${targetBaseUrl}uploads/`;

    const response = await fetch(uploadsUrl, {
        method: 'PROPFIND',
        headers: {
            'Authorization': targetAuth,
            'Depth': '1', // 只查找当前目录
            'User-Agent': 'Vercel-Dashboard-App/Final'
        }
    });

    if (!response.ok) {
        // 如果目录不存在 (404)，这是正常情况，直接返回空列表
        if (response.status === 404) {
            console.log("`uploads` 目录不存在，将返回空列表。");
            return [];
        }
        throw new Error(`列出文件失败: ${response.statusText}`);
    }

    const text = await response.text();
    // 使用正则表达式从 XML 响应中解析出文件链接
    const files = Array.from(text.matchAll(/<d:href>(.*?)<\/d:href>/g))
        .map(match => decodeURIComponent(match[1]))
        // 过滤掉目录本身
        .filter(href => href.startsWith(uploadsUrl.substring(uploadsUrl.indexOf('/dav/'))) && href !== uploadsUrl.substring(uploadsUrl.indexOf('/dav/')))
        .map(href => {
            const name = href.split('/').pop();
            return { name, url: `${targetBaseUrl}uploads/${encodeURIComponent(name)}` };
        });

    return files;
}

// 删除指定文件
async function deleteFile(authConfig, filename) {
    const { targetBaseUrl, targetAuth } = authConfig;
    const fileUrl = `${targetBaseUrl}uploads/${encodeURIComponent(filename)}`;

    const response = await fetch(fileUrl, {
        method: 'DELETE',
        headers: { 'Authorization': targetAuth }
    });
    
    // 204 No Content 是成功的响应
    if (!response.ok && response.status !== 204) {
        throw new Error(`删除文件失败: ${response.statusText}`);
    }
}

// --- Main Handler ---

export default async function handler(req, res) {
    // --- Authentication ---
    const appPassword = process.env.APP_PASSWORD;
    if (!appPassword) return res.status(500).json({ error: 'APP_PASSWORD not set' });
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    if (authHeader.split(' ')[1] !== appPassword) return res.status(403).json({ error: 'Forbidden' });

    // --- WebDAV Config ---
    const { TARGET_URL, TARGET_USERNAME, TARGET_PASSWORD } = process.env;
    if (!TARGET_URL || !TARGET_USERNAME || !TARGET_PASSWORD) return res.status(500).json({ error: 'Target server config missing' });
    const targetBaseUrl = TARGET_URL.endsWith('/') ? TARGET_URL : TARGET_URL + '/';
    const targetAuth = 'Basic ' + Buffer.from(`${TARGET_USERNAME}:${TARGET_PASSWORD}`).toString('base64');
    const authConfig = { targetBaseUrl, targetAuth };

    try {
        if (req.method === 'GET') {
            const files = await listFiles(authConfig);
            res.status(200).json(files);
        } 
        else if (req.method === 'POST') {
            // 使用 formidable 解析 multipart/form-data
            const form = formidable({ 
                maxFileSize: 100 * 1024 * 1024, // 100MB max
                keepExtensions: true,
            });

            form.parse(req, async (err, fields, files) => {
                if (err) {
                    console.error("解析表单时出错:", err);
                    return res.status(500).json({ error: 'Failed to process upload' });
                }

                const file = files.upload; // 'upload' 是前端 input 的 name
                const originalFilename = file.originalFilename;
                const fileStream = Readable.from(require('fs').readFileSync(file.filepath));

                const response = await fetch(`${targetBaseUrl}uploads/${encodeURIComponent(originalFilename)}`, {
                    method: 'PUT',
                    headers: { 
                        'Authorization': targetAuth,
                        'Content-Type': file.mimetype
                    },
                    body: fileStream,
                });
                
                if (!response.ok && response.status !== 201 && response.status !== 204) {
                     const errorText = await response.text();
                     throw new Error(`上传失败: ${response.statusText}, ${errorText}`);
                }
                
                res.status(200).json({ message: '文件上传成功' });
            });
        } 
        else if (req.method === 'DELETE') {
            const filename = req.query.filename;
            if (!filename) return res.status(400).json({ error: '缺少 filename 查询参数' });
            await deleteFile(authConfig, filename);
            res.status(200).json({ message: '文件删除成功' });
        } 
        else {
            res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
            res.status(405).json({ error: '不支持的方法' });
        }
    } catch (e) {
        console.error("文件 API 出错:", e);
        res.status(500).json({ error: e.message });
    }
}