// server.js - DARK DEV OFC Full API (Fixed)
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
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

console.log('🔥 DARK DEV OFC API Starting...');

// ============================================================
// NETLIFY DEPLOY - FIXED
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
// GITHUB PAGES DEPLOY - FIXED
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
// FILE UPLOAD DEPLOY - FIXED
// ============================================================
async function deployFilesToNetlify(files, siteName) {
    const netlifyToken = process.env.NETLIFY_TOKEN;
    if (!netlifyToken) throw new Error('Netlify token not configured');

    console.log(`📁 Uploading ${files.length} files to Netlify...`);

    // Create a temporary directory
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
// DEPLOY API - FIXED
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
            console.log(`📁 File upload deploy: ${files.length} files`);
            const projectName = siteName || 'site-' + Date.now();
            
            try {
                const result = await deployFilesToNetlify(files, projectName);
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
        try {
            const checkRes = await fetch(`https://api.github.com/repos/${repoFull}`, {
                headers: {
                    'User-Agent': 'DARK-DEV-OFC-Deploy'
                }
            });

            if (!checkRes.ok) {
                if (checkRes.status === 404) {
                    return res.status(404).json({
                        success: false,
                        error: 'Repository not found. Make sure it is public and the URL is correct.',
                        code: 'REPO_NOT_FOUND'
                    });
                }
                if (checkRes.status === 403) {
                    return res.status(403).json({
                        success: false,
                        error: 'GitHub API rate limit exceeded. Please try again later.',
                        code: 'RATE_LIMIT'
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

        } catch (githubError) {
            console.error('GitHub check error:', githubError);
            return res.status(500).json({
                success: false,
                error: 'Failed to check repository: ' + githubError.message,
                code: 'GITHUB_CHECK_FAILED'
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
                error: `All providers failed: ${error || 'Unknown error'}`,
                code: 'ALL_PROVIDERS_FAILED'
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
// FILE UPLOAD ENDPOINT (Alternative)
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
            message: '✅ Files uploaded and deployed!',
            siteName: projectName,
            url: result.url,
            liveUrl: result.url,
            provider: result.provider
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
        providers: {
            netlify: !!process.env.NETLIFY_TOKEN,
            github_pages: !!process.env.GITHUB_TOKEN,
            file_upload: true
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
    console.log(`📝 Netlify: ${process.env.NETLIFY_TOKEN ? '✅' : '❌'}`);
    console.log(`📝 GitHub Pages: ${process.env.GITHUB_TOKEN ? '✅' : '❌'}`);
    console.log(`📁 File Upload: ✅ Enabled`);
    console.log('═'.repeat(50));
});
