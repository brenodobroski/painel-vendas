import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqa3pvbGh4dXVxbWt1enRkbGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjE1NTgsImV4cCI6MjA5Mjc5NzU1OH0.37ihEUrCAUHpzOymrPUTau164DXmvhhWal8uX4V0oI0'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

window.minhasSolicitacoes = []; 
window.filialVendedor = '1028'; 
window.roleUsuario = ''; // Variável global para armazenar se é Admin

// ==========================================
// RASTREADOR DE LOCALIZAÇÃO E LOGS (ORÇAMENTO)
// ==========================================
async function registrarLogAcessoOrcamento(userId, email) {
    if (sessionStorage.getItem('log_orcamento_enviado')) return;
    try {
        // A MÁGICA: Chamamos a NOSSA API em vez de um site de terceiros
        const response = await fetch('/api/geo');
        const loc = await response.json();

        await supabase.from('logs_acesso_orcamento').insert([{
            user_id: userId,
            email: email,
            ip: loc.ip || 'Desconhecido',
            cidade: loc.city || 'Desconhecida',
            estado: loc.region || 'Desconhecido'
        }]);
        sessionStorage.setItem('log_orcamento_enviado', 'true');
    } catch (erro) {
        console.error("Erro ao registrar log de localização:", erro);
    }
}

// Verifica se quem esta logando tem conta
async function verificarAcesso() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
        window.location.href = "login.html";
        return; 
    }

    try {
        const nomeUsuario = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
        document.getElementById('perfil-nome').innerText = nomeUsuario;
        document.getElementById('perfil-email').innerText = session.user.email;
        document.getElementById('perfil-iniciais').innerText = nomeUsuario.substring(0, 2).toUpperCase();

        const { data: perfil, error } = await supabase
            .from('usuarios')
            .select('role, filial, token_sessao, nome, RCA')
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error("Erro ao buscar permissões do usuário:", error);
            return;
        }

       // --- SISTEMA ANTI-COMPARTILHAMENTO DE CONTAS ---
        const tokenLocal = localStorage.getItem('climario_token_sessao') || '';
        const ancoraAtual = obterAncoraDispositivo();
        const chaveEsperada = `${ancoraAtual}|${tokenLocal}`;
        
        // Verifica se o Supabase tem uma chave que bate perfeitamente com a soma das duas metades do PC atual
        if (!tokenLocal || (perfil.token_sessao && perfil.token_sessao !== chaveEsperada)) {
            alert("⚠️ Acesso inválido ou conta conectada em outro dispositivo. Você foi desconectado por segurança.");
            await supabase.auth.signOut();
            localStorage.removeItem('climario_token_sessao'); 
            window.location.replace("login.html");
            return;
        }

        registrarLogAcessoOrcamento(session.user.id, session.user.email);
        
        // Salvamos as credenciais globais e tratamos espaços invisíveis
        window.filialVendedor = String(perfil?.filial || '1028').trim();
        window.roleUsuario = String(perfil?.role || '').trim();

        // Dados do vendedor para o "Meu Perfil" e validação do envio ao Protheus
        window.perfilVendedor = {
            id: session.user.id,
            nome: perfil?.nome || nomeUsuario,
            email: session.user.email,
            filial: (perfil?.filial !== null && perfil?.filial !== undefined) ? String(perfil.filial).trim() : '',
            rca: perfil?.RCA ? String(perfil.RCA).trim() : ''
        };


        // Adiciona o teste de hipotese para as filiais selecionadas e para o admin
        if (window.filialVendedor === '1028' || window.filialVendedor === '1015' || window.filialVendedor === '1043' || window.roleUsuario === 'admin') {
            const boxHipotese = document.getElementById('container-teste-hipotese');
            if (boxHipotese) boxHipotese.classList.remove('hidden');
        }

        carregarMinhasSolicitacoes(session.user.id);
        verificarAvisoGlobal();

    } catch (err) {
        console.error("Erro inesperado durante a verificação de acesso:", err);
    }
}
verificarAcesso();

let usandoPlanoB = false;
let ultimaVezQueDeuFoco = 0;

// PLANO B: Só entra em ação se o Realtime falhar (vendedor 201+)
async function checarAtualizacoesManualmente() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
        const [resEstoque, resCustos, resPerfil] = await Promise.all([
            supabase.from('configuracoes').select('valor').eq('chave', 'versao_estoque').single(),
            supabase.from('configuracoes').select('valor').eq('chave', 'versao_catalogo').single(),
            supabase.from('usuarios').select('token_sessao').eq('id', session.user.id).single()
        ]);

        // Valida Segurança
        const tokenLocal = localStorage.getItem('climario_token_sessao') || '';
        const ancoraAtual = obterAncoraDispositivo();
        if (resPerfil.data?.token_sessao && resPerfil.data.token_sessao !== `${ancoraAtual}|${tokenLocal}`) {
            alert("⚠️ Sessão encerrada: Login detectado em outro local.");
            await supabase.auth.signOut();
            window.location.replace("login.html");
            return;
        }

        // Valida Mudanças (A função carregarProdutosSupabase já faz o resto)
        carregarProdutosSupabase(); 

    } catch (err) { console.error("Erro no monitoramento manual:", err); }
}

// PLANO A: Tenta o Realtime (Até 200 conexões)
async function iniciarSistemaHibrido() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const canalGlobal = supabase.channel('fluxo-vendas')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'configuracoes', filter: 'chave=eq.versao_estoque' }, () => {
            console.log("⚡ Realtime: Estoque atualizado!");
            carregarProdutosSupabase(true);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'configuracoes', filter: 'chave=eq.versao_catalogo' }, () => {
            console.log("⚡ Realtime: Preços atualizados!");
            carregarProdutosSupabase(true);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'usuarios', filter: `id=eq.${session.user.id}` }, (payload) => {
            const tokenLocal = localStorage.getItem('climario_token_sessao') || '';
            const ancoraAtual = obterAncoraDispositivo();
            if (payload.new.token_sessao !== `${ancoraAtual}|${tokenLocal}`) {
                window.location.replace("login.html");
            }
        })

        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'solicitacoes_orcamento', filter: `vendedor_id=eq.${session.user.id}` }, (payload) => {
            const orcamentoAtualizado = payload.new;
            
            // 1. Procura na memória RAM se esse orçamento pertence à lista que está na tela
            const index = window.minhasSolicitacoes.findIndex(req => req.id === orcamentoAtualizado.id);
            
            if (index !== -1) {
                // 2. Atualiza apenas os campos que você alterou no Admin
                window.minhasSolicitacoes[index].status = orcamentoAtualizado.status;
                window.minhasSolicitacoes[index].motivo_reprovacao = orcamentoAtualizado.motivo_reprovacao;
                
                // 3. Re-desenha a tabela instantaneamente (Muda a cor visualmente)
                if (typeof renderizarMinhasSolicitacoes === 'function') {
                    renderizarMinhasSolicitacoes(window.minhasSolicitacoes);
                }
            }
        })

        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log("🟢 Conectado via Realtime.");
                
                // MÁGICA 1: A internet piscou e voltou? Desliga o Polling na hora!
                if (window.timerPollingVendedor) {
                    clearInterval(window.timerPollingVendedor);
                    window.timerPollingVendedor = null;
                    usandoPlanoB = false;
                }
                
            } else if (status === 'CHANNEL_ERROR') {
                if (!usandoPlanoB) {
                    usandoPlanoB = true;
                    console.warn("🟡 Limite atingido. Ativando Polling Inteligente.");
                    
                    window.timerPollingVendedor = setInterval(() => {
                        // MÁGICA 2: Só gasta banda se a pessoa estiver de fato olhando para a aba
                        if (document.visibilityState === 'visible') {
                            checarAtualizacoesManualmente();
                        } else {
                            console.log("💤 Aba oculta.");
                        }
                    }, 60000);

                    window.addEventListener('focus', () => {
                        if (Date.now() - ultimaVezQueDeuFoco > 30000) {
                            ultimaVezQueDeuFoco = Date.now();
                            checarAtualizacoesManualmente();
                        }
                    });
                }
            } else if (status === 'CLOSED' || status === 'TIMED_OUT') {
                console.log("💤 Realtime em pausa pelo navegador. Aguardando reconexão...");
            }
        });
}

// Inicia o motor assim que carregar
iniciarSistemaHibrido();

// Elementos
const caixaMarca = document.getElementById('marca-condensadora');
const containerTabela = document.getElementById('container-tabela');
const corpoTabela = document.getElementById('corpo-tabela');
const cardEvap = document.getElementById('card-evaporadoras');
const containerEvap = document.getElementById('container-tabela-evap');
const corpoEvap = document.getElementById("corpo-tabela-evap");
const avisoEvap = document.getElementById("aviso-evap");
const btnFinalizar = document.getElementById('btn-finalizar');
const totalExibicao = document.getElementById('resumo-total'); 
const listaResumo = document.getElementById('lista-itens-resumo'); 
const btnLogout = document.getElementById('btn-logout');

let produtos = [];
let primeiraCargaFeita = false;

async function carregarProdutosSupabase(forcarBaixar = false) {
    try {
        // 1. Puxa as duas versões do banco para saber o que mudou
        const [resEstoque, resCustos] = await Promise.all([
            supabase.from('configuracoes').select('valor').eq('chave', 'versao_estoque').single(),
            supabase.from('configuracoes').select('valor').eq('chave', 'versao_catalogo').single()
        ]);

        const vEstoqueNuvem = resEstoque.data?.valor || '1';
        const vCustosNuvem = resCustos.data?.valor || '1';
        
        // Criamos uma "Versão Combinada" para a Cloudflare saber que algo mudou (estoque ou preço)
        const vCombinada = `${vEstoqueNuvem}_${vCustosNuvem}`;

        const cache = localStorage.getItem('climario_catalogo_produtos');
        const vEstoqueLocal = localStorage.getItem('climario_versao_estoque');
        const vCustosLocal = localStorage.getItem('climario_versao_catalogo');

        // Se nada mudou e já temos cache, não gasta internet
        if (!forcarBaixar && cache && vEstoqueLocal === vEstoqueNuvem && vCustosLocal === vCustosNuvem) {
            produtos = JSON.parse(cache);
            console.log(`📦 Estoque e Preços carregados do Cache.`);
            
            // 🔥 SÓ ATUALIZA A TELA SE FOR A PRIMEIRA VEZ QUE ABRE O SISTEMA
            if (!primeiraCargaFeita) {
                primeiraCargaFeita = true;
                if (caixaMarca && caixaMarca.value) caixaMarca.dispatchEvent(new Event('change'));
            }
            return;
        }

        console.log("🔄 Atualização detectada. Baixando novos dados da Cloudflare...");

        const { data: { session } } = await supabase.auth.getSession();
        
        // Chamamos a Cloudflare enviando a versão combinada para quebrar o cache dela também
        const resposta = await fetch(`/api/produtos?v=${vCombinada}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${session.access_token}` }
        });

        const resJson = await resposta.json();
        if (!resJson.sucesso) throw new Error("Falha ao baixar catálogo.");

        produtos = resJson.dados;

        // Salva tudo localmente para a próxima vez
        localStorage.setItem('climario_catalogo_produtos', JSON.stringify(produtos));
        localStorage.setItem('climario_versao_estoque', vEstoqueNuvem);
        localStorage.setItem('climario_versao_catalogo', vCustosNuvem);

        primeiraCargaFeita = true;
        if (caixaMarca && caixaMarca.value) caixaMarca.dispatchEvent(new Event('change'));
        console.log("✅ Sistema atualizado com sucesso!");

        if (typeof window.checarEPreencherRefazer === 'function') {
            window.checarEPreencherRefazer();
        }

    } catch (error) {
        console.error("Erro ao carregar produtos:", error);
    }
}
carregarProdutosSupabase();

// ==========================================
// AGENDAMENTO DE TRÂNSITO
// ==========================================
let agendamentoMap = {};

async function carregarAgendamento() {
    try {
        const { data, error } = await supabase
            .from('agendamento_transito')
            .select('sku, quantidade, quinzena');

        if (error) throw error;

        agendamentoMap = {};
        (data || []).forEach(item => {
            agendamentoMap[String(item.sku).trim()] = {
                quantidade: item.quantidade,
                quinzena:   item.quinzena
            };
        });

        console.log(`🚚 ${Object.keys(agendamentoMap).length} SKUs em trânsito carregados.`);
    } catch (err) {
        console.error("Erro ao carregar agendamento:", err);
    }
}
carregarAgendamento();

// Retorna o HTML do badge de disponibilidade de um SKU
function badgeEstoque(sku, estoqueQtd) {
    const qtd = parseInt(estoqueQtd) || 0;
    if (qtd > 0) {
        return `<span class="inline-block text-green-700 text-[10px] font-medium whitespace-nowrap">● Pronta Entrega</span>`;
    }
    const agendado = agendamentoMap[String(sku).trim()];
    if (agendado) {
        return `<span class="inline-block text-amber-700 text-[10px] font-medium whitespace-nowrap">● ${agendado.quinzena}</span>`;
    }
    return `<span class="inline-block text-slate-400 text-[10px] italic whitespace-nowrap">A confirmar</span>`;
}

window.forcarAtualizacaoSistema = function() {
    localStorage.removeItem('climario_versao_catalogo');
    window.location.reload(); 
};

// ==========================================
// FAMILIAS E REGRAS
// ==========================================
let familiasConfig = {};
let _promiseFamilias = null;

async function carregarFamilias() {
    try {
        const { data, error } = await supabase
            .from('familias_sku')
            .select('nome, skus')
            .order('nome');

        if (error) throw error;

        familiasConfig = {};
        (data || []).forEach(f => {
            familiasConfig[f.nome] = (f.skus || []).map(String);
        });

        console.log(`✅ ${Object.keys(familiasConfig).length} famílias carregadas do banco.`);
    } catch (err) {
        console.error("Erro ao carregar famílias:", err);
    }
}

// Garante que famílias estejam prontas antes de renderizar a tabela
function garantirFamilias() {
    if (!_promiseFamilias) _promiseFamilias = carregarFamilias();
    return _promiseFamilias;
}
garantirFamilias(); // kick-off na inicialização

// Fallback hardcoded — usado enquanto o Supabase carrega ou se houver falha de rede
const _regrasAcessoriosFallback = {
    "41851": ["17105","14412"], "41797": ["17105","14412"], "41796": ["17105","14412"],
    "44610": ["14407","14412"], "29761": ["14407","14412"], "47977": ["14407","14412"],
    "44611": ["14407","14412"], "43406": ["14407","14412"], "29762": ["14407","14412"],
    "47978": ["16506","14412"], "42647": ["16506","14412"], "29763": ["16506","14412"],
    "43408": ["16506","14412"], "42328": ["16506","14412"], "18517": ["30405"],
    "17465": ["30405"],         "43244": ["42443"],
    "5844":  ["7443","5849"],   "5845":  ["7443","5849"],
    "5846":  ["7443","5849"],   "5847":  ["7443","5849"],
    "10178": ["10181"],         "10179": ["10181"],         "10180": ["10181"],
    "35850": ["35857"],         "35852": ["35858"],
    "34513": ["34499"],         "34514": ["34499"],
    "34496": ["34499"],         "34492": ["34499"],
    "10576": ["10579"],         "10577": ["10579"],         "10578": ["10579"]
};

// Começa populado com o fallback — nunca fica vazio durante a sessão
let regrasAcessorios = { ..._regrasAcessoriosFallback };
let _promiseRegras = null;

async function carregarRegrasAcessorios() {
    try {
        const { data, error } = await supabase
            .from('regras_acessorios')
            .select('sku_principal, skus_acessorios');

        if (error) throw error;

        if (data && data.length > 0) {
            regrasAcessorios = data.reduce((acc, r) => {
                acc[r.sku_principal] = (r.skus_acessorios || []).map(String);
                return acc;
            }, {});
            console.log(`✅ ${data.length} regras de acessórios carregadas do banco.`);
        } else {
            console.warn('⚠️ Tabela regras_acessorios vazia — usando fallback hardcoded.');
            regrasAcessorios = { ..._regrasAcessoriosFallback };
        }
    } catch (err) {
        console.error('Erro ao carregar regras de acessórios — usando fallback:', err);
        regrasAcessorios = { ..._regrasAcessoriosFallback };
    }
}

function garantirRegras() {
    if (!_promiseRegras) _promiseRegras = carregarRegrasAcessorios();
    return _promiseRegras;
}
garantirRegras(); // kick-off na inicialização

// Logout
if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = "login.html";
    });
}

// ==========================================
// CÁLCULO SEGURO VIA API E DEBOUNCE
// ==========================================
let timerCalculo = null;

async function buscarPrecosBaseTabela(skusParaBuscar) {
    if(!skusParaBuscar || skusParaBuscar.length === 0) return;
    
    const descontoBase = parseFloat(document.getElementById('input-desconto').value) || 0;
    const rt = parseFloat(document.getElementById('input-rt').value) || 0;
    const versaoAtual = localStorage.getItem('climario_versao_catalogo') || '1';

    const pseudoCarrinho = skusParaBuscar.map(sku => ({ sku: sku, qtd: 1 }));

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
        const resposta = await fetch('/api/calcular', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}` 
            },
            body: JSON.stringify({ 
                itens: pseudoCarrinho, 
                descontoBase, 
                rt, 
                versaoCatalogo: versaoAtual 
            })
        });
        
        const dados = await resposta.json();
        
        if (dados.sucesso) {
            skusParaBuscar.forEach(sku => {
                const inputElement = document.querySelector(`.qtd-input[data-sku="${sku}"]`);
                if (inputElement) {
                    const tr = inputElement.closest('tr');
                    const tdAvista = tr.querySelector('.preco-avista-col');
                    const tdParcelado = tr.querySelector('.preco-parcelado-col');
                    if (tdAvista && dados.precos[sku]) {
                        tdAvista.innerText = dados.precos[sku].precoUnitarioAVista.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    }
                    if (tdParcelado && dados.precos[sku]) {
                        tdParcelado.innerText = dados.precos[sku].precoUnitarioParcelado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    }
                }
            });
        }
    } catch (e) {
        console.error("Erro ao buscar preços base:", e);
    }
}

window.agendarCalculoAPI = function() {
    clearTimeout(timerCalculo);
    
    const totalExibicao = document.getElementById('resumo-total');
    if (totalExibicao) totalExibicao.classList.add('opacity-40', 'transition-opacity');
    
    timerCalculo = setTimeout(async () => {
        await executarCalculoSeguro();
    }, 250);
};

async function executarCalculoSeguro() {
    const descontoBase = parseFloat(document.getElementById('input-desconto').value) || 0;
    const rt = parseFloat(document.getElementById('input-rt').value) || 0;
    const versaoAtual = localStorage.getItem('climario_versao_catalogo') || '1';

    // limite de desconto
    const limiteAlcada = (window.filialVendedor === "1028" || window.roleUsuario === "admin") ? 21.99 : 18.00;
    
    const msgHipotese = document.getElementById('msg-hipotese');
    const textoDescontoVisual = document.getElementById('texto-input-desconto');
    
    // A checagem visual agora não depende mais da palavra 'Alvo'
    if (descontoBase <= limiteAlcada) {
        window.testeHipoteseAtivo = false;
        if(msgHipotese) {
            msgHipotese.classList.add('hidden');
            msgHipotese.classList.remove('text-red-600');
        }
        if(textoDescontoVisual) {
            textoDescontoVisual.style.color = ''; 
            textoDescontoVisual.style.fontWeight = '';
        }
    } else {
        window.testeHipoteseAtivo = true; 
        if(msgHipotese) {
            msgHipotese.innerText = `⚠️ Requer aprovação comercial.`;
            msgHipotese.classList.remove('hidden', 'text-green-600');
            msgHipotese.classList.add('text-red-600');
        }
        if(textoDescontoVisual) {
            textoDescontoVisual.style.color = '#dc2626';
            textoDescontoVisual.style.fontWeight = '900';
        }
    }

    const selectUf = document.getElementById('select-uf');
    const percentualFrete = selectUf ? parseFloat(selectUf.value) || 0 : 0;

    let percentualDescontoFinal = descontoBase - rt;
    if (percentualDescontoFinal < 0) percentualDescontoFinal = 0;
    
    const labelDescontoFinal = document.getElementById('label-desconto-final');
    if (labelDescontoFinal) labelDescontoFinal.innerText = `${percentualDescontoFinal.toFixed(2)}%`;

    let carrinho = [];
    let totalBtuCond = 0;
    let totalBtuEvap = 0;
    let itensMapeados = []; 

    const inputsAtualizados = document.querySelectorAll('.qtd-input');
    
    inputsAtualizados.forEach(input => {
        const quantidade = parseInt(input.value) || 0;
        const skuBuscado = input.getAttribute('data-sku');
        
        // MANDA TODOS OS ITENS PRA API, MESMO COM QTD 0
        carrinho.push({ sku: skuBuscado, qtd: quantidade });
        
        if (quantidade > 0) {
            const produtoData = produtos.find(p => String(p.sku || p.SKU).trim() === String(skuBuscado).trim());
            if (produtoData) {
                const tipoItem = String(produtoData.tipo || produtoData.TIPO || "ITEM").toUpperCase();
                const capacidadeBtu = parseInt(produtoData.capacidade || produtoData.CAPACIDADE) || 0;

                if (tipoItem.includes('CONDENSADORA')) totalBtuCond += (quantidade * capacidadeBtu);
                else if (tipoItem.includes('EVAPORADORA')) totalBtuEvap += (quantidade * capacidadeBtu);

                const estoqueItem = parseInt(produtoData.estoque || produtoData.ESTOQUE || 0);
                const agendadoItem = agendamentoMap[String(skuBuscado).trim()];
                let disponibilidadeItem;
                if (estoqueItem >= quantidade) disponibilidadeItem = { texto: 'Pronta Entrega', cor: 'green' };
                else if (agendadoItem) disponibilidadeItem = { texto: agendadoItem.quinzena, cor: 'amber' };
                else                   disponibilidadeItem = { texto: 'A Confirmar', cor: 'red' };

                itensMapeados.push({
                    codigo: skuBuscado,
                    descricao: produtoData.produto || produtoData.DESCRIÇÃO || "Item",
                    modelo: produtoData["codfab"] || produtoData["codigo fabricante"] || produtoData.MODELO || "-",
                    qtd: quantidade,
                    estoque: estoqueItem,
                    disponibilidade: disponibilidadeItem
                });
            }
        }
    });

    // Se nenhuma marca foi selecionada, cancela.
    if (carrinho.length === 0) {
        renderizarResumoVazio();
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        alert("Sua sessão expirou por inatividade. Faça login novamente.");
        window.location.reload();
        return;
    }

    try {
        const resposta = await fetch('/api/calcular', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}` 
            },
            body: JSON.stringify({
                itens: carrinho,
                descontoBase: descontoBase,
                rt: rt,
                versaoCatalogo: versaoAtual
            })
        });
        
        const dadosAPI = await resposta.json();
        
        if (!dadosAPI.sucesso) throw new Error(dadosAPI.erro || "Falha na API de Cálculo");

        // 1. ATUALIZA TODOS OS PREÇOS DA TABELA DE FORMA INSTANTÂNEA
       Object.keys(dadosAPI.precos).forEach(sku => {
            const infoPreco = dadosAPI.precos[sku];
            const inputQtd = document.querySelector(`.qtd-input[data-sku="${sku}"]`);
            if(inputQtd) {
                const tr = inputQtd.closest('tr');
                if(tr) {
                    const tdAvista = tr.querySelector('.preco-avista-col');
                    const tdParcelado = tr.querySelector('.preco-parcelado-col');
                    if(tdAvista) tdAvista.innerText = infoPreco.precoUnitarioAVista.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    if(tdParcelado) tdParcelado.innerText = infoPreco.precoUnitarioParcelado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                }
            }
        });

        // 2. SE NÃO TIVER NENHUM ITEM COM QUANTIDADE > 0, LIMPA O RESUMO E FINALIZA AQUI
        if (itensMapeados.length === 0) {
            renderizarResumoVazio();
            const totalExibicao = document.getElementById('resumo-total');
            if (totalExibicao) totalExibicao.classList.remove('opacity-40');
            return;
        }

        let itensHtml = "";
        let itensParaImpressao = [];

        itensMapeados.forEach(itemPub => {
            const infoPreco = dadosAPI.precos[itemPub.codigo];
            if (infoPreco) {
                itemPub.valorUnitarioAVista = infoPreco.precoUnitarioAVista;
                itemPub.subtotalAVista = infoPreco.subtotalAVista;
                itemPub.valorUnitarioParcelado = infoPreco.precoUnitarioParcelado;
                itemPub.subtotalParcelado = infoPreco.subtotalParcelado;
                itensParaImpressao.push(itemPub);
                
                const inputQtd = document.querySelector(`.qtd-input[data-sku="${itemPub.codigo}"]`);
                if(inputQtd) {
                    const tr = inputQtd.closest('tr');
                    if(tr) {
                        const tdPreco = tr.querySelector('.preco-col');
                        if(tdPreco) tdPreco.innerText = infoPreco.precoUnitario.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                    }
                }

               itensHtml += `
                    <div class="flex justify-between items-start bg-slate-50 p-2 rounded-sm border border-slate-100 mb-1">
                        <div class="flex flex-col flex-1 pr-2">
                            <div class="flex justify-between items-start gap-2 mb-1">
                                <span class="text-[12px] font-bold text-slate-900 leading-tight">${itemPub.descricao}</span>
                                <span class="text-[11px] font-bold text-slate-500 shrink-0">SKU: ${itemPub.codigo}</span>
                            </div>
                            <span class="text-[11px] text-slate-500">Qtd: ${itemPub.qtd}</span>
                        </div>
                    </div>`;
            }
        });

        const subtotalAVista = Math.round((dadosAPI.totalBrutoAVista || 0) * 100) / 100;
        const subtotalParcelado = Math.round((dadosAPI.totalBrutoParcelado || 0) * 100) / 100;

        const subtotalComDesconto = Math.round((dadosAPI.totalBruto || 0) * 100) / 100;

        // Frete calculado separadamente para cada modalidade
        let freteAVista    = Math.round(subtotalAVista    * (percentualFrete / 100) * 100) / 100;
        let freteParcelado = Math.round(subtotalParcelado * (percentualFrete / 100) * 100) / 100;

        let totalFinalAVista    = Math.round((subtotalAVista    + freteAVista)    * 100) / 100;
        let totalFinalParcelado = Math.round((subtotalParcelado + freteParcelado) * 100) / 100;

        // valorFrete exibido na tabela usa o parcelado (itens são exibidos em parcelado)
        let valorFrete = freteParcelado;

        if (window.testeHipoteseAtivo) {
            const inputEvidencia = document.getElementById('input-evidencia');
            const tipoAlvo = document.getElementById('tipo-alvo-hipotese')?.value;
            const valorEvidenciaBruto = parseFloat(inputEvidencia?.value);

            if (valorEvidenciaBruto > 0) {
                if (tipoAlvo === 'avista') {
                    const diff = Math.abs(totalFinalAVista - valorEvidenciaBruto);
                    if (diff > 0 && diff <= 5.00) {
                        totalFinalAVista = valorEvidenciaBruto;
                        totalFinalParcelado = Math.round((totalFinalAVista * 1.05) * 100) / 100;
                    }
                } else if (tipoAlvo === 'parcelado') {
                    const diff = Math.abs(totalFinalParcelado - valorEvidenciaBruto);
                    if (diff > 0 && diff <= 5.00) {
                        totalFinalParcelado = valorEvidenciaBruto;
                        totalFinalAVista = Math.round((totalFinalParcelado / 1.05) * 100) / 100;
                    }
                }
            }
        }

        let simultaneidade = totalBtuCond > 0 ? (totalBtuEvap / totalBtuCond) * 100 : 0;

        const textoUf = document.getElementById('texto-select-uf')?.innerText || 'SP';
        const dataHoje = new Date();
        const dataValidade = new Date(dataHoje);
        dataValidade.setDate(dataHoje.getDate() + 3);
        const marcaSelecionada = document.getElementById('marca-condensadora').value || "";
        const marcaBaseParaLogo = marcaSelecionada.split(' ')[0].toLowerCase();
        const nomeVendedorAtual = document.getElementById('perfil-nome').innerText || "Vendedor Climario";

        window.dadosParaOrcamento = {
            itens: itensParaImpressao,
            totalBrutoAVista: subtotalAVista,
            totalBrutoParcelado: subtotalParcelado,
            totalGeralAVista: totalFinalAVista,
            totalGeralParcelado: totalFinalParcelado,
            valorFrete: valorFrete,
            percentualFrete: percentualFrete,
            percentualDesconto: percentualDescontoFinal, 
            
            // 🚨 NOVO: Salvando os descontos exatos do Protheus vindos da API
            descontoProtheusAVista: dadosAPI.descontoProtheusAVista,
            descontoProtheusParcelado: dadosAPI.descontoProtheusParcelado,
            
            descontoBaseOriginal: descontoBase, 
            rt: rt, 
            ufDestino: textoUf,
            totalBtuCond: totalBtuCond,
            totalBtuEvap: totalBtuEvap,
            simultaneidade: simultaneidade,
            dataEmissao: dataHoje.toLocaleDateString('pt-BR'),
            dataValidade: dataValidade.toLocaleDateString('pt-BR'),
            vendedor: nomeVendedorAtual,
            marcaNome: marcaSelecionada,
            marcaLogo: marcaBaseParaLogo
        };

       const listaResumo = document.getElementById('lista-itens-resumo');
        if (listaResumo) listaResumo.innerHTML = itensHtml;
        
        const elFrete = document.getElementById('resumo-frete');
        if (elFrete) elFrete.innerText = '+ ' + valorFrete.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        
        const totalExibicao = document.getElementById('resumo-total-avista');
        if (totalExibicao) {
            totalExibicao.innerText = totalFinalAVista.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            const totalParceladoExib = document.getElementById('resumo-total-parcelado');
            if (totalParceladoExib) totalParceladoExib.innerText = totalFinalParcelado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            
            // Remove a opacidade com segurança
            if (totalExibicao.parentElement && totalExibicao.parentElement.parentElement) {
                totalExibicao.parentElement.parentElement.classList.remove('opacity-40');
            }
        }
        
        const btuCondExibicao = document.getElementById('resumo-btu-cond');
        const btuEvapExibicao = document.getElementById('resumo-btu-evap');
        const simultaneidadeExibicao = document.getElementById('resumo-simultaneidade');

        if (btuCondExibicao) btuCondExibicao.innerText = totalBtuCond.toLocaleString('pt-BR') + ' BTU';
        if (btuEvapExibicao) btuEvapExibicao.innerText = totalBtuEvap.toLocaleString('pt-BR') + ' BTU';
        
        if (simultaneidadeExibicao) {
            simultaneidadeExibicao.innerText = simultaneidade.toFixed(1).replace('.', ',') + '%';
            simultaneidadeExibicao.className = 'font-bold'; 
            if (simultaneidade === 0) simultaneidadeExibicao.classList.add('text-slate-600');
            else if (simultaneidade <= 150) simultaneidadeExibicao.classList.add('text-green-600'); 
            else simultaneidadeExibicao.classList.add('text-red-600'); 
        }

        if (btnFinalizar) {
            btnFinalizar.onclick = null; 
            if (window.testeHipoteseAtivo) {
                btnFinalizar.disabled = false;
                btnFinalizar.innerText = "Solicitar Aprovação";
                btnFinalizar.className = "w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-3 rounded-sm uppercase text-sm mt-4 transition-colors cursor-pointer";
                
                btnFinalizar.onclick = (e) => {
                    e.preventDefault();
                    abrirModalSolicitacao();
                };
            } else {
                btnFinalizar.disabled = false;
                btnFinalizar.innerText = "Gerar Orçamento";
                btnFinalizar.className = "w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-3 rounded-sm uppercase text-sm mt-4 transition-colors cursor-pointer";
                
                btnFinalizar.onclick = async () => {
                    const txtAnterior = btnFinalizar.innerText;
                    btnFinalizar.innerText = "Registrando... Aguarde";
                    btnFinalizar.disabled = true;
                    const sucesso = await enviarSolicitacaoSupabase('aprovado');
                    if (sucesso) {
                        sessionStorage.setItem('orcamentoDados', JSON.stringify(window.dadosParaOrcamento));
                        window.open('orcamento.html', '_blank');
                    }
                    btnFinalizar.innerText = txtAnterior;
                    btnFinalizar.disabled = false;
                };
            }
        }

    } catch (error) {
        console.error("Erro na API Segura:", error);
        const totalExibicao = document.getElementById('resumo-total-avista');
        if (totalExibicao) {
             totalExibicao.innerText = "Erro no Cálculo";
        }
    }
}

function renderizarResumoVazio() {
    document.getElementById('lista-itens-resumo').innerHTML = '<p class="text-xs text-slate-500 italic">Nenhum item selecionado.</p>';
    
    if(document.getElementById('resumo-subtotal-avista')) document.getElementById('resumo-subtotal-avista').innerText = 'R$ 0,00';
    if(document.getElementById('resumo-subtotal-parcelado')) document.getElementById('resumo-subtotal-parcelado').innerText = 'R$ 0,00 (10x)';
    if(document.getElementById('resumo-frete')) document.getElementById('resumo-frete').innerText = '+ R$ 0,00';
    if(document.getElementById('resumo-total-avista')) document.getElementById('resumo-total-avista').innerText = 'R$ 0,00';
    if(document.getElementById('resumo-total-parcelado')) document.getElementById('resumo-total-parcelado').innerText = 'R$ 0,00';
    
    const btnFinalizar = document.getElementById('btn-finalizar');
    if (btnFinalizar) {
        btnFinalizar.disabled = true;
        btnFinalizar.innerText = "Gerar Orçamento";
        btnFinalizar.className = "w-full bg-slate-300 text-slate-500 font-bold py-3 rounded uppercase text-sm mt-4 cursor-not-allowed";
    }
}

// ==========================================
// ORDENAÇÃO DE GRUPOS DA TABELA
// ==========================================
function chaveOrdemGrupo(grupo) {
    const nome = (grupo.isFamilia
        ? grupo.nome
        : (grupo.itens[0]?.produto || grupo.itens[0]?.DESCRIÇÃO || '')
    ).toUpperCase();

    // Extrai o primeiro número seguido de "K" como capacidade em BTU (ex: "18K" → 18)
    const btuMatch = nome.match(/(\d+)\s*K/);
    const btu = btuMatch ? parseInt(btuMatch[1]) : 0;

    // --- Condensadoras: prioridade por número de splits ---
    if (/COND/.test(nome)) {
        let splits = 1;
        if (/HEXA/.test(nome))         splits = 6;
        else if (/PENTA/.test(nome))   splits = 5;
        else if (/QUADRI/.test(nome))  splits = 4;
        else if (/TRI/.test(nome))     splits = 3;
        else if (/BI/.test(nome))      splits = 2;
        return splits * 10000 + btu;
    }

    // --- Evaporadoras e acessórios: prioridade por tipo de produto ---
    let tipoPrio;
    if      (/\bHW\b/.test(nome) && !/BLACK|ARTCOOL/.test(nome) && !/PLACA|INTERFACE/.test(nome))  tipoPrio = 1;  // HW normal
    else if (/BLACK|ARTCOOL/.test(nome))                                                           tipoPrio = 2;  // HW Black / Artcool
    else if (/K7.*\b1\b.*VIA|\b1\b.*VIA.*K7/.test(nome) && !/GRELHA/.test(nome))                  tipoPrio = 3;  // K7 1 via (evap)
    else if (/GRELHA.*K7.*\b1\b|K7.*\b1\b.*GRELHA/.test(nome))                                   tipoPrio = 4;  // Grelha K7 1 via
    else if (/K7.*4.*VIAS|4.*VIAS.*K7/.test(nome) && !/GRELHA/.test(nome))                       tipoPrio = 5;  // K7 4 vias (evap)
    else if (/GRELHA.*K7.*4|K7.*4.*GRELHA/.test(nome))                                           tipoPrio = 6;  // Grelha K7 4 vias
    else if (/BUILT.?IN/.test(nome))                                                               tipoPrio = 7;  // Built-in
    else if (/PISO/.test(nome))                                                                    tipoPrio = 8;  // Piso
    else if (/PAINEL|GALLERY/.test(nome))                                                          tipoPrio = 9;  // Painel/Gallery
    else if (/K7.*360/.test(nome))                                                                 tipoPrio = 10; // K7 360
    else if (/GRELHA/.test(nome))                                                                  tipoPrio = 11; // Grelhas genéricas
    else if (/CONTROLE|KIT.?WI|WIFI|PLACA|INTERFACE/.test(nome))                                  tipoPrio = 12; // Acessórios
    else                                                                                            tipoPrio = 13; // Resto

    // Itens sem família ficam no final do seu tipo
    const semFamilia = grupo.isFamilia ? 0 : 100000;
    return semFamilia + tipoPrio * 10000 + btu;
}

// ==========================================
// RENDERIZAÇÃO DA TABELA
// ==========================================
window.popularTabela = function(lista, corpo, container) {
    corpo.innerHTML = "";
    if (lista.length > 0) {
        container.classList.remove('hidden');
        const gruposParaRenderizar = [];
        const skusJaAgrupados = new Set();

        for (const [nomeFamilia, skusDaFamilia] of Object.entries(familiasConfig)) {
            const skusSeguros = skusDaFamilia.map(s => String(s).trim());
            const itensDestaFamilia = lista.filter(p => skusSeguros.includes(String(p.sku || p.SKU).trim()));
            
            if (itensDestaFamilia.length > 0) {
                itensDestaFamilia.sort((a, b) => skusSeguros.indexOf(String(a.sku || a.SKU).trim()) - skusSeguros.indexOf(String(b.sku || b.SKU).trim()));
                gruposParaRenderizar.push({ isFamilia: true, nome: nomeFamilia, itens: itensDestaFamilia });
                itensDestaFamilia.forEach(i => skusJaAgrupados.add(String(i.sku || i.SKU).trim()));
            }
        }

        lista.forEach(item => {
            const s = String(item.sku || item.SKU).trim();
            if (!skusJaAgrupados.has(s)) {
                gruposParaRenderizar.push({ isFamilia: false, itens: [item] });
            }
        });

        // Ordena grupos: condensadoras por n° de splits → BTU;
        // evaporadoras por tipo (HW → Black → K7 1V → grelha 1V → K7 4V → grelha 4V → outros) → BTU
        gruposParaRenderizar.sort((a, b) => chaveOrdemGrupo(a) - chaveOrdemGrupo(b));

        const skusParaAtualizarPreco = [];

        gruposParaRenderizar.forEach((grupo, index) => {
            const itemPrincipal = grupo.itens[0]; 
            const skuPrincipal = String(itemPrincipal.sku || itemPrincipal.SKU).trim();
            skusParaAtualizarPreco.push(skuPrincipal);

            const nomeExibicaoTabela = grupo.isFamilia ? grupo.nome.toUpperCase() : (itemPrincipal.produto || itemPrincipal.DESCRIÇÃO || "Item").toUpperCase();
            const idUnicoLinha = `${corpo.id}-linha-${index}`;
            let htmlSKU = "";
            
            if (grupo.isFamilia && grupo.itens.length > 1) {
                htmlSKU = `<select class="w-[80px] bg-white border border-blue-300 rounded-sm px-1 py-1 text-[11px] font-bold outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm text-blue-800 font-bold select-tabela-estiloso" 
                   onchange="atualizarLinhaDaTabela(this, '${idUnicoLinha}')">`;
                grupo.itens.forEach(item => {
                    const s = String(item.sku || item.SKU).trim();
                    htmlSKU += `<option value="${s}">${s}</option>`;
                });
                htmlSKU += `</select>`;
            } else {
                htmlSKU = `<span class="font-mono text-sm text-slate-900">${skuPrincipal}</span>`;
            }

            const linha = `
                <tr class="hover:bg-blue-50 transition-colors" id="${idUnicoLinha}">
                    <td class="border border-slate-200 px-2 py-2 text-center">
                        <input type="number" min="0" data-sku="${skuPrincipal}" 
                            onchange="atualizarResumo()" onkeyup="atualizarResumo()"
                            class="qtd-input w-12 text-center border border-slate-200 outline-none focus:border-blue-600">
                    </td>
                    <td class="border border-slate-200 px-1 py-1 text-center font-bold">
                        ${htmlSKU}
                    </td>
                    <td class="border border-slate-200 px-4 py-2 font-bold text-slate-900 desc-col text-md">
                        ${nomeExibicaoTabela}
                    </td>
                    <td class="border border-slate-200 px-4 py-2 text-center estoque-col text-sm font-bold">
                        ${itemPrincipal.estoque || itemPrincipal.ESTOQUE || 0}
                    </td>
                    <td class="border border-slate-200 px-3 py-2 text-center font-bold text-slate-900 preco-avista-col">
                        <i class="fas fa-spinner fa-spin text-slate-300 text-[10px]"></i>
                    </td>
                    <td class="border border-slate-200 px-3 py-2 text-center font-bold text-slate-600 preco-parcelado-col">
                        <i class="fas fa-spinner fa-spin text-slate-300 text-[10px]"></i>
                    </td>
                </tr>`;
            corpo.innerHTML += linha;
        });

        buscarPrecosBaseTabela(skusParaAtualizarPreco);

    } else {
        container.classList.add('hidden');
    }
};

window.atualizarResumo = function() {
    const inputsQtd = document.querySelectorAll('.qtd-input');
    const grelhasNecessarias = {};
    const todasAsGrelhasMapeadas = Object.values(regrasAcessorios).flat();

    inputsQtd.forEach(input => {
        const quantidade = parseInt(input.value) || 0;
        const linha = input.closest('.row-produto') || input.closest('tr');
        
        let skuAtual = input.getAttribute('data-sku');
        const seletorSku = linha ? linha.querySelector('select') : null;
        if (seletorSku && seletorSku.value) skuAtual = seletorSku.value;

        if (quantidade > 0 && regrasAcessorios[skuAtual]) {
            regrasAcessorios[skuAtual].forEach(skuAcessorio => {
                grelhasNecessarias[skuAcessorio] = (grelhasNecessarias[skuAcessorio] || 0) + quantidade;
            });
        }
    });

    inputsQtd.forEach(input => {
        const linha = input.closest('.row-produto') || input.closest('tr');
        let skuAtual = input.getAttribute('data-sku');
        const seletorSku = linha ? linha.querySelector('select') : null;
        if (seletorSku && seletorSku.value) skuAtual = seletorSku.value;

        if (todasAsGrelhasMapeadas.includes(skuAtual)) {
            input.value = grelhasNecessarias[skuAtual] || 0;
        }
    });

    agendarCalculoAPI();
};

window.atualizarLinhaDaTabela = function(selectElement, idLinha) {
    const skuSelecionado = selectElement.value;
    const linha = document.getElementById(idLinha);
    const produtoData = produtos.find(p => String(p.sku || p.SKU).trim() === String(skuSelecionado).trim());
    
    if (produtoData) {
        const inputQtd = linha.querySelector('.qtd-input');
        inputQtd.setAttribute('data-sku', skuSelecionado);
        linha.querySelector('.estoque-col').innerText = `${produtoData.estoque || produtoData.ESTOQUE || 0}`;
        linha.querySelector('.preco-col').innerHTML = '<i class="fas fa-spinner fa-spin text-slate-300 text-[10px]"></i>';
        
        buscarPrecosBaseTabela([skuSelecionado]); 
        agendarCalculoAPI(); 
    }
};

caixaMarca.addEventListener('change', async function(){
    let marcaEscolhida = caixaMarca.value.toUpperCase();
    corpoTabela.innerHTML = "";
    corpoEvap.innerHTML = "";

    // 🧹 PREVENÇÃO: Apaga o número do Teste de Hipótese ao trocar de marca
    const inputEvidencia = document.getElementById('input-evidencia');
    if (inputEvidencia) inputEvidencia.value = '';

    if(marcaEscolhida === ""){
        containerTabela.classList.add("hidden");
        containerEvap.classList.add("hidden");
        cardEvap.classList.add("hidden");
        if(avisoEvap) avisoEvap.classList.add("hidden");
        return;
    }

    // Garante que as famílias do banco estejam prontas antes de montar a tabela
    await garantirFamilias();

    cardEvap.classList.remove('opacity-50');
    cardEvap.classList.remove('hidden');

    const condensadoras = produtos.filter(function(produto){
        return produto.tipo === 'CONDENSADORA' && produto.marca.toUpperCase() === marcaEscolhida;
    });

    const evaporadoras = produtos.filter(function(produto){
        const tipo = String(produto.tipo || produto.TIPO || "").toUpperCase();
        return (tipo === 'EVAPORADORA' || tipo === 'GRELHA' || tipo === 'CONTROLE' || tipo === 'KIT WIFI' ) && produto.marca.toUpperCase() === marcaEscolhida;
    });

    popularTabela(condensadoras, corpoTabela, containerTabela);
    popularTabela(evaporadoras, corpoEvap, containerEvap);
});

window.addEventListener('load', () => {
    verificarAvisoGlobal(); // Dispara a busca do aviso
    if (typeof window.atualizarResumo === 'function') window.atualizarResumo();
});

document.addEventListener('wheel', function(event) {
    if (document.activeElement.type === 'number') document.activeElement.blur(); 
});

// ==========================================
// HIPÓTESE E ENVIO PARA O BANCO (SUPABASE)
// ==========================================
window.testeHipoteseAtivo = false; 

window.fazerTesteHipotese = function() {
    const inputEvidencia = document.getElementById('input-evidencia');
    const valorEvidencia = parseFloat(inputEvidencia.value);
    const tipoAlvo = document.getElementById('tipo-alvo-hipotese').value;

    if (!valorEvidencia || valorEvidencia <= 0) {
        alert("Insira um valor alvo válido para o teste.");
        return;
    }

    const totalAtual = window.dadosParaOrcamento ? 
        (tipoAlvo === 'avista' ? window.dadosParaOrcamento.totalGeralAVista : window.dadosParaOrcamento.totalGeralParcelado) 
        : 0;

    if (totalAtual === 0) {
        alert("Adicione itens ao orçamento primeiro.");
        return;
    }

    const descontoAtual = parseFloat(document.getElementById('input-desconto').value) || 0;
    
    if (descontoAtual >= 100) {
        alert("Remova o desconto de 100% antes de fazer o teste de hipótese.");
        return;
    }

    // Isola e calcula o novo desconto matematicamente
    const totalSemDesconto = totalAtual / (1 - (descontoAtual / 100));
    let novoDesconto = (1 - (valorEvidencia / totalSemDesconto)) * 100;
    if (novoDesconto < 0) novoDesconto = 0;

    let valorFormatado = novoDesconto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let valorMatematico = novoDesconto.toFixed(4); 

    // Alimenta o campo para o sistema consumir
    const inputDesconto = document.getElementById('input-desconto');
    inputDesconto.value = valorMatematico; 
    
    const textoDescontoVisual = document.getElementById('texto-input-desconto');
    if (textoDescontoVisual) {
        textoDescontoVisual.innerText = `${valorFormatado}%`;
    }

    // Repassa a bola para o executarCalculoSeguro (ele vai cuidar da cor vermelha ou verde)
    window.atualizarResumo(); 
};

window.abrirModalSolicitacao = function() {
    document.getElementById('modal-solicitacao').classList.remove('hidden');
};

window.fecharModalSolicitacao = function() {
    document.getElementById('modal-solicitacao').classList.add('hidden');
    document.getElementById('input-motivo-solicitacao').value = '';
    document.getElementById('input-arquivo-solicitacao').value = '';
    document.getElementById('nome-arquivo-selecionado').innerText = 'Clique para selecionar o arquivo';
};

window.mostrarNomeArquivo = function(input) {
    const nomeVisual = document.getElementById('nome-arquivo-selecionado');
    if (input.files && input.files.length > 0) {
        if (input.files.length === 1) {
            nomeVisual.innerText = input.files[0].name;
        } else {
            nomeVisual.innerText = `${input.files.length} arquivos selecionados`;
        }
        nomeVisual.classList.replace('text-slate-500', 'text-blue-700');
    } else {
        nomeVisual.innerText = 'Clique para anexar arquivo(s)';
        nomeVisual.classList.replace('text-blue-700', 'text-slate-500');
    }
};

// ==========================================
// ABA: MINHAS SOLICITAÇÕES
// ==========================================
// ==========================================
let limiteAtualMinhasSolicitacoes = 15;

async function carregarMinhasSolicitacoes(userId) {
    if(!userId) return;
    try {
        // 1. Monta a base da consulta (agora pedimos o vendedor_email também)
        let query = supabase
            .from('solicitacoes_orcamento')
            .select('id, codigo_orcamento, created_at, valor_alvo, desconto_solicitado, rt, status, motivo, motivo_reprovacao, itens')
            .eq('vendedor_id', userId)
            .order('created_at', { ascending: false })
            .limit(limiteAtualMinhasSolicitacoes);

        // 2. A MÁGICA DO GESTOR: Filtra por filial ou por vendedor
        if (window.roleUsuario === 'gestor') {
            query = query.eq('filial', window.filialVendedor);
        } else {
            query = query.eq('vendedor_id', userId);
        }

        const { data, error } = await query;
        if (error) throw error;
                 
        auditarDownload('Vendedor/Gestor: Histórico de Solicitações', data);
        window.minhasSolicitacoes = data || [];
                 
        renderizarMinhasSolicitacoes(window.minhasSolicitacoes);

        // Controla a exibição do botão "Carregar Mais"
        const btnMais = document.getElementById('btn-carregar-mais-solicitacoes');
        if (btnMais) {
            if (data.length < limiteAtualMinhasSolicitacoes) {
                btnMais.classList.add('hidden');
            } else {
                btnMais.classList.remove('hidden');
            }
        }
    } catch (error) {
        console.error("Erro ao buscar as solicitações:", error);
    }
}

// Nova função acionada pelo botão do HTML
window.carregarMaisMinhasSolicitacoes = async function() {
    const btn = document.getElementById('btn-carregar-mais-solicitacoes');
    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Carregando...';
        btn.disabled = true;
    }
    
    // Aumenta o limite em mais 15 e busca novamente
    limiteAtualMinhasSolicitacoes += 15;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        await carregarMinhasSolicitacoes(session.user.id);
    }
    
    if (btn) {
        btn.innerHTML = '<i class="fas fa-chevron-down"></i> Carregar Mais Antigos';
        btn.disabled = false;
    }
};

window.filtrarMinhasSolicitacoes = function() {
    const termo = document.getElementById('input-busca-orcamento').value.trim().toLowerCase();
    
    // Se apagou a busca, mostra tudo de novo
    if (termo === '') {
        renderizarMinhasSolicitacoes(window.minhasSolicitacoes);
        return;
    }
    
    // Filtra procurando quem tem o código que foi digitado
    const listaFiltrada = window.minhasSolicitacoes.filter(req => {
        const codigo = req.codigo_orcamento ? String(req.codigo_orcamento).toLowerCase() : '';
        return codigo.includes(termo);
    });
    
    // Redesenha a tabela só com os encontrados
    renderizarMinhasSolicitacoes(listaFiltrada);
};

function renderizarMinhasSolicitacoes(lista) {
    const corpo = document.getElementById('corpo-minhas-solicitacoes');
    if (!corpo) return;
    corpo.innerHTML = '';

    if (lista.length === 0) {
        corpo.innerHTML = `<p class="py-10 text-center text-slate-400 italic text-sm">Nenhuma solicitação encontrada.</p>`;
        return;
    }

    lista.forEach(req => {
        const dataFormatada = new Date(req.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        let infoGestor = '';
        if (window.roleUsuario === 'gestor') {
            const nomeVendedor = req.vendedor_email ? req.vendedor_email.split('@')[0] : 'Desconhecido';
            infoGestor = `<span class="text-[10px] text-slate-400 uppercase ml-2" title="${req.vendedor_email}">${nomeVendedor}</span>`;
        }

        let borderColor, statusHtml, botaoPrincipal, botaoProtheus = '';

        if (req.status === 'aprovado') {
            borderColor = 'border-l-green-600';
            statusHtml = `<span class="text-[11px] font-medium text-green-700 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span> Aprovado</span>`;
            botaoPrincipal = `<button onclick="abrirOrcamentoAprovado('${req.id}')" class="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded-sm text-xs font-medium transition-colors whitespace-nowrap"><i class="fas fa-file-pdf mr-1"></i> Ver PDF</button>`;
            botaoProtheus = `<button onclick="enviarParaProtheus('${req.id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-sm text-xs font-medium transition-colors whitespace-nowrap"><i class="fas fa-paper-plane mr-1"></i> Enviar para o Protheus</button>`;
        } else if (req.status === 'reprovado') {
            borderColor = 'border-l-red-500';
            statusHtml = `<span class="text-[11px] font-medium text-red-600 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-red-500 inline-block"></span> Reprovado</span>`;
            botaoPrincipal = `<button onclick="verMotivoReprovacao('${req.id}')" class="border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors whitespace-nowrap"><i class="fas fa-search mr-1"></i> Ver motivo</button>`;
        } else {
            borderColor = 'border-l-amber-400';
            statusHtml = `<span class="text-[11px] font-medium text-amber-600 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"></span> Pendente</span>`;
            botaoPrincipal = `<span class="text-xs text-slate-400 italic">Aguardando aprovação...</span>`;
        }

        const botaoRefazer = `<button onclick="prepararRefazerPedido('${req.id}')" class="border border-slate-200 text-slate-500 hover:bg-slate-50 px-3 py-1.5 rounded-sm text-xs font-medium transition-colors whitespace-nowrap"><i class="fas fa-redo mr-1"></i> Refazer</button>`;

        let qtdItens = 0;
        if (req.itens) req.itens.forEach(i => qtdItens += parseInt(i.qtd || 0));

        const codigoExibicao = req.codigo_orcamento ? `#${req.codigo_orcamento}` : '-';

        let valorAVista = req.snapshot?.totalGeralAVista || req.valor_alvo || 0;
        let valorParcelado = req.snapshot?.totalGeralParcelado || (valorAVista * 1.05);

        const strAVista = parseFloat(valorAVista).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const strParcelado = parseFloat(valorParcelado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const desconto = parseFloat(req.desconto_solicitado).toFixed(0);

        const card = document.createElement('div');
        card.className = `bg-white border border-slate-200 border-l-4 ${borderColor} rounded-sm p-4 flex flex-col gap-2.5 transition-colors hover:bg-slate-50`;

        card.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono font-medium text-sm text-slate-800">${codigoExibicao}</span>
                    <span class="text-xs text-slate-600">${dataFormatada}</span>
                    ${infoGestor}
                </div>
                ${statusHtml}
            </div>
            <div class="flex items-baseline gap-2 flex-wrap">
                <span class="text-base font-medium text-slate-900">${strAVista}</span>
                <span class="text-[10px] text-slate-400 uppercase tracking-wide">à vista</span>
                <span class="text-slate-300">·</span>
                <span class="text-sm text-slate-500">${strParcelado} em 10×</span>
                <span class="text-slate-300">·</span>
                <span class="text-[11px] text-slate-700 bg-slate-100 border border-slate-300 rounded-sm px-1.5 py-0.5 font-medium">${desconto}% desc</span>
            </div>
            <div class="flex justify-between items-center">
                <span class="text-xs text-slate-400">${qtdItens} ${qtdItens === 1 ? 'item' : 'itens'}</span>
                <div class="flex gap-2 flex-wrap justify-end">
                    ${botaoPrincipal}
                    ${botaoProtheus}
                    ${req.status !== 'pendente' ? botaoRefazer : ''}
                </div>
            </div>
        `;

        corpo.appendChild(card);
    });
}

window.verMotivoReprovacao = function(id) {
    const req = window.minhasSolicitacoes.find(s => s.id === id);
    if (!req) return;
    document.getElementById('texto-motivo-reprovacao').innerText = req.motivo_reprovacao || "Não foi fornecido um comentário adicional para esta reprovação.";
    document.getElementById('modal-motivo-reprovacao').classList.remove('hidden');
};

// ==========================================
// MEU PERFIL (dados do vendedor)
// ==========================================
window.abrirMeuPerfil = function(destacarRca = false) {
    const p = window.perfilVendedor;
    if (!p) {
        alert("Seus dados ainda estão carregando. Tente novamente em instantes.");
        return;
    }
    document.getElementById('perfil-input-nome').value   = p.nome || '';
    document.getElementById('perfil-texto-email').innerText  = p.email || '—';
    document.getElementById('perfil-texto-filial').innerText = p.filial || 'Não configurada';
    document.getElementById('perfil-input-rca').value    = p.rca || '';

    const aviso = document.getElementById('perfil-aviso-rca');
    if (aviso) aviso.classList.toggle('hidden', !destacarRca);

    document.getElementById('modal-perfil-vendedor').classList.remove('hidden');
};

window.fecharMeuPerfil = function() {
    document.getElementById('modal-perfil-vendedor').classList.add('hidden');
};

window.salvarMeuPerfil = async function() {
    const p = window.perfilVendedor;
    if (!p) return;

    const novoNome = document.getElementById('perfil-input-nome').value.trim();
    const novoRca  = document.getElementById('perfil-input-rca').value.trim();

    if (!novoNome) { alert("Informe o seu nome."); return; }

    const btn = document.getElementById('btn-salvar-perfil');
    const txtAnterior = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Salvando...";

    try {
        const { error } = await supabase
            .from('usuarios')
            .update({ nome: novoNome, RCA: novoRca })
            .eq('id', p.id);

        if (error) throw error;

        // Atualiza o estado em memória e a barra lateral
        window.perfilVendedor.nome = novoNome;
        window.perfilVendedor.rca = novoRca;
        const elNome = document.getElementById('perfil-nome');
        if (elNome) elNome.innerText = novoNome;

        fecharMeuPerfil();
        alert("✅ Perfil atualizado!");
    } catch (err) {
        console.error("Erro ao salvar perfil:", err);
        alert("Erro ao salvar: " + (err.message || err));
    } finally {
        btn.disabled = false;
        btn.innerText = txtAnterior;
    }
};

// ==========================================
// ENVIO PARA O PROTHEUS (fluxo de validação)
// ==========================================
let _protheusOrcamentoId = null;

window.enviarParaProtheus = function(id) {
    const p = window.perfilVendedor;
    if (!p) {
        alert("Seus dados ainda estão carregando. Tente novamente em instantes.");
        return;
    }

    // 1. RCA é obrigatório — sem ele, abre o perfil pedindo pra preencher
    if (!p.rca) {
        abrirMeuPerfil(true);
        return;
    }

    // 2. Filial é obrigatória e não é editável pelo vendedor
    if (!p.filial) {
        alert("Sua filial não está configurada. Contate o administrador antes de enviar ao Protheus.");
        return;
    }

    // 3. Perfil ok — monta o modal com os dados do pedido
    const req = window.minhasSolicitacoes.find(s => s.id === id);
    if (!req) {
        alert("Orçamento não encontrado. Recarregue a página e tente de novo.");
        return;
    }

    _protheusOrcamentoId = id;
    const fmt = (v) => (parseFloat(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Cabeçalho
    document.getElementById('pedido-codigo').innerText = req.codigo_orcamento ? `#${req.codigo_orcamento}` : '';

    // Itens + subtotal
    const itens = req.itens || [];
    let subtotal = 0;
    let linhasHtml = '';
    itens.forEach(item => {
        const unit = parseFloat(item.valorUnitarioAVista) || 0;
        const sub  = parseFloat(item.subtotalAVista) || (unit * (parseInt(item.qtd) || 0));
        subtotal += sub;
        linhasHtml += `<tr>
            <td class="px-3 py-2 text-slate-700">${item.descricao || item.codigo || 'Item'}</td>
            <td class="px-2 py-2 text-center text-slate-600">${item.qtd || 0}</td>
            <td class="px-3 py-2 text-right text-slate-600">${fmt(unit)}</td>
            <td class="px-3 py-2 text-right font-medium text-slate-800">${fmt(sub)}</td>
        </tr>`;
    });
    document.getElementById('pedido-itens-corpo').innerHTML = linhasHtml ||
        '<tr><td colspan="4" class="px-3 py-4 text-center text-slate-400 italic">Sem itens.</td></tr>';

    // Totais (valor_alvo = total à vista, já com frete)
    const total = parseFloat(req.valor_alvo) || subtotal;
    let frete = total - subtotal;
    if (frete < 0) frete = 0;
    document.getElementById('pedido-subtotal').innerText = fmt(subtotal);
    document.getElementById('pedido-frete').innerText = fmt(frete);
    document.getElementById('pedido-total').innerText = fmt(total);

    // RT — só aparece se o pedido tiver; sem RT, o pagamento ocupa a linha toda
    const temRt = (parseFloat(req.rt) || 0) > 0;
    document.getElementById('pedido-rt-wrapper').classList.toggle('hidden', !temRt);
    document.getElementById('pedido-pagamento-wrapper').classList.toggle('sm:col-span-2', !temRt);
    if (temRt) {
        document.getElementById('pedido-rt-valor').innerText =
            `(${parseFloat(req.rt).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%)`;
    }

    // Reset dos campos
    document.getElementById('pedido-input-pagamento').value = '';
    document.getElementById('pedido-select-rt').value = '';

    document.getElementById('modal-dados-pedido').classList.remove('hidden');
};

window.fecharModalDadosPedido = function() {
    document.getElementById('modal-dados-pedido').classList.add('hidden');
    _protheusOrcamentoId = null;
};

window.confirmarDadosPedido = function() {
    const pagamento = document.getElementById('pedido-input-pagamento').value.trim();
    if (!pagamento) { alert("Informe a forma de pagamento."); return; }

    // A forma de pagamento da RT só é exigida quando o pedido tem RT
    const rtVisivel = !document.getElementById('pedido-rt-wrapper').classList.contains('hidden');
    const rtPagamento = document.getElementById('pedido-select-rt').value;
    if (rtVisivel && !rtPagamento) { alert("Selecione a forma de pagamento da RT."); return; }

    // TODO (próxima etapa): enviar para /api/protheus-enviar com
    // { solicitacao_id: _protheusOrcamentoId, pagamento, rt_forma_pagamento: rtPagamento }
    fecharModalDadosPedido();
    alert("✅ Dados confirmados. A integração com o Protheus será conectada na próxima etapa.");
};

window.abrirOrcamentoAprovado = async function(id) {
    document.body.style.cursor = 'wait'; 
    try {
        const { data, error } = await supabase
            .from('solicitacoes_orcamento')
            .select('snapshot')
            .eq('id', id)
            .single();

        if (error || !data || !data.snapshot) {
            alert("Erro: O PDF deste orçamento não está mais disponível no banco.");
            return;
        }

        sessionStorage.setItem('orcamentoDados', JSON.stringify(data.snapshot));
        window.open('orcamento.html', '_blank');

        auditarDownload('Vendedor: Download Snapshot do PDF', data);
    } catch (err) {
        console.error(err);
        alert("Falha ao abrir PDF.");
    } finally {
        document.body.style.cursor = 'default';
    }
};

// ==========================================
// GERADOR DE CÓDIGO DE ORÇAMENTO INTELIGENTE
// ==========================================
function gerarNumeroOrcamento(rt, desconto, filial) {
    const rtFormatado = Math.floor(parseFloat(rt) || 0).toString();
    const descBase = Math.floor(parseFloat(desconto) || 0);
    const descFormatado = descBase.toString().padStart(2, '0');
    const filialFormatada = String(filial || '1028').trim();
    const numAleatorio = Math.floor(1000 + Math.random() * 9000).toString();

    return `${rtFormatado}${descFormatado}${filialFormatada}${numAleatorio}`;
}

window.enviarSolicitacaoSupabase = async function(statusDefinido = 'pendente') {
    const btnEnviar = document.getElementById('btn-enviar-solicitacao');
    const motivo = document.getElementById('input-motivo-solicitacao')?.value || '';
    const inputArquivo = document.getElementById('input-arquivo-solicitacao');
    
    const valorAlvo = window.dadosParaOrcamento.totalGeralAVista; 
         
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Sessão expirada. Faça login novamente.");

        // 2. Lógica de Upload Múltiplo (agora com a session já definida)
        let urlEvidencia = null;
        if (statusDefinido === 'pendente' && inputArquivo && inputArquivo.files.length > 0) {
            const urlsGeradas = [];
            
            for (let i = 0; i < inputArquivo.files.length; i++) {
                let file = inputArquivo.files[i];
                const fileExt = file.name.split('.').pop().toLowerCase();
                const fileName = `${Date.now()}_${i}_${session.user.id}.${fileExt}`;

                if (file.type.startsWith('image/')) {
                    const options = { maxSizeMB: 0.3, maxWidthOrHeight: 1280, useWebWorker: true };
                    try {
                        file = await imageCompression(file, options);
                    } catch (error) {
                        console.warn(`⚠️ Erro ao comprimir o arquivo ${i}. Enviando original.`, error);
                    }
                }

                const { error: uploadError } = await supabase.storage.from('evidencias').upload(fileName, file);
                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabase.storage.from('evidencias').getPublicUrl(fileName);
                urlsGeradas.push(publicUrlData.publicUrl);
            }
            
            // Junta todas as URLs separadas por vírgula para salvar no banco
            urlEvidencia = urlsGeradas.join(',');
        }

        // 3. Montagem do Orçamento e Envio para o Banco de Dados
        const rtAtual = document.getElementById('input-rt')?.value || 0;
        const descontoAtual = document.getElementById('input-desconto')?.value || 0;

        const numeroOrcamentoGerado = gerarNumeroOrcamento(rtAtual, descontoAtual, window.filialVendedor);

        window.dadosParaOrcamento.codigoOrcamento = numeroOrcamentoGerado;
        window.dadosParaOrcamento.filial = window.filialVendedor;

        const payload = {
            codigo_orcamento: numeroOrcamentoGerado, 
            vendedor_id: session.user.id,
            vendedor_email: session.user.email,
            filial: window.filialVendedor,
            valor_alvo: parseFloat(valorAlvo),
            desconto_solicitado: parseFloat(descontoAtual),
            rt: parseFloat(rtAtual),
            motivo: statusDefinido === 'aprovado' ? 'Aprovado Automaticamente pelo Sistema' : motivo,
            url_evidencia: urlEvidencia, 
            itens: window.dadosParaOrcamento.itens,
            total_bruto: window.dadosParaOrcamento.totalBrutoAVista, // Banco de dados guarda o bruto à vista
            status: statusDefinido,
            snapshot: window.dadosParaOrcamento,
            created_at: new Date().toISOString() // Hora perfeita
        };

        const { error: dbError } = await supabase.from('solicitacoes_orcamento').insert([payload]);
        if (dbError) throw dbError;

        if (statusDefinido === 'pendente') {
            alert(`⏳ Solicitação #${numeroOrcamentoGerado} enviada para análise!`);
            if(typeof fecharModalSolicitacao === 'function') fecharModalSolicitacao();
            if(typeof carregarMinhasSolicitacoes === 'function') carregarMinhasSolicitacoes(session.user.id);
            if(typeof mudarAba === 'function') mudarAba('solicitacoes');
        }
        
        return true; 

    } catch (error) {
        console.error("Erro no fluxo de envio:", error);
        alert("Erro ao processar: " + error.message);
        return false;
    } finally {
        if (statusDefinido === 'pendente' && btnEnviar) {
            btnEnviar.innerText = "Enviar para Aprovação";
            btnEnviar.disabled = false;
            btnEnviar.classList.replace('bg-slate-400', 'bg-blue-700');
        }
    }
};

function auditarDownload(nomeRequisicao, dataResult) {
    if (!dataResult) return;
    const bytes = new Blob([JSON.stringify(dataResult)]).size;
    let tamanho = bytes > 1024 * 1024 ? (bytes / (1024 * 1024)).toFixed(2) + ' MB 🚨 (ALERTA DE PESO)' : (bytes / 1024).toFixed(2) + ' KB 🟢';
    console.log(`📊 [API Supabase] ${nomeRequisicao}: Baixou ${tamanho}`);
}

function obterAncoraDispositivo() {
    // Usamos um nome que parece script de rastreamento do Google para despistar
    let anchor = localStorage.getItem('_ga_device_sync_');
    if (!anchor) {
        anchor = crypto.randomUUID();
        localStorage.setItem('_ga_device_sync_', anchor);
    }
    return anchor;
}


// ==========================================
// REFAZER PEDIDO INTELIGENTE
// ==========================================
window.prepararRefazerPedido = async function(idSolicitacao) {
    document.body.style.cursor = 'wait';
    try {
        // CORREÇÃO: Puxa o 'rt' diretamente do banco de dados também!
        const { data, error } = await supabase
            .from('solicitacoes_orcamento')
            .select('snapshot, valor_alvo, desconto_solicitado, rt')
            .eq('id', idSolicitacao)
            .single();

        if (error || !data || !data.snapshot) {
            alert("Dados originais do orçamento não encontrados.");
            return;
        }

        data.snapshot.valor_alvo_original = data.valor_alvo;
        data.snapshot.desconto_solicitado_original = data.desconto_solicitado;
        data.snapshot.rt_original = data.rt; // Injeta a RT do banco no snapshot

        sessionStorage.setItem('dadosParaRefazer', JSON.stringify(data.snapshot));

        if (typeof mudarAba === 'function') mudarAba('simulador');
        window.checarEPreencherRefazer();

    } catch (err) {
        console.error(err);
    } finally {
        document.body.style.cursor = 'default';
    }
};

window.checarEPreencherRefazer = function() {
    const rawData = sessionStorage.getItem('dadosParaRefazer');
    if (!rawData) return;

    const dados = JSON.parse(rawData);

    // Preenche Desconto
    let descontoBaseRestaurar = dados.desconto_solicitado_original;
    if (descontoBaseRestaurar === undefined) descontoBaseRestaurar = parseFloat(dados.percentualDesconto || 0) + parseFloat(dados.rt || 0);

    const inputDesconto = document.getElementById('input-desconto');
    const textoDesconto = document.getElementById('texto-input-desconto');
    if (inputDesconto) inputDesconto.value = parseFloat(descontoBaseRestaurar).toFixed(4);
    if (textoDesconto) textoDesconto.innerText = `${parseFloat(descontoBaseRestaurar).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

    // CORREÇÃO: Preenche a RT
    let rtRestaurar = dados.rt_original !== undefined ? dados.rt_original : dados.rt;
    if (rtRestaurar !== undefined) {
        const inputRt = document.getElementById('input-rt');
        const textoRt = document.getElementById('texto-input-rt');
        if (inputRt) inputRt.value = rtRestaurar;
        if (textoRt) textoRt.innerText = `${parseFloat(rtRestaurar).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}%`;
    }

    // Frete
    if (dados.percentualFrete !== undefined && dados.ufDestino) {
        const inputFrete = document.getElementById('select-uf');
        const textoFrete = document.getElementById('texto-select-uf');
        if (inputFrete) inputFrete.value = dados.percentualFrete;
        if (textoFrete) textoFrete.innerText = dados.ufDestino;
    }

    // Evidência
    const inputEvidencia = document.getElementById('input-evidencia');
    const tipoAlvo = document.getElementById('tipo-alvo-hipotese');
    if (inputEvidencia) inputEvidencia.value = dados.valor_alvo_original || dados.totalGeralAVista;
    if (tipoAlvo) tipoAlvo.value = 'avista';

    // Marca e Itens
    if (dados.marcaNome) {
        const inputMarca = document.getElementById('marca-condensadora');
        const textoMarca = document.getElementById('texto-marca-condensadora');
        if (inputMarca && textoMarca) {
            inputMarca.value = dados.marcaNome;
            textoMarca.innerText = dados.marcaNome;
            inputMarca.dispatchEvent(new Event('change'));

            setTimeout(() => {
                dados.itens.forEach(item => {
                    let input = document.querySelector(`.qtd-input[data-sku="${item.codigo}"]`);
                    if (!input) {
                        const selectFamilias = document.querySelectorAll('.select-tabela-estiloso');
                        selectFamilias.forEach(selectBox => {
                            const opcoes = Array.from(selectBox.options).map(opt => opt.value);
                            if (opcoes.includes(item.codigo)) {
                                selectBox.value = item.codigo;
                                window.atualizarLinhaDaTabela(selectBox, selectBox.closest('tr').id);
                                input = document.querySelector(`.qtd-input[data-sku="${item.codigo}"]`);
                            }
                        });
                    }
                    if (input) input.value = item.qtd;
                });
                sessionStorage.removeItem('dadosParaRefazer');
                window.atualizarResumo();
            }, 300);
        }
    }
};

// ==========================================
// ABA DE CATÁLOGOS (GOOGLE DRIVE)
// ==========================================
window.carregarCatalogosDoBanco = async function() {
    const container = document.getElementById('grid-catalogos');
    const loading = document.getElementById('loading-catalogos');
    
    container.innerHTML = '';
    loading.classList.remove('hidden');

    try {
        const { data: catalogos, error } = await supabase
            .from('catalogos_marcas')
            .select('*')
            .eq('ativo', true)
            .order('marca', { ascending: true }) 
            .order('titulo', { ascending: true });

        loading.classList.add('hidden');

        if (error) throw error;

        if (!catalogos || catalogos.length === 0) {
            container.innerHTML = `
                <div class="col-span-full flex flex-col justify-center items-center py-20 bg-white rounded-sm border border-slate-200">
                    <i class="fas fa-folder-open text-5xl text-slate-300 mb-4"></i>
                    <p class="text-slate-500 font-bold">Nenhum catálogo disponível no momento.</p>
                </div>`;
            return;
        }

        let html = '';
        
        catalogos.forEach(cat => {
            const nomeBaseMarca = cat.marca.split(' ')[0].toLowerCase();
            const caminhoLogo = `./img/${nomeBaseMarca}.png`;

            html += `
                <a href="${cat.url_pdf}" target="_blank" rel="noopener noreferrer" 
                   class="bg-white rounded-sm border border-slate-200 hover:border-blue-400 transition-all p-5 flex flex-col group h-full">
                    <div class="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
                        <img src="${caminhoLogo}" alt="${cat.marca}" onerror="this.src='./img/logo-site.jpg'" class="h-6 object-contain max-w-[100px]">
                        <i class="fas fa-external-link-alt text-slate-300 group-hover:text-blue-500 transition-colors"></i>
                    </div>
                    <div class="flex-1">
                        <span class="text-[10px] font-medium text-slate-400 uppercase tracking-wider">${cat.marca}</span>
                        <h3 class="font-bold text-slate-800 text-sm mt-1 leading-tight group-hover:text-blue-700 transition-colors">${cat.titulo}</h3>
                    </div>
                    <div class="mt-5 pt-3 flex items-center justify-between text-xs font-bold text-slate-500 group-hover:text-blue-600 transition-colors">
                        <div class="flex items-center">
                            <i class="fas fa-file-pdf text-red-400 mr-2 text-lg"></i>
                            <span>Visualizar PDF</span>
                        </div>
                        <i class="fas fa-arrow-right opacity-0 group-hover:opacity-100 transform -translate-x-2 group-hover:translate-x-0 transition-all"></i>
                    </div>
                </a>
            `;
        });

        container.innerHTML = html;

    } catch (err) {
        loading.classList.add('hidden');
        console.error("Erro ao carregar catálogos:", err);
        container.innerHTML = `<div class="col-span-full p-4 bg-red-50 text-red-700 rounded-sm text-center font-medium">Erro ao buscar catálogos. Tente novamente.</div>`;
    }
};

// ==========================================
// SISTEMA DE FILA DE AVISOS E SININHO
// ==========================================
window.avisosAtivosGlobais = [];
window.filaDeAvisos = [];
window.avisoAtual = null;

async function verificarAvisoGlobal() {
    try {
        const { data: avisos, error } = await supabase
            .from('avisos')
            .select('id, titulo, mensagem, url_imagem, versao')
            .eq('ativo', true)
            .order('created_at', { ascending: false });

        if (error || !avisos || avisos.length === 0) return;

        window.avisosAtivosGlobais = avisos;

        const btnSininho = document.getElementById('btn-reabrir-avisos');
        const badge = document.getElementById('badge-avisos');
        if (btnSininho) btnSininho.classList.remove('hidden');
        if (badge) {
            badge.innerText = avisos.length;
            badge.classList.remove('hidden');
        }

        const hoje = new Date().toLocaleDateString('pt-BR');
        window.filaDeAvisos = avisos.filter(aviso => {
            const dataOculta = localStorage.getItem(`climario_aviso_id_${aviso.id}_data`);
            return dataOculta !== hoje; 
        });

        if (window.filaDeAvisos.length > 0) {
            mostrarProximoAvisoDaFila();
        }
    } catch (err) {
        console.error("Erro ao processar avisos:", err);
    }
}

window.forcarExibicaoAvisos = function() {
    if (!window.avisosAtivosGlobais || window.avisosAtivosGlobais.length === 0) return;
    window.filaDeAvisos = [...window.avisosAtivosGlobais];
    mostrarProximoAvisoDaFila();
};

window.mostrarProximoAvisoDaFila = function() {
    if (window.filaDeAvisos.length === 0) {
        window.fecharModalVisualmente();
        return;
    }

    window.avisoAtual = window.filaDeAvisos.shift(); 
    
    const checkbox = document.getElementById('checkbox-nao-mostrar-hoje');
    if (checkbox) checkbox.checked = false;

    const content = document.getElementById('modal-aviso-content');
    content.classList.add('opacity-50', 'scale-95');
    
    setTimeout(() => {
        document.getElementById('aviso-titulo').innerText = window.avisoAtual.titulo || 'Aviso Importante';
        document.getElementById('aviso-mensagem').innerText = window.avisoAtual.mensagem || '';

        const btnAcao = document.getElementById('btn-acao-aviso');
        btnAcao.innerHTML = window.filaDeAvisos.length > 0 ? "Próximo Aviso &nbsp; ➔" : "Ciente, Fechar <i class='fas fa-check ml-2'></i>";

        const imagemEl = document.getElementById('aviso-imagem');
        const containerImagem = document.getElementById('aviso-imagem-container');
        const containerTexto = document.getElementById('aviso-texto-container');
        const btnDownload = document.getElementById('aviso-btn-download');

        if (window.avisoAtual.url_imagem && window.avisoAtual.url_imagem.trim() !== '' && window.avisoAtual.url_imagem !== 'null') {
            imagemEl.src = window.avisoAtual.url_imagem;
            if(btnDownload) btnDownload.onclick = () => window.forcarDownloadImagem(window.avisoAtual.url_imagem);
            
            containerImagem.classList.remove('hidden');
            containerTexto.className = "w-full flex-1 md:min-w-[400px] md:max-w-[450px] p-6 sm:p-8 bg-white overflow-y-auto custom-scrollbar flex flex-col justify-between";
        } else {
            containerImagem.classList.add('hidden');
            containerTexto.className = "w-full flex-1 md:max-w-2xl p-6 sm:p-8 bg-white overflow-y-auto custom-scrollbar flex flex-col justify-between";
        }

        content.classList.remove('opacity-50', 'scale-95');
    }, 150);

    const modal = document.getElementById('modal-aviso-global');
    if (modal.classList.contains('hidden')) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            content.classList.remove('scale-95', 'opacity-0');
            content.classList.add('scale-100', 'opacity-100');
        }, 50);
    }
};

window.processarFechamentoAviso = function() {
    const checkbox = document.getElementById('checkbox-nao-mostrar-hoje');
    if (checkbox && checkbox.checked && window.avisoAtual) {
        const hoje = new Date().toLocaleDateString('pt-BR');
        localStorage.setItem(`climario_aviso_id_${window.avisoAtual.id}_data`, hoje);
    }
    mostrarProximoAvisoDaFila();
};

window.fecharModalVisualmente = function() {
    const modal = document.getElementById('modal-aviso-global');
    const modalContent = document.getElementById('modal-aviso-content');
    if (modal && modalContent) {
        modalContent.classList.remove('scale-100', 'opacity-100');
        modalContent.classList.add('scale-95', 'opacity-0');
        setTimeout(() => { modal.classList.add('hidden'); }, 200);
    }
};

window.forcarDownloadImagem = async function(url) {
    const btn = document.getElementById('aviso-btn-download');
    const conteudoOriginal = btn.innerHTML;
    try {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Baixando...';
        btn.disabled = true;

        const resposta = await fetch(url);
        const blob = await resposta.blob();
        const urlObjeto = window.URL.createObjectURL(blob);
        
        const link = document.createElement('a');
        link.href = urlObjeto;
        link.download = `Aviso_Promocao_Climario_${new Date().getTime()}.jpg`; 
        document.body.appendChild(link);
        link.click();
        
        document.body.removeChild(link);
        window.URL.revokeObjectURL(urlObjeto);
    } catch (error) {
        window.open(url, '_blank');
    } finally {
        btn.innerHTML = conteudoOriginal;
        btn.disabled = false;
    }
};