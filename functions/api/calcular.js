export async function onRequestPost(context) {
    const { request, env } = context;
         
    try {
        //  1. TRAVA DE SEGURANÇA: Exige o Token JWT
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
            return new Response(JSON.stringify({ sucesso: false, erro: "Acesso Negado: Token ausente." }), { status: 401 });
        }

        //  2. VERIFICAÇÃO NO SUPABASE: 
        const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
        const SUPABASE_KEY = env.SUPABASE_CHAVE;

        const authCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                'Authorization': authHeader,
                'apikey': SUPABASE_KEY
            }
        });

        if (!authCheck.ok) {
            return new Response(JSON.stringify({ sucesso: false, erro: "Acesso Negado: Token inválido ou expirado." }), { status: 401 });
        }

        // --- SE PASSOU PELO SEGURANÇA, CONTINUA O CÁLCULO NORMALMENTE ---
        const body = await request.json();
        const { itens, descontoBase, rt, versaoCatalogo } = body;
        
        // A chave única do cofre baseada na versão atual do catálogo
        const CACHE_KEY = `CUSTOS_VERSAO_${versaoCatalogo || '1'}`;

        // 1. O CLOUDFLARE TENTA ABRIR O COFRE LOCAL
        let catalogoCustos = await env.CLIMARIO_CUSTOS.get(CACHE_KEY, "json");

        // 2. O CLOUDFLARE ESTÁ VAZIO
        if (!catalogoCustos) {
            
            // Credenciais do Supabase
            const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
            const SUPABASE_KEY = env.SUPABASE_CHAVE;

            // Puxa o catálogo de custos INTEIRO do Supabase de uma vez só (Gasta 1 única requisição)
            const respostaSupabase = await fetch(`${SUPABASE_URL}/rest/v1/produtos?select=sku,markup_base,custos(custo,verba)`, {
                method: 'GET',
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`
                }
            });

            if (!respostaSupabase.ok) throw new Error("Falha ao puxar custos do Supabase.");

            //  A variável é criada AQUI primeiro, ANTES de ser verificada!
            const dadosBrutos = await respostaSupabase.json();

            //  TRAVA DE SEGURANÇA 1
            if (!Array.isArray(dadosBrutos) || dadosBrutos.length === 0) {
                throw new Error("Supabase retornou um catálogo vazio. Salvamento no cache abortado por segurança.");
            }

            // Transforma a lista do banco num "Dicionário" fácil e super rápido de pesquisar
            catalogoCustos = {};
            let contagemItensValidos = 0; // Inicializa o contador

            dadosBrutos.forEach(produto => {
                if (produto.sku) { // Garante que o item tem SKU antes de salvar
                    catalogoCustos[produto.sku] = {
                        custo: produto.custos?.custo || 0,
                        verba: produto.custos?.verba || 0,
                        markup_base: produto.markup_base
                    };
                    contagemItensValidos++; // ⬇️ Aumenta a contagem de itens seguros
                }
            });

            // 🚨 TRAVA DE SEGURANÇA 2: O dicionário falhou na montagem?
            if (contagemItensValidos === 0) {
                throw new Error("Nenhum SKU válido encontrado. Salvamento no cache abortado.");
            }

            // SALVA NA MEMÓRIA DA CLOUDFLARE PARA OS PRÓXIMOS!
            // Adicionamos um prazo de validade de 24 horas (86400 segundos) para limpar o lixo antigo automaticamente
            await env.CLIMARIO_CUSTOS.put(CACHE_KEY, JSON.stringify(catalogoCustos), { expirationTtl: 86400 });
        }

        // ==============================================================
        // 3. CALCULO PREÇO
        // ==============================================================
        let resultados = {};
        let custoTotalPedido = 0;
        let totalBrutoTabelaAVista = 0;
        let totalBrutoTabelaParcelado = 0;

        const MARKUP_BASE_FIXA = parseFloat(env.MARKUP_BASE_FIXA);
        const descDecimal = (parseFloat(descontoBase) || 0) / 100;
        const rtDecimal = (parseFloat(rt) || 0) / 100;
        const pagtoDecimal = 0.05

        const novoMarkupProtheus = (MARKUP_BASE_FIXA * ((1 - descDecimal) * (1 + (rtDecimal * 1.4)) * (1 + pagtoDecimal))) / 0.965;
        let descProtheusPedido = (((novoMarkupProtheus / 1.699) - 1) * -1) * 100;
        if (descProtheusPedido < 0) descProtheusPedido = 0;

        // Faz o loop calculando os SKUs que o vendedor pediu
        itens.forEach(itemPedido => {
            const dadosSecretos = catalogoCustos[itemPedido.sku];
            
            // Calcula o preço para todos os itens da tabela
            if (dadosSecretos) {
                const custo = parseFloat(dadosSecretos.custo || 0);
                const verba = parseFloat(dadosSecretos.verba || 0);
                const markupVenda = parseFloat(dadosSecretos.markup_base) || MARKUP_BASE_FIXA;
                const variacao = 1 - (MARKUP_BASE_FIXA / markupVenda);
                const divisor = 1 - variacao;

                const fatorComercialAVista = ((1 - descDecimal) * (1 + (rtDecimal * 1.4)));
                const fatorComercialParcelado = ((1 - descDecimal) * (1 + (rtDecimal * 1.4)) * (1 + pagtoDecimal));

                const novoMarkupAVista = (MARKUP_BASE_FIXA * fatorComercialAVista) / divisor;
                const novoMarkupParcelado = (MARKUP_BASE_FIXA * fatorComercialParcelado) / divisor;
                
                let precoAVista = Math.round((custo - verba) * novoMarkupAVista * 100) / 100;
                let precoParcelado = Math.round((custo - verba) * novoMarkupParcelado * 100) / 100;

                resultados[itemPedido.sku] = {
                    precoUnitarioAVista: precoAVista,
                    precoUnitarioParcelado: precoParcelado,
                    subtotalAVista: precoAVista * (itemPedido.qtd || 0),
                    subtotalParcelado: precoParcelado * (itemPedido.qtd || 0)
                };

                // MAS SÓ SOMA NO TOTAL DO ORÇAMENTO SE A QUANTIDADE FOR MAIOR QUE ZERO
               if (itemPedido.qtd > 0) {
                    custoTotalPedido += (itemPedido.qtd * (custo - verba));
                    totalBrutoTabelaAVista += (itemPedido.qtd * precoAVista);
                    totalBrutoTabelaParcelado += (itemPedido.qtd * precoParcelado);
                }
            }
        });

        // Devolve o preço final polido para o app.js exibir na tela
        return new Response(JSON.stringify({
            sucesso: true,
            precos: resultados,
            totalBrutoAVista: totalBrutoTabelaAVista,
            totalBrutoParcelado: totalBrutoTabelaParcelado,
            descontoProtheus: descProtheusPedido
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({ sucesso: false, erro: error.message }), { status: 500 });
    }
}