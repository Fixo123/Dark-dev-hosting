// server.js - DARK DEV OFC (Netlify Only)
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
    limits: { fileSize: 50 * 1024 * 1024 }
});

console.log('🔥 DARK DEV OFC API Starting...');
console.log('📦 Provider: Netlify Only');

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
// FILE UPLOAD DEPLOY
// ============================================================
async function deployFilesToNetlify(files, siteName) {
    const netlifyToken = process.env.NETLIFY_TOKEN;
    if (!netlifyToken) throw new Error('Netlify token not configured');

    console.log(`📁 Uploading ${files.length} files to Netlify...`);

    // Create temp directory
    const tempDir = path.join(__dirname, 'temp', siteName);
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Save files
    for (const file of files) {
        const filePath = path.join(tempDir, file.originalname);
        fs.writeFileSync(filePath, file.buffer);
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
// DEPLOY API
// ============================================================
app.post('/api/deploy', upload.array('files'), async (req, res) => {
    console.log('📥 Deploy request received');

    try {
        const { repo, branch, siteName } = req.body || {};
        const files = req.files || [];

        // ============================================================
        // FILE UPLOAD DEPLOY
        // ============================================================
        if (files && files.length > 0) {
            console.log(`📁 File upload: ${files.length} files`);
            const projectName = siteName || 'site-' + Date.now();
            
            try {
                const result = await deployFilesToNetlify(files, projectName);
                return res.json({
                    success: true,
                    message: '✅ Files deployed to Netlify!',
                    siteName: projectName,
                    url: result.url,
                    liveUrl: result.url,
                    provider: 'netlify',
                    isFileUpload: true
                });
            } catch (error) {
                console.error('File upload error:', error);
                return res.status(500).json({
                    success: false,
                    error: error.message || 'File upload failed'
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

        console.log(`🔍 Checking repository: ${repoFull}`);

        // Check if repo exists (public)
        const checkRes = await fetch(`https://api.github.com/repos/${repoFull}`, {
            headers: { 'User-Agent': 'DARK-DEV-OFC-Deploy' }
        });

        if (!checkRes.ok) {
            if (checkRes.status === 404) {
                return res.status(404).json({
                    success: false,
                    error: 'Repository not found. Make sure it is public.',
                    code: 'REPO_NOT_FOUND'
                });
            }
            return res.status(checkRes.status).json({
                success: false,
                error: `GitHub API error: ${checkRes.status}`,
                code: 'GITHUB_API_ERROR'
            });
        }

        const repoData = await checkRes.json();
        console.log(`✅ Repository found: ${repoData.full_name}`);

        // ============================================================
        // DEPLOY TO NETLIFY
        // ============================================================
        try {
            const result = await deployToNetlify(repoFull, branch, projectName);
            console.log(`✅ Netlify deploy successful: ${result.url}`);
            
            return res.json({
                success: true,
                message: '✅ Deployed to Netlify successfully!',
                siteName: projectName,
                url: result.url,
                liveUrl: result.url,
                provider: 'netlify'
            });
        } catch (error) {
            console.error('❌ Netlify deploy failed:', error);
            return res.status(500).json({
                success: false,
                error: error.message || 'Netlify deployment failed',
                code: 'NETLIFY_FAILED'
            });
        }

    } catch (error) {
        console.error('❌ Deploy error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ============================================================
// UPLOAD ENDPOINT
// ============================================================
app.post('/api/upload', upload.array('files'), async (req, res) => {
    try {
        const files = req.files || [];
        const { siteName } = req.body || {};

        if (files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No files uploaded'
            });
        }

        const projectName = siteName || 'site-' + Date.now();
        const result = await deployFilesToNetlify(files, projectName);

        res.json({
            success: true,
            message: '✅ Files uploaded and deployed to Netlify!',
            siteName: projectName,
            url: result.url,
            liveUrl: result.url,
            provider: 'netlify',
            isFileUpload: true
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Upload failed'
        });
    }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/api/deploy', (req, res) => {
    res.json({
        success: true,
        message: '✅ API is running!',
        provider: 'netlify',
        status: {
            netlify: !!process.env.NETLIFY_TOKEN ? '✅ Configured' : '❌ Not configured'
        },
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('═'.repeat(50));
    console.log('✅ DARK DEV OFC API Running');
    console.log(`📡 Port: ${PORT}`);
    console.log(`📦 Provider: Netlify`);
    console.log(`📝 Netlify: ${process.env.NETLIFY_TOKEN ? '✅ Configured' : '❌ Not configured'}`);
    console.log('═'.repeat(50));
});
