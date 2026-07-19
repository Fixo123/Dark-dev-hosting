// server.js - Render Web Service
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static('.')); // Serve static files

// Deploy API endpoint
app.post('/api/deploy', async (req, res) => {
    const { repo, branch, siteName } = req.body;
    
    // Validate
    if (!repo) {
        return res.status(400).json({ error: 'Repository required' });
    }

    try {
        // Check if public repo exists
        const check = await fetch(`https://api.github.com/repos/${repo}`);
        if (!check.ok) {
            return res.status(404).json({ 
                error: 'Repository not found or private. Only public repos supported.',
                code: 'PUBLIC_REPO_REQUIRED'
            });
        }

        // Deploy to Cloudflare Pages
        const projectName = siteName || `darkdev-${repo.split('/').pop()}`;
        const deployUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/deployments`;

        const deployResponse = await fetch(deployUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ branch: branch || 'main' })
        });

        const deployData = await deployResponse.json();

        if (!deployResponse.ok) {
            // Create project if not exists
            if (deployData.errors?.some(e => e.code === 1000)) {
                const createUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects`;
                await fetch(createUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        name: projectName,
                        production_branch: branch || 'main',
                        source: { type: 'github', repo: repo, owner: repo.split('/')[0] }
                    })
                });
                // Retry deployment
                const retry = await fetch(deployUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ branch: branch || 'main' })
                });
                const retryData = await retry.json();
                if (!retry.ok) throw new Error(retryData.errors?.[0]?.message);
            } else {
                throw new Error(deployData.errors?.[0]?.message || 'Deployment failed');
            }
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
