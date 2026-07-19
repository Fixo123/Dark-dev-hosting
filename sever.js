// server.js
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Health check
app.get('/api/deploy', (req, res) => {
    res.json({ 
        success: true, 
        message: '✅ API is running!',
        mode: 'demo'
    });
});

// Deploy endpoint
app.post('/api/deploy', async (req, res) => {
    const { repo } = req.body;
    
    if (!repo) {
        return res.status(400).json({ 
            success: false, 
            error: 'Repository URL is required' 
        });
    }

    // Demo mode
    const projectName = repo.split('/').pop() || 'demo-site';
    res.json({
        success: true,
        message: '✅ Demo deployment successful!',
        siteName: projectName,
        liveUrl: `https://${projectName}.pages.dev`,
        isDemo: true
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
