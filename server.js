// server.js
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static('.'));

console.log('🔥 Starting DARK DEV HOSTING API...');

// Health check - GET
app.get('/api/deploy', (req, res) => {
    console.log('📥 GET /api/deploy');
    res.json({
        success: true,
        message: '✅ API is running!',
        mode: 'demo',
        timestamp: new Date().toISOString()
    });
});

// Deploy endpoint - POST
app.post('/api/deploy', async (req, res) => {
    console.log('📥 POST /api/deploy');
    
    try {
        const { repo, branch, siteName } = req.body || {};

        if (!repo) {
            return res.status(400).json({
                success: false,
                error: 'Repository URL is required'
            });
        }

        console.log(`🔍 Checking: ${repo}`);
        
        // Check if repo exists
        const checkRes = await fetch(`https://api.github.com/repos/${repo}`);
        if (!checkRes.ok) {
            return res.status(404).json({
                success: false,
                error: 'Repository not found or private. Only public repos supported.'
            });
        }

        const projectName = siteName || `darkdev-${repo.split('/').pop()}`;
        const liveUrl = `https://${projectName}.pages.dev`;

        console.log(`✅ Deploying: ${projectName}`);
        console.log(`🌐 Live: ${liveUrl}`);

        // Demo mode response
        res.json({
            success: true,
            message: '✅ Demo: Deployment simulated successfully!',
            siteName: projectName,
            liveUrl: liveUrl,
            url: projectName + '.pages.dev',
            isDemo: true,
            note: '⚠️ Running in demo mode.'
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// SPA routing - serve index.html
app.get('*', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 API: http://localhost:${PORT}/api/deploy`);
    console.log(`📝 Demo Mode: ON`);
});
