// api/files.js

import { Readable } from 'stream';
import formidable from 'formidable';
import fs from 'fs'; // Use ESM import for fs

export const config = {
  api: {
    bodyParser: false,
  },
};

// --- Helper Functions ---
async function listFiles(authConfig) {
    const { targetBaseUrl, targetAuth } = authConfig;
    const uploadsUrl = `${targetBaseUrl}uploads/`;
    const response = await fetch(uploadsUrl, {
        method: 'PROPFIND',
        headers: { 'Authorization': targetAuth, 'Depth': '1', 'User-Agent': 'Vercel-Dashboard-App/Final' }
    });
    if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error(`Failed to list files: ${response.statusText}`);
    }
    const text = await response.text();
    const files = Array.from(text.matchAll(/<d:href>(.*?)<\/d:href>/g))
        .map(match => decodeURIComponent(match[1]))
        .filter(href => href.includes('/uploads/') && !href.endsWith('/uploads/'))
        .map(href => {
            const name = href.split('/').pop();
            return { name, url: `${targetBaseUrl}uploads/${encodeURIComponent(name)}` };
        });
    return files;
}

async function deleteFile(authConfig, filename) {
    const { targetBaseUrl, targetAuth } = authConfig;
    const fileUrl = `${targetBaseUrl}uploads/${encodeURIComponent(filename)}`;
    const response = await fetch(fileUrl, { method: 'DELETE', headers: { 'Authorization': targetAuth } });
    if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to delete file: ${response.statusText}`);
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
        } else if (req.method === 'POST') {
            const form = formidable({ maxFileSize: 100 * 1024 * 1024, keepExtensions: true });
            form.parse(req, async (err, fields, files) => {
                if (err) return res.status(500).json({ error: 'Failed to process upload' });
                const file = files.upload[0]; // formidable v3 returns arrays
                const originalFilename = file.originalFilename;
                const fileStream = fs.createReadStream(file.filepath); // Use fs.createReadStream
                const response = await fetch(`${targetBaseUrl}uploads/${encodeURIComponent(originalFilename)}`, {
                    method: 'PUT',
                    headers: { 'Authorization': targetAuth, 'Content-Type': file.mimetype },
                    body: fileStream,
                });
                if (![200, 201, 204].includes(response.status)) {
                    const errorText = await response.text();
                    throw new Error(`Upload failed: ${response.statusText}, ${errorText}`);
                }
                res.status(200).json({ message: 'File uploaded successfully' });
            });
        } else if (req.method === 'DELETE') {
            const filename = req.query.filename;
            if (!filename) return res.status(400).json({ error: 'Filename query parameter is required' });
            await deleteFile(authConfig, filename);
            res.status(200).json({ message: 'File deleted successfully' });
        } else {
            res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
            res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (e) {
        console.error("File API Error:", e);
        res.status(500).json({ error: e.message });
    }
}