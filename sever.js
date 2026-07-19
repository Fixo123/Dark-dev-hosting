// server.js - Render Web Service
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// ============================================================
// DEPLOY API - REAL DEPLOYMENT TO CLOUDFLARE PAGES
// ============================================================
app.post('/api/deploy', async (req, res) => {
    const { repo, branch, siteName } = req.body;
    
    // Validate
    if (!repo) {
        return res.status(400).json({ 
            success: false,
            error: 'Repository URL is required' 
        });
    }

    console.log(`📥 Deploy request: ${repo} (${branch || 'main'})`);

    try {
        // ============================================================
        // STEP 1: Check if repository is public
        // ============================================================
        console.log(`🔍 Checking repository: ${repo}`);
        const checkRes = await fetch(`https://api.github.com/repos/${repo}`);
        
        if (!checkRes.ok) {
            return res.status(404).json({
                success: false,
                error: 'Repository not found or is private. Only public repositories are supported.',
                code: 'PUBLIC_REPO_REQUIRED'
            });
        }

        const repoData = await checkRes.json();
        console.log(`✅ Repository found: ${repoData.full_name} (⭐ ${repoData.stargazers_count} stars)`);

        // ============================================================
        // STEP 2: Generate project name
        // ============================================================
        const projectName = siteName || `darkdev-${repo.split('/').pop()}`;
        const branchName = branch || 'main';

        // ============================================================
        // STEP 3: Check Cloudflare credentials
        // ============================================================
        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        const apiToken = process.env.CLOUDFLARE_API_TOKEN;

        if (!accountId || !apiToken) {
            console.warn('⚠️ Cloudflare credentials not set. Running in demo mode.');
            
            // Demo mode - return fake success with demo URL
            return res.json({
                success: true,
                message: '✅ Demo mode: Deployment simulated successfully!',
                siteName: projectName,
                url: `${projectName}.pages.dev`,
                liveUrl: `https://${projectName}.pages.dev`,
                isDemo: true,
                note: '⚠️ Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in Render environment variables for real deployments.'
            });
        }

        // ============================================================
        // STEP 4: Deploy to Cloudflare Pages
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
        // STEP 5: If project doesn't exist, create it
        // ============================================================
        if (!deployResponse.ok && deployData.errors && deployData.errors.some(e => e.code === 1000)) {
            console.log(`📁 Creating new project: ${projectName}`);
            
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

            // Retry deployment after creation
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
        // STEP 6: Return success with live URL
        // ============================================================
        const liveUrl = `${projectName}.pages.dev`;
        console.log(`✅ Deployment started: https://${liveUrl}`);

        return res.json({
            success: true,
            message: '🚀 Deployment started successfully!',
            siteName: projectName,
            url: liveUrl,
            liveUrl: `https://${liveUrl}`,
            deploymentId: deployData.result?.id || 'pending',
            status: deployData.result?.status || 'building',
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
// GET DEPLOYMENT STATUS
// ============================================================
app.get('/api/deploy/:projectName/status', async (req, res) => {
    const { projectName } = req.params;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken) {
        return res.json({
            success: true,
            status: 'active',
            url: `${projectName}.pages.dev`,
            liveUrl: `https://${projectName}.pages.dev`,
            isDemo: true
        });
    }

    try {
        const statusUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`;
        const response = await fetch(statusUrl, {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return res.json({
                success: true,
                status: 'unknown',
                url: `${projectName}.pages.dev`,
                liveUrl: `https://${projectName}.pages.dev`
            });
        }

        const data = await response.json();
        const latestDeploy = data.result?.[0];

        return res.json({
            success: true,
            status: latestDeploy?.status || 'active',
            url: `${projectName}.pages.dev`,
            liveUrl: `https://${projectName}.pages.dev`,
            deployTime: latestDeploy?.created_on,
            isDemo: false
        });

    } catch (error) {
        return res.json({
            success: true,
            status: 'active',
            url: `${projectName}.pages.dev`,
            liveUrl: `https://${projectName}.pages.dev`
        });
    }
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🔥 DARK DEV OFC Server running on port ${PORT}`);
    console.log(`📝 API Endpoint: http://localhost:${PORT}/api/deploy`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('👋 Shutting down...');
    process.exit(0);
});            }
        }

        res.json({
            success: true,
            message: 'Deployment started! 🚀',
            siteName: projectName,
            url: `${projectName}.pages.dev`
        });

    } catch (error) {
        console.error('Deploy error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
