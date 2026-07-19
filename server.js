// server.js - Real Deploy Mode
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

console.log('🔥 Starting DARK DEV HOSTING API...');

// ============================================================
// HEALTH CHECK - GET
// ============================================================
app.get('/api/deploy', (req, res) => {
    res.json({
        success: true,
        message: '✅ API is running!',
        mode: process.env.CLOUDFLARE_ACCOUNT_ID ? 'production' : 'demo',
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// DEPLOY - POST
// ============================================================
app.post('/api/deploy', async (req, res) => {
    console.log('📥 POST /api/deploy called');
    
    try {
        const { repo, branch, siteName } = req.body || {};

        if (!repo) {
            return res.status(400).json({
                success: false,
                error: 'Repository URL is required'
            });
        }

        console.log(`🔍 Checking repository: ${repo}`);

        // ============================================================
        // STEP 1: Check if repo exists (public)
        // ============================================================
        const checkRes = await fetch(`https://api.github.com/repos/${repo}`);
        if (!checkRes.ok) {
            return res.status(404).json({
                success: false,
                error: 'Repository not found or private. Only public repositories are supported.'
            });
        }

        const repoData = await checkRes.json();
        console.log(`✅ Repository found: ${repoData.full_name} (⭐ ${repoData.stargazers_count} stars)`);

        const projectName = siteName || `darkdev-${repo.split('/').pop()}`;
        const branchName = branch || 'main';

        // ============================================================
        // STEP 2: Check Cloudflare credentials
        // ============================================================
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        const apiToken = process.env.CLOUDFLARE_API_TOKEN;

        if (!accountId || !apiToken) {
            console.warn('⚠️ Cloudflare credentials not set. Running in demo mode.');
            
            // Demo mode - return fake success
            return res.json({
                success: true,
                message: '⚠️ Demo mode: Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN',
                siteName: projectName,
                liveUrl: `https://${projectName}.pages.dev`,
                isDemo: true,
                note: '⚠️ This is a demo URL. The site is not actually deployed.'
            });
        }

        // ============================================================
        // STEP 3: Deploy to Cloudflare Pages
        // ============================================================
        console.log(`🚀 Deploying ${projectName} to Cloudflare Pages...`);
        
        const deployUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`;

        let deployResponse = await fetch(deployUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ branch: branchName })
        });

        let deployData = await deployResponse.json();

        // ============================================================
        // STEP 4: If project doesn't exist, create it
        // ============================================================
        if (!deployResponse.ok && deployData.errors?.some(e => e.code === 1000)) {
            console.log(`📁 Creating project: ${projectName}`);
            
            const createUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`;
            const createRes = await fetch(createUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: projectName,
                    production_branch: branchName,
                    source: {
                        type: 'github',
                        repo: repo,
                        owner: repo.split('/')[0]
                    }
                })
            });

            if (!createRes.ok) {
                const errorData = await createRes.json();
                console.error('❌ Create project failed:', errorData);
                return res.status(500).json({
                    success: false,
                    error: `Failed to create Pages project: ${errorData.errors?.[0]?.message || 'Unknown error'}`
                });
            }

            console.log(`✅ Project created: ${projectName}`);

            // Retry deployment
            deployResponse = await fetch(deployUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ branch: branchName })
            });
            deployData = await deployResponse.json();
        }

        if (!deployResponse.ok) {
            console.error('❌ Deployment failed:', deployData);
            return res.status(500).json({
                success: false,
                error: deployData.errors?.[0]?.message || 'Deployment failed'
            });
        }

        // ============================================================
        // STEP 5: Return success with live URL
        // ============================================================
        const liveUrl = `${projectName}.pages.dev`;
        console.log(`✅ Deployment started: https://${liveUrl}`);

        return res.json({
            success: true,
            message: '🚀 Deployment started successfully!',
            siteName: projectName,
            liveUrl: `https://${liveUrl}`,
            url: liveUrl,
            deploymentId: deployData.result?.id || 'pending',
            status: deployData.result?.status || 'building',
            isDemo: false,
            note: '⏳ Your site will be live in 1-2 minutes. Check the URL above.'
        });

    } catch (error) {
        console.error('❌ Deploy error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// ============================================================
// SPA ROUTING
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📝 Mode: ${process.env.CLOUDFLARE_ACCOUNT_ID ? 'PRODUCTION' : 'DEMO'}`);
    console.log(`🌐 API: http://localhost:${PORT}/api/deploy`);
});
