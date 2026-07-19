// functions/api/auth.js - Google OAuth Authentication
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
        const { idToken, accessToken } = body;

        let userData = null;

        // Method 1: Using ID Token (recommended)
        if (idToken) {
            // Verify the ID token with Google
            const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
            
            if (!verifyRes.ok) {
                return new Response(JSON.stringify({ error: 'Invalid ID token' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            userData = await verifyRes.json();
            
            // Validate the token
            if (!userData.email || !userData.name) {
                return new Response(JSON.stringify({ error: 'Invalid user data' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

        // Method 2: Using Access Token (fallback)
        } else if (accessToken) {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!userRes.ok) {
                return new Response(JSON.stringify({ error: 'Invalid access token' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            userData = await userRes.json();
        } else {
            return new Response(JSON.stringify({ error: 'No token provided' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // ============================================================
        // OPTIONAL: Save user to D1 Database
        // ============================================================
        if (env.DB) {
            try {
                // Check if user exists
                const existingUser = await env.DB.prepare(
                    "SELECT * FROM users WHERE email = ?"
                ).bind(userData.email).first();

                if (!existingUser) {
                    // Create new user
                    await env.DB.prepare(
                        `INSERT INTO users (id, name, email, avatar, created_at) 
                         VALUES (?, ?, ?, ?, ?)`
                    ).bind(
                        userData.sub || userData.id,
                        userData.name,
                        userData.email,
                        userData.picture || null,
                        new Date().toISOString()
                    ).run();
                } else {
                    // Update user info
                    await env.DB.prepare(
                        `UPDATE users SET name = ?, avatar = ?, updated_at = ? 
                         WHERE email = ?`
                    ).bind(
                        userData.name,
                        userData.picture || null,
                        new Date().toISOString(),
                        userData.email
                    ).run();
                }
            } catch (dbError) {
                console.error('Database error:', dbError);
                // Continue even if database fails
            }
        }

        // ============================================================
        // Return user data to frontend
        // ============================================================
        return new Response(JSON.stringify({
            success: true,
            user: {
                id: userData.sub || userData.id,
                name: userData.name,
                email: userData.email,
                avatar: userData.picture || null,
                provider: 'google'
            }
        }), {
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });

    } catch (error) {
        console.error('Auth error:', error);
        return new Response(JSON.stringify({
            success: false,
            error: error.message || 'Authentication failed'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}