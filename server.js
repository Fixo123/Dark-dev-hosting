// server.js - DARK DEV OFC Full API
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// File upload setup
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

console.log('🔥 DARK DEV OFC API Starting...');

// Store SSE connections
const sseConnections = {};

// ============================================================
// NETLIFY DEPLOY
// ============================================================
async function deployToNetlify(repo, branch, siteName) {
    const netlifyToken = process.env.NETLIFY_TOKEN;
    if (!netlifyToken) throw new Error('Netlify token not configured');

    const createUrl = 'https://api.netlify.com/api/v1/sites';
    const response = await fetch(createUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${netlifyToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: siteName || repo.split('/').pop(),
            repo: `https://github.com/${repo}`,
            branch: branch || 'main'
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Netlify: ${error}`);
    }

    const data = await response.json();
    return {
        success: true,
        url: `https://${data.name}.netlify.app`,
        provider: 'netlify',
        siteId: data.id
    };
}

// ============================================================
// GITHUB PAGES DEPLOY
// ============================================================
async function deployToGitHubPages(repo, branch, siteName) {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) throw new Error('GitHub token not configured');

    const deployUrl = `https://api.github.com/repos/${repo}/deployments`;
    const response = await fetch(deployUrl, {
        method: 'POST',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
            ref: branch || 'main',
            environment: 'production',
            auto_merge: true
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub Pages: ${error}`);
    }

    const data = await response.json();
    return {
        success: true,
        url: `https://${repo.split('/')[0]}.github.io/${repo.split('/')[1]}`,
        provider: 'github-pages',
        deploymentId: data.id
    };
}

// ============================================================
// FILE UPLOAD DEPLOY - Create temp repo and deploy
// ============================================================
async function deployFileToNetlify(files, siteName) {
    const netlifyToken = process.env.NETLIFY_TOKEN;
    if (!netlifyToken) throw new Error('Netlify token not configured');

    // Create a temporary directory
    const tempDir = path.join(__dirname, 'temp', siteName);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Extract files
    for (const file of files) {
        const filePath = path.join(tempDir, file.originalname);
        fs.copyFileSync(file.path, filePath);
    }

    // Create zip
    const zip = new AdmZip();
    const filesInDir = fs.readdirSync(tempDir);
    for (const f of filesInDir) {
        zip.addLocalFile(path.join(tempDir, f));
    }
    const zipPath = path.join(__dirname, 'temp', `${siteName}.zip`);
    zip.writeZip(zipPath);

    // Upload to Netlify
    const uploadUrl = 'https://api.netlify.com/api/v1/sites';
    const formData = new FormData();
    formData.append('file', fs.createReadStream(zipPath));
    formData.append('name', siteName);

    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${netlifyToken}`
        },
        body: formData
    });

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(zipPath);

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Netlify file upload: ${error}`);
    }

    const data = await response.json();
    return {
        success: true,
        url: `https://${data.name}.netlify.app`,
        provider: 'netlify',
        siteId: data.id
    };
}

// ============================================================
// SSE - Real Time Updates
// ============================================================
function sendSSEUpdate(projectName, data) {
    const connections = sseConnections[projectName] || [];
    const message = `data: ${JSON.stringify(data)}\n\n`;
    connections.forEach(conn => {
        try { conn.write(message); } catch (e) {}
    });
}

// ============================================================
// DEPLOY API - With Failover
// ============================================================
app.post('/api/deploy', async (req, res) => {
    console.log('📥 Deploy request:', req.body);

    try {
        const { repo, branch, siteName, files } = req.body || {};

        // ============================================================
        // FILE UPLOAD DEPLOY
        // ============================================================
        if (files && files.length > 0) {
            console.log(`📁 File upload deploy: ${files.length} files`);
            const projectName = siteName || 'site-' + Date.now();
            
            try {
                const result = await deployFileToNetlify(files, projectName);
                return res.json({
                    success: true,
                    message: '✅ Files deployed to Netlify!',
                    siteName: projectName,
                    url: result.url,
                    liveUrl: result.url,
                    provider: result.provider,
                    isFileUpload: true
                });
            } catch (error) {
                return res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        }

        // ============================================================
        // GITHUB REPO DEPLOY
        // ============================================================
        if (!repo) {
            return res.status(400).json({
                success: false,
                error: 'Repository URL or files required'
            });
        }

        let repoFull = repo.replace('https://github.com/', '').replace(/\.git$/, '').replace(/\/$/, '');
        const projectName = siteName || repoFull.split('/').pop();

        console.log(`🔍 Checking: ${repoFull}`);

        // Verify repo exists
        const checkRes = await fetch(`https://api.github.com/repos/${repoFull}`);
        if (!checkRes.ok) {
            return res.status(404).json({
                success: false,
                error: 'Repository not found or private'
            });
        }

        // ============================================================
        // TRY NETLIFY FIRST
        // ============================================================
        let result = null;
        let error = null;

        try {
            result = await deployToNetlify(repoFull, branch, projectName);
            console.log(`✅ Netlify: ${result.url}`);
            sendSSEUpdate(projectName, {
                type: 'complete',
                status: 'active',
                message: '✅ Deployed to Netlify!',
                url: result.url,
                provider: 'netlify'
            });
        } catch (err) {
            error = err.message;
            console.log(`❌ Netlify failed: ${error}`);
        }

        // ============================================================
        // FALLBACK TO GITHUB PAGES
        // ============================================================
        if (!result) {
            try {
                result = await deployToGitHubPages(repoFull, branch, projectName);
                console.log(`✅ GitHub Pages: ${result.url}`);
                sendSSEUpdate(projectName, {
                    type: 'complete',
                    status: 'active',
                    message: '✅ Deployed to GitHub Pages!',
                    url: result.url,
                    provider: 'github-pages'
                });
            } catch (err) {
                error = err.message;
                console.log(`❌ GitHub Pages failed: ${error}`);
            }
        }

        // ============================================================
        // RETURN RESULT
        // ============================================================
        if (result) {
            return res.json({
                success: true,
                message: `✅ Deployed to ${result.provider}!`,
                siteName: projectName,
                url: result.url,
                liveUrl: result.url,
                provider: result.provider
            });
        } else {
            return res.status(500).json({
                success: false,
                error: `All providers failed: ${error || 'Unknown error'}`
            });
        }

    } catch (error) {
        console.error('❌ Deploy error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// ============================================================
// SSE STREAM
// ============================================================
app.get('/api/deploy/:projectName/stream', (req, res) => {
    const { projectName } = req.params;
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    if (!sseConnections[projectName]) {
        sseConnections[projectName] = [];
    }
    sseConnections[projectName].push(res);

    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE connected' })}\n\n`);

    req.on('close', () => {
        if (sseConnections[projectName]) {
            sseConnections[projectName] = sseConnections[projectName].filter(conn => conn !== res);
        }
    });
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/deploy', (req, res) => {
    res.json({
        success: true,
        message: '✅ API is running!',
        providers: {
            netlify: !!process.env.NETLIFY_TOKEN,
            github_pages: !!process.env.GITHUB_TOKEN,
            file_upload: true
        },
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// STATUS CHECK
// ============================================================
app.get('/api/deploy/:siteName/status', (req, res) => {
    const { siteName } = req.params;
    res.json({
        success: true,
        status: 'active',
        url: `https://${siteName}.netlify.app`,
        provider: 'unknown'
    });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('═'.repeat(50));
    console.log('✅ DARK DEV OFC API Running');
    console.log(`📡 Port: ${PORT}`);
    console.log(`📝 Netlify: ${process.env.NETLIFY_TOKEN ? '✅' : '❌'}`);
    console.log(`📝 GitHub Pages: ${process.env.GITHUB_TOKEN ? '✅' : '❌'}`);
    console.log(`📁 File Upload: ✅ Enabled`);
    console.log('═'.repeat(50));
});