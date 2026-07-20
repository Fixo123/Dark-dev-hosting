// functions/api/deploy.js - Deploy GitHub repositories to Cloudflare Pages
export async function onRequest(context) {
    const { request, env } = context;

    // Only allow POST requests
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const body = await request.json();
        const { repo, branch, siteName, userId } = body;

        // Validate required fields
        if (!repo) {
            return new Response(JSON.stringify({ error: 'Repository name is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ============================================================
        // STEP 1: Validate environment variables
        // ============================================================
        if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
            console.error('Missing environment variables');
            return new Response(JSON.stringify({ 
                error: 'Server configuration error: Missing Cloudflare credentials' 
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ============================================================
        // STEP 2: Check if GitHub repository exists
        // ============================================================
        const githubToken = env.GITHUB_TOKEN;
        if (githubToken) {
            const githubCheck = await fetch(`https://api.github.com/repos/${repo}`, {
                headers: {
                    'Authorization': `token ${githubToken}`,
                    'User-Agent': 'DARK-DEV-OFC-Deploy'
                }
            });

            if (!githubCheck.ok) {
                return new Response(JSON.stringify({ 
                    error: 'GitHub repository not found or invalid. Make sure the repository exists and is public.'
                }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // ============================================================
        // STEP 3: Generate project name
        // ============================================================
        const projectName = siteName || `darkdev-${repo.split('/').pop()}`;
        const branchName = branch || 'main';

        // ============================================================
        // STEP 4: Deploy to Cloudflare Pages
        // ============================================================
        const deployUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${projectName}/deployments`;

        let deployResponse = await fetch(deployUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                branch: branchName
            })
        });

        let deployData = await deployResponse.json();

        // ============================================================
        // STEP 5: If project doesn't exist, create it
        // ============================================================
        if (!deployResponse.ok && deployData.errors && deployData.errors.some(e => e.code === 1000)) {
            console.log('Project does not exist, creating...');

            const createUrl = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects`;

            const createPayload = {
                name: projectName,
                production_branch: branchName,
                source: {
                    type: 'github',
                    repo: repo,
                    owner: repo.split('/')[0]
                }
            };

            // Add GitHub token if available
            if (githubToken) {
                createPayload.source.token = githubToken;
            }

            const createRes = await fetch(createUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(createPayload)
            });

            const createData = await createRes.json();

            if (!createRes.ok) {
                console.error('Create project error:', createData);
                return new Response(JSON.stringify({
                    error: 'Failed to create Pages project: ' + (createData.errors?.[0]?.message || 'Unknown error')
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Retry deployment after project creation
            deployResponse = await fetch(deployUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    branch: branchName
                })
            });

            deployData = await deployResponse.json();

            if (!deployResponse.ok) {
                return new Response(JSON.stringify({
                    error: 'Deployment failed after project creation: ' + (deployData.errors?.[0]?.message || 'Unknown error')
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // ============================================================
        // STEP 6: Check for other errors
        // ============================================================
        if (!deployResponse.ok) {
            return new Response(JSON.stringify({
                error: deployData.errors?.[0]?.message || 'Deployment failed'
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ============================================================
        // STEP 7: Save deployment to database (optional)
        // ============================================================
        if (env.DB && userId) {
            try {
                await env.DB.prepare(
                    `INSERT INTO deployments (user_id, project_name, repo, branch, status, url, created_at) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    userId,
                    projectName,
                    repo,
                    branchName,
                    'building',
                    `${projectName}.pages.dev`,
                    new Date().toISOString()
                ).run();
            } catch (dbError) {
                console.error('Database save error:', dbError);
                // Continue even if database fails
            }
        }

        // ============================================================
        // STEP 8: Return success response
        // ============================================================
        return new Response(JSON.stringify({
            success: true,
            message: 'Deployment started successfully',
            siteName: projectName,
            url: `${projectName}.pages.dev`,
            branch: branchName,
            deploymentId: deployData.result?.id || 'pending',
            status: 'building'
        }), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        console.error('Deploy error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Internal server error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
        }
