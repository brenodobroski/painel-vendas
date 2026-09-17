export async function onRequestGet(context) {
    const { request, env } = context;

    try {
        // 1. TRAVA DE SEGURANÇA: Exige o Crachá (Token JWT)
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ sucesso: false, erro: "Acesso Negado." }), { status: 401 });
        }

        // Pega a versão do catálogo que o app está pedindo na URL (ex: /api/produtos?v=1777...)
        const url = new URL(request.url);
        const versaoCatalogo = url.searchParams.get('v') || '1';
        
        // A chave única do cofre da vitrine
        const CACHE_KEY = `VITRINE_VERSAO_${versaoCatalogo}`;

        // 2. TENTA ABRIR O COFRE DA CLOUDFLARE
        let vitrineProdutos = await env.CLIMARIO_CUSTOS.get(CACHE_KEY, "json");

        // 3. O COFRE ESTÁ VAZIO? (Só o 1º vendedor do dia entra aqui)
        if (!vitrineProdutos) {
            const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
            const SUPABASE_KEY = env.SUPABASE_CHAVE;

            // Puxa TUDO do Supabase (Nomes, SKUs, Estoque, etc)
            const resposta = await fetch(`${SUPABASE_URL}/rest/v1/produtos?select=*`, {
                method: 'GET',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`
                }
            });

            if (!resposta.ok) throw new Error("Falha ao puxar catálogo do banco.");
            
            vitrineProdutos = await resposta.json();

            if (Array.isArray(vitrineProdutos) && vitrineProdutos.length > 0) {
                // TRANCA NO COFRE POR 24 HORAS!
                await env.CLIMARIO_CUSTOS.put(CACHE_KEY, JSON.stringify(vitrineProdutos), { expirationTtl: 86400 });
            }
        }

        // 4. DEVOLVE A VITRINE (Sem encostar no Supabase do 2º vendedor em diante!)
        return new Response(JSON.stringify({ sucesso: true, dados: vitrineProdutos }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ sucesso: false, erro: error.message }), { status: 500 });
    }
}