// functions/api/admin.js - Admin authentication
export async function onRequest(context) {
    const { request } = context;

    // Only allow POST requests
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const { password } = await request.json();
        const ADMIN_PASSWORD = 'dark1234#@$';

        if (!password) {
            return new Response(JSON.stringify({ error: 'Password required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (password === ADMIN_PASSWORD) {
            return new Response(JSON.stringify({
                success: true,
                message: 'Admin authenticated',
                role: 'admin'
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } else {
            return new Response(JSON.stringify({
                success: false,
                error: 'Invalid password'
            }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}