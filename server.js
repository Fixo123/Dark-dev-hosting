// server.js - DARK DEV HOSTING API with SSE Real Time Updates
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================
// ⚠️ IMPORTANT: Set this to false for REAL deployments!
// ============================================================
const DEMO_MODE = false;  // ← මෙය false ලෙස සකසන්න!

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

console.log('🔥 Starting DARK DEV HOSTING API...');
console.log(`📝 Mode: ${DEMO_MODE ? 'DEMO' : 'PRODUCTION'}`);
console.log(`🌐 Port: ${PORT}`);

// Store active SSE connections
const sseConnections = {};

// ============================================================
// HEALTH CHECK - GET
// ============================================================
app.get('/api/deploy', (req, res) => {
    console.log('📥 GET /api/deploy - Health check');
    res.json({
        success: true,
        message: '✅ API is running!',
        mode: DEMO_MODE ? 'demo' : 'production',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: 'GET /api/deploy',
            deploy: 'POST /api/deploy',
            status: 'GET /api/deploy/:projectName/status',
            stream: 'GET /api/deploy/:projectName/stream'
        }
    });
});

// ============================================================
// SSE STREAM - Real Time Updates
// ============================================================
app.get('/api/deploy/:projectName/stream', (req, res) => {
    const { projectName } = req.params;
    
    console.log(`📡 SSE stream started for: ${projectName}`);

    // Set headers for Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ 
        type: 'connected', 
        message: 'SSE connection established',
        project: projectName,
        timestamp: new Date().toISOString()
    })}\n\n`);

    // Store connection
    if (!sseConnections[projectName]) {
        sseConnections[projectName] = [];
    }
    sseConnections[projectName].push(res);

    // Send initial status
    sendSSEUpdate(projectName, {
        type: 'status',
        status: 'connecting',
        message: 'Connecting to Cloudflare...',
        progress: 0,
        timestamp: new Date().toISOString()
    });

    // Start checking status
    let attempts = 0;
    const maxAttempts = 60; // 60 * 5s = 5 minutes
    let isComplete = false;

    const checkInterval = setInterval(async () => {
        if (isComplete) {
            clearInterval(checkInterval);
            return;
        }

        attempts++;
        
        try {
            const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
            const apiToken = process.env.CLOUDFLARE_API_TOKEN;

            if (!accountId || !apiToken || DEMO_MODE) {
                // Demo mode or no credentials
                if (attempts === 1) {
                    sendSSEUpdate(projectName, {
                        type: 'status',
                        status: 'demo',
                        message: '⚠️ Demo mode: Site will be available soon',
                        progress: 50,
                        isDemo: true,
                        timestamp: new Date().toISOString()
                    });
                }
                if (attempts >= 10) {
                    sendSSEUpdate(projectName, {
                        type: 'complete',
                        status: 'active',
                        message: '✅ Demo deployment complete!',
                        progress: 100,
                        url: `https://${projectName}.pages.dev`,
                        isDemo: true,
                        timestamp: new Date().toISOString()
                    });
                    isComplete = true;
                    clearInterval(checkInterval);
                }
                return;
            }

            // Real Cloudflare status check
            const statusUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`;
            const response = await fetch(statusUrl, {
                headers: {
                    'Authorization': `Bearer ${apiToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                if (attempts === 1) {
                    sendSSEUpdate(projectName, {
                        type: 'status',
                        status: 'building',
                        message: '⏳ Creating project and starting build...',
                        progress: 10,
                        timestamp: new Date().toISOString()
                    });
                }
                return;
            }

            const data = await response.json();
            const latestDeploy = data.result?.[0];

            if (latestDeploy) {
                const status = latestDeploy.status;
                let progress = 0;
                let message = '';

                switch (status) {
                    case 'queued':
                        progress = 5;
                        message = '⏳ Deployment queued...';
                        break;
                    case 'building':
                        progress = 30 + Math.min(attempts * 5, 50);
                        message = `🔧 Building... (${progress}%)`;
                        break;
                    case 'active':
                    case 'success':
                        progress = 100;
                        message = '✅ Deployment complete!';
                        isComplete = true;
                        clearInterval(checkInterval);
                        break;
                    case 'failed':
                        progress = 100;
                        message = '❌ Deployment failed';
                        isComplete = true;
                        clearInterval(checkInterval);
                        break;
                    default:
                        progress = Math.min(attempts * 10, 90);
                        message = `⏳ ${status}... (${progress}%)`;
                }

                const liveUrl = `https://${projectName}.pages.dev`;

                sendSSEUpdate(projectName, {
                    type: status === 'active' || status === 'success' ? 'complete' : 'status',
                    status: status,
                    message: message,
                    progress: progress,
                    url: liveUrl,
                    deployTime: latestDeploy.created_on,
                    timestamp: new Date().toISOString()
                });

                if (isComplete) {
                    // Send final complete message
                    sendSSEUpdate(projectName, {
                        type: 'complete',
                        status: status,
                        message: status === 'active' || status === 'success' ? '✅ Site is live!' : '❌ Deployment failed',
                        progress: 100,
                        url: liveUrl,
                        timestamp: new Date().toISOString()
                    });
                    // Close all connections for this project
                    closeSSEConnections(projectName);
                }

            } else {
                // No deployments yet - project is being created
                const progress = Math.min(attempts * 5, 20);
                sendSSEUpdate(projectName, {
                    type: 'status',
                    status: 'initializing',
                    message: `⏳ Initializing project... (${progress}%)`,
                    progress: progress,
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('❌ SSE status check error:', error);
            // Send error but continue
            if (attempts % 3 === 0) {
                sendSSEUpdate(projectName, {
                    type: 'status',
                    status: 'checking',
                    message: '⏳ Checking deployment status...',
                    progress: Math.min(attempts * 10, 80),
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Timeout
        if (attempts >= maxAttempts && !isComplete) {
            sendSSEUpdate(projectName, {
                type: 'status',
                status: 'timeout',
                message: '⏳ Deployment taking longer than expected. Check Cloudflare dashboard.',
                progress: 95,
                timestamp: new Date().toISOString()
            });
            isComplete = true;
            clearInterval(checkInterval);
        }

    }, 5000); // Check every 5 seconds

    // Clean up on client disconnect
    req.on('close', () => {
        clearInterval(checkInterval);
        console.log(`📡 SSE stream closed for: ${projectName}`);
        // Remove connection from store
        if (sseConnections[projectName]) {
            sseConnections[projectName] = sseConnections[projectName].filter(conn => conn !== res);
            if (sseConnections[projectName].length === 0) {
                delete sseConnections[projectName];
            }
        }
    });
});

// ============================================================
// SSE Helper Functions
// ============================================================
function sendSSEUpdate(projectName, data) {
    const connections = sseConnections[projectName] || [];
    const message = `data: ${JSON.stringify(data)}\n\n`;
    
    connections.forEach(conn => {
        try {
            conn.write(message);
        } catch (error) {
            console.error('❌ SSE send error:', error);
        }
    });
}

function closeSSEConnections(projectName) {
    const connections = sseConnections[projectName] || [];
    connections.forEach(conn => {
        try {
            conn.end();
        } catch (error) {
            // Ignore
        }
    });
    delete sseConnections[projectName];
}

// ============================================================
// DEPLOYMENT STATUS - GET
// ============================================================
app.get('/api/deploy/:projectName/status', async (req, res) => {
    const { projectName } = req.params;
    console.log(`📥 GET /api/deploy/${projectName}/status`);

    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!accountId || !apiToken || DEMO_MODE) {
        return res.json({
            success: true,
            status: 'active',
            projectName: projectName,
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
                projectName: projectName,
                url: `${projectName}.pages.dev`,
                liveUrl: `https://${projectName}.pages.dev`
            });
        }

        const data = await response.json();
        const latestDeploy = data.result?.[0];

        return res.json({
            success: true,
            status: latestDeploy?.status || 'active',
            projectName: projectName,
            url: `${projectName}.pages.dev`,
            liveUrl: `https://${projectName}.pages.dev`,
            deployTime: latestDeploy?.created_on,
            isDemo: false
        });

    } catch (error) {
        console.error('❌ Status check error:', error);
        return res.json({
            success: true,
            status: 'active',
            projectName: projectName,
            url: `${projectName}.pages.dev`,
            liveUrl: `https://${projectName}.pages.dev`
        });
    }
});

// ============================================================
// DEPLOY - POST
// ============================================================
app.post('/api/deploy', async (req, res) => {
    console.log('📥 POST /api/deploy called');
    console.log('📦 Request body:', req.body);

    try {
        const { repo, branch, siteName } = req.body || {};

        if (!repo) {
            console.log('❌ No repository provided');
            return res.status(400).json({
                success: false,
                error: 'Repository URL is required',
                code: 'REPO_REQUIRED'
            });
        }

        // Clean up repo name
        let repoFull = repo;
        if (repoFull.startsWith('https://github.com/')) {
            repoFull = repoFull.replace('https://github.com/', '').replace(/\.git$/, '');
        }
        repoFull = repoFull.replace(/\/$/, '');

        console.log(`🔍 Checking repository: ${repoFull}`);

        // Check if repository is public
        try {
            const checkRes = await fetch(`https://api.github.com/repos/${repoFull}`, {
                headers: { 'User-Agent': 'DARK-DEV-HOSTING-Deploy' }
            });

            if (!checkRes.ok) {
                if (checkRes.status === 404) {
                    return res.status(404).json({
                        success: false,
                        error: 'Repository not found or is private. Only public repositories are supported.',
                        code: 'PUBLIC_REPO_REQUIRED'
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
            console.error('❌ GitHub check error:', githubError.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to check repository: ' + githubError.message,
                code: 'GITHUB_CHECK_FAILED'
            });
        }

        const projectName = siteName || `darkdev-${repoFull.split('/').pop()}`;
        const branchName = branch || 'main';

        console.log(`📁 Project name: ${projectName}`);
        console.log(`🌿 Branch: ${branchName}`);

        const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        const apiToken = process.env.CLOUDFLARE_API_TOKEN;

        if (!accountId || !apiToken) {
            console.error('❌ Cloudflare credentials not set!');
            return res.status(500).json({
                success: false,
                error: 'Cloudflare credentials not set. Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.',
                code: 'CREDENTIALS_MISSING'
            });
        }

        // DEMO MODE CHECK
        if (DEMO_MODE) {
            console.log('⚠️ DEMO MODE: Skipping real deployment');
            return res.json({
                success: true,
                message: '⚠️ Demo mode: Deployment simulated',
                siteName: projectName,
                url: `${projectName}.pages.dev`,
                liveUrl: `https://${projectName}.pages.dev`,
                isDemo: true,
                note: '⚠️ Set DEMO_MODE=false for real deployments.',
                repo: repoFull,
                branch: branchName
            });
        }

        // REAL DEPLOYMENT
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

        // If project doesn't exist, create it
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
                        repo: repoFull,
                        owner: repoFull.split('/')[0]
                    }
                })
            });

            if (!createRes.ok) {
                const errorData = await createRes.json();
                console.error('❌ Create project failed:', errorData);
                return res.status(500).json({
                    success: false,
                    error: `Failed to create Pages project: ${errorData.errors?.[0]?.message || 'Unknown error'}`,
                    code: 'PROJECT_CREATE_FAILED'
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
                error: deployData.errors?.[0]?.message || 'Deployment failed',
                code: 'DEPLOYMENT_FAILED'
            });
        }

        const liveUrl = `${projectName}.pages.dev`;
        console.log(`✅ Deployment started successfully!`);
        console.log(`🌐 Live URL: https://${liveUrl}`);

        // Send initial SSE update
        sendSSEUpdate(projectName, {
            type: 'status',
            status: 'deploying',
            message: '🚀 Deployment started!',
            progress: 0,
            timestamp: new Date().toISOString()
        });

        return res.json({
            success: true,
            message: '🚀 Deployment started successfully!',
            siteName: projectName,
            url: liveUrl,
            liveUrl: `https://${liveUrl}`,
            deploymentId: deployData.result?.id || 'pending',
            status: deployData.result?.status || 'building',
            isDemo: false,
            note: '⏳ Your site will be live in 1-3 minutes. Check status for real-time updates.',
            repo: repoFull,
            branch: branchName,
            cloudflareProject: projectName
        });

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
// CATCH ALL - SPA ROUTING
// ============================================================
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log('═'.repeat(50));
    console.log('✅ Server running successfully!');
    console.log(`📡 Port: ${PORT}`);
    console.log(`📝 Mode: ${DEMO_MODE ? 'DEMO' : 'PRODUCTION'}`);
    console.log(`🌐 API: http://localhost:${PORT}/api/deploy`);
    console.log(`📡 SSE: http://localhost:${PORT}/api/deploy/:projectName/stream`);
    console.log('═'.repeat(50));
    
    if (DEMO_MODE) {
        console.log('⚠️  WARNING: Running in DEMO mode!');
    } else {
        console.log('✅ Production mode - Real deployments enabled!');
    }
    console.log('═'.repeat(50));
});

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down gracefully...');
    // Close all SSE connections
    Object.keys(sseConnections).forEach(projectName => {
        closeSSEConnections(projectName);
    });
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down gracefully...');
    Object.keys(sseConnections).forEach(projectName => {
        closeSSEConnections(projectName);
    });
    process.exit(0);
});
