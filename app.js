import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqa3pvbGh4dXVxbWt1enRkbGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjE1NTgsImV4cCI6MjA5Mjc5NzU1OH0.37ihEUrCAUHpzOymrPUTau164DXmvhhWal8uX4V0oI0'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

window.minhasSolicitacoes = []; 
window.filialVendedor = '1028'; // Variável global para armazenar a filial do vendedor logado

// ==========================================
// RASTREADOR DE LOCALIZAÇÃO E LOGS (ORÇAMENTO)
// ==========================================
async function registrarLogAcessoOrcamento(userId, email) {
    // Usamos sessionStorage para gravar o log apenas UMA vez por aba aberta
    if (sessionStorage.getItem('log_orcamento_enviado')) return;

    try {
        // API Gratuita para pegar IP e Localização
        const response = await fetch('https://ipapi.co/json/');
        const loc = await response.json();

        // Salva na NOVA tabela exclusiva do orçamento
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

        // 1. Buscamos o perfil, a filial E O TOKEN DE SESSÃO DO BANCO
        const { data: perfil, error } = await supabase
            .from('usuarios')
            .select('role, filial, token_sessao') 
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error("Erro ao buscar permissões do usuário:", error);
            return;
        }

       // --- SISTEMA ANTI-COMPARTILHAMENTO DE CONTAS ---
        const tokenLocal = localStorage.getItem('climario_token_sessao'); // <-- Nome corrigido aqui
        
        // Se o token do banco for diferente do token da máquina, expulsa o usuário
        if (perfil.token_sessao && perfil.token_sessao !== tokenLocal) {
            alert("⚠️ Sua conta foi conectada em outro dispositivo. Você foi desconectado por segurança.");
            await supabase.auth.signOut();
            localStorage.removeItem('climario_token_sessao'); // <-- Nome corrigido aqui
            window.location.replace("login.html");
            return;
        }

        // Se passou na trava, dispara o Log de Localização silenciosamente
        registrarLogAcessoOrcamento(session.user.id, session.user.email);
        // ------------------------------------------------

        // Salva a filial globalmente para usar no número do orçamento
        window.filialVendedor = String(perfil?.filial || '1028');

        // REGRA 1: Teste de Hipótese (Apenas Filial 1028 ou Admin)
        if (window.filialVendedor === '1028' || perfil?.role === 'admin') {
            const boxHipotese = document.getElementById('container-teste-hipotese');
            if (boxHipotese) boxHipotese.classList.remove('hidden');
        }

        // REGRA 2: Carregar a lista de solicitações deste vendedor
        carregarMinhasSolicitacoes(session.user.id);

    } catch (err) {
        console.error("Erro inesperado durante a verificação de acesso:", err);
    }
}
verificarAcesso();

// ==========================================
// MONITOR DE SESSÃO EM TEMPO REAL (CÃO DE GUARDA)
// ==========================================
async function monitorarSessaoEmTempoReal() {
    const tokenLocal = localStorage.getItem('climario_token_sessao');
    if (!tokenLocal) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
        // Dispara duas checagens minúsculas ao mesmo tempo (Token e Versão do Catálogo)
        const promessaPerfil = supabase.from('usuarios').select('token_sessao').eq('id', session.user.id).single();
        const promessaConfig = supabase.from('configuracoes').select('valor').eq('chave', 'versao_catalogo').single();
        
        const [resPerfil, resConfig] = await Promise.all([promessaPerfil, promessaConfig]);

        // 1. Verifica Segurança (Token)
        if (resPerfil.data && resPerfil.data.token_sessao && resPerfil.data.token_sessao !== tokenLocal) {
            alert("⚠️ ATENÇÃO: Um novo login foi detectado em outro IP/Dispositivo. Esta aba foi desconectada por segurança.");
            await supabase.auth.signOut();
            localStorage.removeItem('climario_token_sessao');
            window.location.replace("login.html");
            return;
        }

        // 2. Verifica Atualização Global de Preços
        const versaoOficial = resConfig.data ? resConfig.data.valor : null;
        const versaoLocal = localStorage.getItem('climario_versao_catalogo');

        // Se o admin mudou os preços, nós acionamos o download automático!
        if (versaoOficial && versaoLocal && versaoOficial !== versaoLocal) {
            console.log("⚠️ Mudança global de preços detectada! Atualizando catálogo em background...");
            carregarProdutosSupabase(true); 
        }

    } catch (err) {
        // Ignora erros temporários de internet
    }
}

setInterval(monitorarSessaoEmTempoReal, 60000);
window.addEventListener('focus', monitorarSessaoEmTempoReal);

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

let produtos = []

async function carregarProdutosSupabase(forcarBaixar = false) {
    try {
        // 1. Pergunta ao banco qual a versão oficial agora (gasta apenas 50 bytes de dados)
        const { data: config } = await supabase.from('configuracoes').select('valor').eq('chave', 'versao_catalogo').single();
        const versaoOficial = config ? config.valor : '1';
        
        const cache = localStorage.getItem('climario_catalogo_produtos');
        const versaoLocal = localStorage.getItem('climario_versao_catalogo');

        // 2. Compara as versões. Se a versão local for igual a oficial, usa a memória instantânea!
        if (!forcarBaixar && cache && versaoLocal === versaoOficial) {
            produtos = JSON.parse(cache);
            console.log(`📦 Catálogo carregado da MEMÓRIA (Versão ${versaoLocal}).`);
            if (caixaMarca && caixaMarca.value) caixaMarca.dispatchEvent(new Event('change'));
            return;
        }

        // 3. Se a versão for diferente, baixa tudo do Supabase para atualizar
        console.log("☁️ Versão desatualizada. Baixando catálogo novo do Supabase...");
        const { data, error } = await supabase.from('produtos').select('*, custos(custo, verba)');
        if (error) throw error;
        
        produtos = data;
        
        // 4. Salva no celular com a nova versão carimbada
        localStorage.setItem('climario_catalogo_produtos', JSON.stringify(produtos));
        localStorage.setItem('climario_versao_catalogo', versaoOficial);
        
        if (caixaMarca && caixaMarca.value) caixaMarca.dispatchEvent(new Event('change'));

            auditarDownload('Vendedor: Download Novo Catálogo', data);


    } catch (error) {
        console.error("Erro ao carregar produtos:", error);
    }

}
carregarProdutosSupabase();

window.forcarAtualizacaoSistema = function() {
    localStorage.removeItem('climario_versao_catalogo');
    window.location.reload(); 
};

// ==========================================
// FAMILIAS E REGRAS (MANTIDO)
// ==========================================
const familiasConfig = {
    "COND BI SAMSUNG 18K": ["29753"],
    "COND TRI SAMSUNG 24K": ["29754"],
    "COND QUADRI SAMSUNG 28K": ["29755"],
    "COND PENTA SAMSUNG 34K": ["42326", "29764"], 
    "COND PENTA SAMSUNG 48K": ["42325", "29765"],
    "EVAP HW SAMSUNG 7K": ["33872", "29756"], 
    "EVAP HW  SAMSUNG 9K": ["34076", "29752"], 
    "EVAP HW SAMSUNG 12K": ["33806", "34445"], 
    "EVAP HW SAMSUNG 18K": ["34078"],
    "EVAP HW SAMSUNG 24K": ["34077", "29760"], 
    "EVAP HW SAMSUNG BLACK 9K": ["44612"],
    "EVAP HW SAMSUNG BLACK 12K": ["44613"],
    "EVAP HW SAMSUNG BLACK 18K": ["44614"],
    "EVAP HW SAMSUNG BLACK 24K": ["44615"],
    "EVAP K7 4 VIAS SAMSUNG  9K": ["41851"],
    "EVAP K7 4 VIAS SAMSUNG 12K": ["41797"],
    "EVAP K7 4 VIAS SAMSUNG 18K": ["41796"],
    "GRELHA K7 4 VIAS SAMSUNG": ["17105"],
    "EVAP K7 1 VIA SAMSUNG 9K": ["44610", "29761", "47977"],
    "EVAP K7 1 VIA SAMSUNG 12K": ["43406","44611", "29762"],
    "EVAP K7 1 VIA SAMSUNG 18K": ["47978", "29763", "42647"],
    "EVAP K7 1 VIA SAMSUNG 24K": ["43408", "42328"],
    "SAMSUNG GRELHA K7 1 VIA 9 A 12K": ["14407"], 
    "SAMSUNG GRELHA K7 1 VIA 18 A 24K": ["16506"],
    "SAMSUNG CONTROLE SEM FIO": ["14412"],
    "SAMSUNG KIT WI-FI": ["21843"],
    "SAMSUNG PLACA DE INTERFACE HW": ["29767"],

    // LG
    "COND BI LG 18K": ["43180", "29973", "15468"],
    "COND BI LG 21K FRIO": ["48758"],
    "COND TRI LG 21K": ["43182", "30310"],
    "COND TRI LG 24K": ["43632", "24415"],
    "COND TRI LG 24K FRIO": ["48761"],
    "COND QUADRI LG 30K": ["43631", "15467"],
    "COND QUADRI LG 30K FRIO": ["48762"],
    "COND QUADRI LG 36K FRIO": ["48764"],
    "COND PENTA LG 36K": ["43679", "15472"],
    "COND PENTA LG 48K": ["43680", "23774"],
    "COND PENTA LG 48K FRIO": ["48765"],
    "COND PENTA LG 54K FRIO": ["48763"],
    "EVAP HW LG 7K": ["43638", "32215"],
    "EVAP HW LG 9K": ["43224", "15466"],
    "EVAP HW LG 12K": ["43681", "32246"],
    "EVAP HW LG 18K": ["43226", "32260"],
    "EVAP HW LG 24K": ["43227", "32267"],
    "EVAP HW ARTCOOL LG 7K": ["32251"],
    "EVAP HW ARTCOOL LG 9K": ["32214"],
    "EVAP HW ARTCOOL LG 12K": ["32208"],
    "EVAP HW ARTCOOL LG 18K": ["34399"],
    "EVAP HW ARTCOOL LG 24K": ["35667"],
    "EVAP PAINEL GALLERY LG  9K": ["20789"],
    "EVAP PAINEL GALLERY LG  12K": ["20788"],
    "EVAP K7 4 VIAS LG  9K": ["18517"],
    "EVAP K7 4 VIAS LG  12K": ["17465"],
    "EVAP K7 4 VIAS LG 18K": ["49980"],
    "EVAP K7 4 VIAS LG 24K": ["49981", "43244"],
    "GRELHA K7 4 VIAS LG 9 A 12K": ["30405"],
    "GRELHA K7 4 VIAS LG 18 A 24K": ["42443"],
    "EVAP K7 1 VIA LG 7K": ["48445"],
    "EVAP K7 1 VIA LG 9K": ["17591"],
    "EVAP K7 1 VIA LG 12K": ["17590"],
    "EVAP K7 1 VIA LG 18K": ["23773"],
    "EVAP K7 1 VIA LG 24K": ["30327"],

    // LG BI
    "LG BI 16K FRIO": ["33175"],
    "LG HW 9K FRIO": ["33176"],
    "LG HW 12K FRIO": ["33177"],

    // DAIKIN
    "COND BI DAIKIN 18K": ["24540"],
    "COND TRI DAIKIN 18K": ["26426"],
    "COND TRI DAIKIN 24K": ["24542"],
    "COND QUADRI DAIKIN 28K": ["24544"],
    "COND QUADRI DAIKIN 34K": ["24546"],
    "COND PENTA DAIKIN 38K": ["5836"],
    "EVAP HW DAIKIN 9K": ["30312"],
    "EVAP HW DAIKIN 12K": ["26429"],
    "EVAP HW DAIKIN 18K": ["23647"],
    "EVAP HW DAIKIN 20K": ["33390"],
    "EVAP HW DAIKIN 24K": ["27177"],
    "EVAP K7 4 VIAS DAIKIN 9K": ["5844"],
    "EVAP K7 4 VIAS DAIKIN 12K": ["5845"],
    "EVAP K7 4 VIAS DAIKIN 17K": ["5846"],
    "EVAP K7 4 VIAS DAIKIN 20K": ["5847"],
    "GRELHA K7 4 VIA DAIKIN ": ["7443"],
    "EVAP K7 1 VIA DAIKIN 9K": ["10178"],
    "EVAP K7 1 VIA DAIKIN 12K": ["10179"],
    "EVAP K7 1 VIA DAIKIN 18K": ["10180"],
    "GRELHA K7 1 VIA DAIKIN ": ["10181"],
    "EVAP BUILT IN DAIKIN 9K": ["5840"],
    "EVAP BUILT IN DAIKIN 12K": ["5841"],
    "EVAP BUILT IN DAIKIN 18K": ["5842"],
    "EVAPBUILT IN DAIKIN 21K": ["5843"],
    "DAIKIN CONTROLE SEM FIO": ["5849"],

    // DAIKIN BI - R32
    "COND BI DAIKIN  18K R32": ["30456"],
    "EVAP HW DAIKIN 9K R32 - BI": ["30457"],
    "EVAP HW DAIKIN 12K R32 - BI": ["30458"],

    // DAIKIN TRI - R32
    "COND TRI DAIKIN 18K R32 FRIO": ["33087"],
    "EVAP HW DAIKIN 9K R32 - TRI": ["33085"],
    "EVAP HW DAIKIN 12K R32 - TRI": ["33086"],

    // MIDEA
    "COND BI MIDEA 18K": ["35269"],
    "COND TRI MIDEA 27K": ["33117"],
    "COND QUADRI MIDEA 36K": ["33118"],
    "COND PENTA MIDEA 42K": ["32510"],
    "EVAP HW MIDEA 9K": ["48165", "33250"],
    "EVAP HW MIDEA 12K": ["33251", "48171"],
    "EVAP HW  MIDEA 18K": ["48721", "35699"],
    "EVAP HW MIDEA 24K": ["35700", "48173"],
    "EVAP HW MIDEA BLACK 9K": ["33988"],
    "EVAP HW MIDEA BLACK 12K": ["33984"],
    "EVAP HW MIDEA BLACK 18K": ["33985"],
    "EVAP HW MIDEA BLACK 24K": ["33986"],
    "EVAP K7 1 VIA MIDEA 12K": ["35850"],
    "EVAP K7 1 VIA MIDEA 18K": ["35852"],
    "GRELHA K7 1 VIA MIDEA 12K": ["35857"],
    "GRELHA K7 1 VIA MIDEA 18K": ["35858"],
    "EVAP BUILT IN MIDEA 9K": ["22093"],
    "EVAP BUILT IN MIDEA 12K": ["22094"],

    // ELGIN
    "COND BI ELGIN 18K": ["41232"],
    "COND TRI ELGIN 27K": ["41235"],
    "EVAP HW ELGIN 9K": ["41230"],
    "EVAP HW ELGIN 12K": ["41231"],
    "EVAP HW ELGIN 18K": ["48623"],

    // GREE
    "COND BI GREE 18K": ["34545"],
    "COND TRI GREE 24K": ["34515"],
    "COND TRI GREE 30K": ["34501"],
    "COND QUADRI GREE 36K": ["34502"],
    "COND PENTA GREE 42K": ["34518"],
    "COND PENTA GREE 48K": ["34519"],
    "EVAP HW GREE 9K": ["34541"],
    "EVAP HW GREE 12K": ["34543"],
    "EVAP HW GREE 18K": ["34540"],
    "EVAP HW GREE 24K": ["34544"],
    "EVAP HW GREE DIAMOND 9K": ["41426"],
    "EVAP HW GREE DIAMOND 12K": ["41423"],
    "EVAP HW GREE DIAMOND 18K": ["41424"],
    "EVAP HW GREE DIAMOND 24K": ["41421"],
    "EVAP K7 1 VIA GREE 9K": ["34513"],
    "EVAP K7 1 VIA GREE 12K": ["34514"],
    "EVAP K7 1 VIA GREE 18K": ["34496"],
    "EVAP K7 1 VIA GREE 24K": ["34492"],
    "GRELHA K7 1 VIA GREE": ["34499"],

    //FUJITSU
    "COND BI FUJITSU 18K": ["10548"],
    "COND TRI FUJITSU 18K": ["10549"],
    "COND TRI FUJITSU 24K": ["10555"],
    "COND QUADRI FUJITSU 30K": ["10556"],
    "COND QUADRI FUJITSU 36K": ["10557"],
    "COND HEXA FUJITSU 45K": ["10561"],
    "EVAP HW FUJITSU 7K": ["10581"],
    "EVAP HW FUJITSU 9K": ["10567"],
    "EVAP HW FUJITSU 12K": ["10571"],
    "EVAP HW FUJITSU 18K": ["10582"],
    "EVAP HW FUJITSU 24K": ["10562"],
    "EVAP PISO FUJITSU 12K": ["7034"],
    "EVAP K7 4 VIAS FUJITSU 9K": ["10576"],
    "EVAP K7 4 VIAS FUJITSU 12K": ["10577"],
    "EVAP K7 4 VIAS FUJITSU 18K": ["10578"],
    "GRELHA K7 4 VIAS FUJITSU": ["10579"],
    "EVAP BUILT IN FUJITSU 12K": ["10564"],
    "EVAP BUILT IN FUJITSU 18K": ["10565"]
};

const regrasAcessorios = {
    "41851": ["17105" , "14412"],
    "41797": ["17105" , "14412"], "41796": ["17105" , "14412"], 
    "44610": ["14407" , "14412"], "29761": ["14407" , "14412"], "47977": ["14407" , "14412"], 
    "44611": ["14407" , "14412"], "43406": ["14407" , "14412"], "29762": ["14407" , "14412"], 
    "47978": ["16506" , "14412"], "42647": ["16506" , "14412"], "29763": ["16506" , "14412"], 
    "43408": ["16506" , "14412"], "42328": ["16506" , "14412"], "18517": ["30405"], 
    "17465": ["30405"], "43244": ["42443"], "5844": ["7443", "5849"], "5845": ["7443", "5849"], 
    "5846": ["7443", "5849"], "5847": ["7443", "5849"], "10178": ["10181"], "10179": ["10181"], 
    "10180": ["10181"], "35850": ["35857"], "35852": ["35858"], "34513": ["34499"], 
    "34514": ["34499"], "34496": ["34499"], "34492": ["34499"], "10576": ["10579"], 
    "10577": ["10579"], "10578": ["10579"] 
};

// Logout
if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = "login.html";
    });
}

// Renderização Tabela
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

        gruposParaRenderizar.forEach((grupo, index) => {
            const itemPrincipal = grupo.itens[0]; 
            const skuPrincipal = String(itemPrincipal.sku || itemPrincipal.SKU).trim();
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

            const custo = parseFloat(itemPrincipal.custos?.custo || 0);
            const verba = parseFloat(itemPrincipal.custos?.verba || 0);
            const mkBase = parseFloat(itemPrincipal.markup_base || 0);
            const precoCalculado = (custo - verba) * mkBase;

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
                    <td class="border border-slate-200 px-4 py-2 text-center font-bold text-blue-700 preco-col">
                        ${precoCalculado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                </tr>`;
            corpo.innerHTML += linha;
        });
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
        if (seletorSku && seletorSku.value) {
            skuAtual = seletorSku.value;
        }

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
        
        if (seletorSku && seletorSku.value) {
            skuAtual = seletorSku.value;
        }

        if (todasAsGrelhasMapeadas.includes(skuAtual)) {
            input.value = grelhasNecessarias[skuAtual] || 0;
        }
    });

    const descontoBase = parseFloat(document.getElementById('input-desconto').value) || 0;
    const rt = parseFloat(document.getElementById('input-rt').value) || 0;
    const penalidadePagto = parseFloat(document.getElementById('select-pagamento').value) || 0;

    const limiteAlcada = (window.filialVendedor === "1028") ? 21.99 : 18.00;
    
    if (descontoBase <= limiteAlcada) {
        window.testeHipoteseAtivo = false; // Libera o botão verde
        const msgHipotese = document.getElementById('msg-hipotese');
        const textoDescontoVisual = document.getElementById('texto-input-desconto');
        
        // Remove a cor da fonte apenas se não for um teste de hipótese (Alvo)
        if (textoDescontoVisual && !textoDescontoVisual.innerText.includes('Alvo')) {
            if(msgHipotese) msgHipotese.classList.add('hidden');
            textoDescontoVisual.style.color = ''; 
            textoDescontoVisual.style.fontWeight = '';
        }
    } else {
        window.testeHipoteseAtivo = true; // Estourou o limite, exige aprovação especial
    }

    const selectUf = document.getElementById('select-uf');
    const percentualFrete = selectUf ? parseFloat(selectUf.value) || 0 : 0;

    let percentualDescontoFinal = descontoBase - rt - penalidadePagto;
    if (percentualDescontoFinal < 0) percentualDescontoFinal = 0;
    
    const labelDescontoFinal = document.getElementById('label-desconto-final');
    if (labelDescontoFinal) labelDescontoFinal.innerText = `${percentualDescontoFinal.toFixed(2)}%`;

    let totalBrutoTabela = 0;
    let totalBtuCond = 0;
    let totalBtuEvap = 0;
    let custoTotalPedido = 0; // NOVO: Para descobrir o custo real de tudo
    let itensHtml = "";
    let itensParaImpressao = [];

    const MARKUP_BASE_FIXA = 1.63920658; 
    const inputsAtualizados = document.querySelectorAll('.qtd-input');
    
    inputsAtualizados.forEach(input => {
        const quantidade = parseInt(input.value) || 0;
        if (quantidade > 0) {
            const skuBuscado = input.getAttribute('data-sku');
            const produtoData = produtos.find(p => String(p.sku || p.SKU).trim() === String(skuBuscado).trim());

            if (produtoData) {
                const custo = parseFloat(produtoData.custos?.custo || 0);
                const verba = parseFloat(produtoData.custos?.verba || 0);
                const markupVenda = parseFloat(produtoData.markup_base) || MARKUP_BASE_FIXA;
                
                const variacao = 1 - (MARKUP_BASE_FIXA / markupVenda);
                const divisor = 1 - variacao;

                const descDecimal = descontoBase / 100;
                const rtDecimal = rt / 100;
                const pagtoDecimal = penalidadePagto / 100;

                const novoMarkup = (MARKUP_BASE_FIXA * ((1 - descDecimal) * (1 + (rtDecimal * 1.4)) * (1 + pagtoDecimal))) / divisor;
                let precoNumerico = (custo - verba) * novoMarkup;

                // Soma o total de venda e o total de custo do pedido
                totalBrutoTabela += (quantidade * precoNumerico);
                custoTotalPedido += (quantidade * (custo - verba)); 
                
                const nomeItem = produtoData.produto || produtoData.DESCRIÇÃO || "Item";
                const tipoItem = String(produtoData.tipo || produtoData.TIPO || "ITEM").toUpperCase();
                const capacidadeBtu = parseInt(produtoData.capacidade || produtoData.CAPACIDADE) || 0;

                if (tipoItem.includes('CONDENSADORA')) totalBtuCond += (quantidade * capacidadeBtu);
                else if (tipoItem.includes('EVAPORADORA')) totalBtuEvap += (quantidade * capacidadeBtu);

                const codFabrica = produtoData["codfab"] || produtoData["codigo fabricante"] || produtoData.MODELO || "-";

                itensParaImpressao.push({
                    codigo: skuBuscado,
                    descricao: nomeItem,
                    modelo: codFabrica, 
                    qtd: quantidade,
                    estoque: produtoData.estoque || produtoData.ESTOQUE || 0,
                    valorUnitario: precoNumerico,
                    subtotal: quantidade * precoNumerico
                });

                itensHtml += `
                    <div class="flex justify-between items-start bg-slate-50 p-2 rounded-sm border border-slate-100 mb-1">
                        <div class="flex flex-col flex-1 pr-2">
                            <div class="flex justify-between items-start gap-2 mb-1">
                                <span class="text-[12px] font-bold text-slate-900 leading-tight">${nomeItem}</span>
                                <span class="text-[11px] font-bold text-slate-500 shrink-0">SKU: ${skuBuscado}</span>
                            </div>
                            <span class="text-[11px] text-slate-500">Qtd: ${quantidade} x R$ ${precoNumerico.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                        </div>
                    </div>`;
            }
        }
    });

    // --- NOVO: BLOCO DO DESCONTO PROTHEUS DO PEDIDO ---
    if (custoTotalPedido > 0) {
        const descontoBase = parseFloat(document.getElementById('input-desconto').value) || 0;
        const rt = parseFloat(document.getElementById('input-rt').value) || 0;
        const penalidadePagto = parseFloat(document.getElementById('select-pagamento').value) || 0;
        const descDecimal = descontoBase / 100;
        const rtDecimal = rt / 100;
        const pagtoDecimal = penalidadePagto / 100;
        const skuBuscado = "10561";
        const produtoData = produtos.find(p => String(p.sku || p.SKU).trim() === String(skuBuscado).trim());
        const custo = parseFloat(produtoData.custos?.custo || 0);
        const verba = parseFloat(produtoData.custos?.verba || 0);
        const novoMarkup = (1.63920658 * ((1 - descDecimal) * (1 + (rtDecimal * 1.4)) * (1 + pagtoDecimal))) / 0.965;


        // 1. Descobre o markup real de todo o pedido junto
        // 2. Aplica a sua fórmula: (((MarkupPedido/1.699)-1)*-1)*100
        let descProtheusPedido = (((novoMarkup / 1.699) - 1) * -1) * 100;
        
        // Evita que descontos muito pequenos fiquem negativos ou deem erro (ex: -0.01%)
        if (descProtheusPedido < 0) descProtheusPedido = 0;

        // 3. Adiciona o bloco bonitão no final da lista
        itensHtml += `
            <div class="mt-4 p-4 bg-indigo-20 border border-indigo-200 text-center rounded-sm shadow-sm">
                <span class=" text-md font-bold text-indigo-900"> Desconto Protheus: ${descProtheusPedido.toFixed(1)}%</span>
            </div>
        `;
    }

    const subtotalComDesconto = totalBrutoTabela; 
    const valorFrete = subtotalComDesconto * (percentualFrete / 100);
    const totalFinalCusto = subtotalComDesconto + valorFrete;

    let simultaneidade = totalBtuCond > 0 ? (totalBtuEvap / totalBtuCond) * 100 : 0;

    const textoPagamento = document.getElementById('texto-select-pagamento')?.innerText || 'À vista';
    const textoUf = document.getElementById('texto-select-uf')?.innerText || 'SP';

    const dataHoje = new Date();
    const dataValidade = new Date(dataHoje);
    dataValidade.setDate(dataHoje.getDate() + 3);

    const marcaSelecionada = document.getElementById('marca-condensadora').value || "";
    const marcaBaseParaLogo = marcaSelecionada.split(' ')[0].toLowerCase();
    const nomeVendedorAtual = document.getElementById('perfil-nome').innerText || "Vendedor Climario";

    // O código inteligente será gerado e inserido dentro do enviarSolicitacaoSupabase
    window.dadosParaOrcamento = {
        itens: itensParaImpressao,
        totalBruto: totalBrutoTabela,
        totalGeral: totalFinalCusto,
        valorFrete: valorFrete,
        percentualFrete: percentualFrete,
        percentualDesconto: percentualDescontoFinal, 
        ufDestino: textoUf,
        totalBtuCond: totalBtuCond,
        totalBtuEvap: totalBtuEvap,
        simultaneidade: simultaneidade,
        formaPagamento: textoPagamento,
        dataEmissao: dataHoje.toLocaleDateString('pt-BR'),
        dataValidade: dataValidade.toLocaleDateString('pt-BR'),
        vendedor: nomeVendedorAtual,
        marcaNome: marcaSelecionada,
        marcaLogo: marcaBaseParaLogo
    };

    const listaResumo = document.getElementById('lista-itens-resumo');
    const subtotalExibicao = document.getElementById('resumo-subtotal');
    const freteExibicao = document.getElementById('resumo-frete');
    const totalExibicao = document.getElementById('resumo-total');
    
    const btuCondExibicao = document.getElementById('resumo-btu-cond');
    const btuEvapExibicao = document.getElementById('resumo-btu-evap');
    const simultaneidadeExibicao = document.getElementById('resumo-simultaneidade');

    if (listaResumo) listaResumo.innerHTML = itensHtml || '<p class="text-xs text-slate-500 italic">Nenhum item selecionado.</p>';
    if (subtotalExibicao) subtotalExibicao.innerText = subtotalComDesconto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (freteExibicao) freteExibicao.innerText = '+ ' + valorFrete.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (totalExibicao) totalExibicao.innerText = totalFinalCusto.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    
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

        if (totalBrutoTabela === 0) {
            btnFinalizar.disabled = true;
            btnFinalizar.innerText = "Gerar Orçamento";
            btnFinalizar.className = "w-full bg-slate-300 text-slate-500 font-bold py-3 rounded uppercase text-sm mt-4 cursor-not-allowed";
        } 
        else if (window.testeHipoteseAtivo) {
            btnFinalizar.disabled = false;
            btnFinalizar.innerText = "Solicitar Aprovação Especial";
            btnFinalizar.className = "w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded uppercase text-sm mt-4 transition-colors shadow-sm cursor-pointer";
            
            btnFinalizar.onclick = (e) => {
                e.preventDefault();
                abrirModalSolicitacao();
            };
        } 
        else {
            btnFinalizar.disabled = false;
            btnFinalizar.innerText = "Gerar Orçamento";
            btnFinalizar.className = "w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded uppercase text-sm mt-4 transition-colors shadow-sm cursor-pointer";
            
            // Alteração para Salvar no DB antes de gerar o PDF
            btnFinalizar.onclick = async () => {
                const txtAnterior = btnFinalizar.innerText;
                btnFinalizar.innerText = "Registrando... Aguarde";
                btnFinalizar.disabled = true;

                // Tenta enviar para o banco. Se for true, o sistema abre o PDF
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
};

window.atualizarLinhaDaTabela = function(selectElement, idLinha) {
    const skuSelecionado = selectElement.value;
    const linha = document.getElementById(idLinha);
    const produtoData = produtos.find(p => String(p.sku || p.SKU).trim() === String(skuSelecionado).trim());
    
    if (produtoData) {
        const inputQtd = linha.querySelector('.qtd-input');
        inputQtd.setAttribute('data-sku', skuSelecionado);
        linha.querySelector('.estoque-col').innerText = `${produtoData.estoque || produtoData.ESTOQUE || 0}`;
        
        const descBase = parseFloat(document.getElementById('input-desconto')?.value) || 0;
        const rt = parseFloat(document.getElementById('input-rt')?.value) || 0;
        const penalidadePagto = parseFloat(document.getElementById('select-pagamento')?.value) || 0;
        const MARKUP_BASE_FIXA = 1.63920658;
        
        const custo = parseFloat(produtoData.custos?.custo || 0);
        const verba = parseFloat(produtoData.custos?.verba || 0);
        const markupVenda = parseFloat(produtoData.markup_base) || MARKUP_BASE_FIXA;

        const variacao = 1 - (MARKUP_BASE_FIXA / markupVenda);
        const divisor = 1 - variacao;

        const descDecimal = descBase / 100;
        const rtDecimal = rt / 100;
        const pagtoDecimal = penalidadePagto / 100;

        const novoMarkup = (MARKUP_BASE_FIXA * ((1 - descDecimal) * (1 + (rtDecimal * 1.4)) * (1 + pagtoDecimal))) / divisor;
        const precoNumerico = (custo - verba) * novoMarkup;

        linha.querySelector('.preco-col').innerText = precoNumerico.toLocaleString('pt-BR', { 
            style: 'currency', 
            currency: 'BRL',
            minimumFractionDigits: 2 
        });
        
        atualizarResumo();
    }
};

caixaMarca.addEventListener('change', function(){
    let marcaEscolhida = caixaMarca.value.toUpperCase();

    corpoTabela.innerHTML = "";
    corpoEvap.innerHTML = "";

    if(marcaEscolhida === ""){
        containerTabela.classList.add("hidden");
        containerEvap.classList.add("hidden");
        cardEvap.classList.add("hidden");
        if(avisoEvap) avisoEvap.classList.add("hidden");
        return;
    }

    cardEvap.classList.remove('opacity-50');
    cardEvap.classList.remove('hidden');

    const condensadoras = produtos.filter(function(produto){
        return produto.tipo === 'CONDENSADORA' && produto.marca.toUpperCase() === marcaEscolhida;
    });

    const evaporadoras = produtos.filter(function(produto){
        const tipo = String(produto.tipo || produto.TIPO || "").toUpperCase();
        return (tipo === 'EVAPORADORA' || tipo === 'GRELHA' || tipo === 'CONTROLE' ) && produto.marca.toUpperCase() === marcaEscolhida;
    });

    popularTabela(condensadoras, corpoTabela, containerTabela);
    popularTabela(evaporadoras, corpoEvap, containerEvap);
});

window.addEventListener('load', () => {
    if (typeof window.atualizarResumo === 'function') {
        window.atualizarResumo();
    }
});

document.addEventListener('wheel', function(event) {
    if (document.activeElement.type === 'number') {
        document.activeElement.blur(); 
    }
});

// ==========================================
// HIPÓTESE E ENVIO PARA O BANCO (SUPABASE)
// ==========================================
window.testeHipoteseAtivo = false; 

window.fazerTesteHipotese = function() {
    const inputEvidencia = document.getElementById('input-evidencia');
    const valorEvidencia = parseFloat(inputEvidencia.value);

    if (!valorEvidencia || valorEvidencia <= 0) {
        alert("Insira um valor alvo válido para o teste.");
        return;
    }

    const inputDesconto = document.getElementById('input-desconto');
    inputDesconto.value = 0;
    window.atualizarResumo(); 
    
    const totalSemDesconto = window.dadosParaOrcamento.totalGeral;

    if (totalSemDesconto === 0) {
        alert("Adicione itens ao orçamento primeiro.");
        return;
    }

    let novoDesconto = (1 - (valorEvidencia / totalSemDesconto)) * 100;
    
    // 1. Criamos duas versões do número:
    let valorFormatado = novoDesconto.toFixed(2); // Para o vendedor ler (ex: 21.79)
    let valorMatematico = novoDesconto.toFixed(6); // Para o computador calcular (ex: 21.793482)

    // 2. Colocamos o valor matemático super preciso no input invisível
    inputDesconto.value = valorMatematico; 
    
    // --- LÓGICA DE APROVAÇÃO DO TESTE DE HIPÓTESE ---
    // (Aproveite para garantir que está com o String() da nossa última correção)
    const limiteAlcada = (String(window.filialVendedor) === '1028') ? 21.99 : 18.00;

    const textoDescontoVisual = document.getElementById('texto-input-desconto');
    const msgHipotese = document.getElementById('msg-hipotese');

    if (novoDesconto > limiteAlcada) {
        // ESTOUROU O LIMITE: BLOQUEIA A TELA
        window.testeHipoteseAtivo = true;
        if (msgHipotese) {
            msgHipotese.innerText = `⚠️ Requer aprovação comercial.`;
            msgHipotese.classList.remove('text-green-600');
            msgHipotese.classList.add('text-red-600');
        }
        if (textoDescontoVisual) {
            textoDescontoVisual.innerText = `${valorFormatado}%`;
            textoDescontoVisual.style.color = '#dc2626'; // Vermelho
            textoDescontoVisual.style.fontWeight = '900';
        }
    } else {
        // DENTRO DO LIMITE: LIBERA A TELA (BOTÃO VERDE)
        window.testeHipoteseAtivo = false;
        if (msgHipotese) {
            msgHipotese.innerText = `✅ Orçamento Liberado`;
            msgHipotese.classList.remove('text-red-600');
            msgHipotese.classList.add('text-green-600');
        }
        if (textoDescontoVisual) {
            textoDescontoVisual.innerText = `${valorFormatado}%`;
            textoDescontoVisual.style.color = '#16a34a'; // Verde
            textoDescontoVisual.style.fontWeight = '900';
        }
    }
    
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
        nomeVisual.innerText = input.files[0].name;
        nomeVisual.classList.replace('text-slate-500', 'text-orange-600');
    } else {
        nomeVisual.innerText = 'Clique para selecionar o arquivo';
        nomeVisual.classList.replace('text-orange-600', 'text-slate-500');
    }
};

// ==========================================
// ABA: MINHAS SOLICITAÇÕES
// ==========================================
async function carregarMinhasSolicitacoes(userId) {
    if(!userId) return;

    try {
        const { data, error } = await supabase
            .from('solicitacoes_orcamento')
            // OTIMIZAÇÃO: Ignoramos o 'snapshot' e 'url_evidencia' para economizar banda!
            .select('id, created_at, valor_alvo, desconto_solicitado, status, motivo, motivo_reprovacao, itens')
            .eq('vendedor_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        auditarDownload('Vendedor: Histórico de Solicitações', data);


        window.minhasSolicitacoes = data || [];
        renderizarMinhasSolicitacoes(window.minhasSolicitacoes);
    } catch (error) {
        console.error("Erro ao buscar as solicitações do usuário:", error);
    }

}

function renderizarMinhasSolicitacoes(lista) {
    const corpo = document.getElementById('corpo-minhas-solicitacoes');
    if (!corpo) return;
    corpo.innerHTML = '';

    if (lista.length === 0) {
        corpo.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">Nenhuma solicitação manual pendente ou respondida.</td></tr>`;
        return;
    }

    lista.forEach(req => {
        const dataFormatada = new Date(req.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        
        let statusHtml = '';
        let acoesHtml = '';

        if (req.status === 'aprovado') {
            statusHtml = `<span class="bg-green-100 text-green-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">Aprovado</span>`;
            acoesHtml = `<button onclick="abrirOrcamentoAprovado('${req.id}')" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm"><i class="fas fa-file-pdf mr-1"></i> Ver PDF</button>`;
        } else if (req.status === 'reprovado') {
            statusHtml = `<span class="bg-red-100 text-red-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">Reprovado</span>`;
            acoesHtml = `<button onclick="verMotivoReprovacao('${req.id}')" class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold transition-colors shadow-sm"><i class="fas fa-search mr-1"></i> Ver Motivo</button>`;
        } else {
            statusHtml = `<span class="bg-orange-100 text-orange-700 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">Pendente</span>`;
            acoesHtml = `<span class="text-xs text-slate-400 italic">Aguardando...</span>`;
        }

        let qtdItens = 0;
        if(req.itens) {
            req.itens.forEach(i => qtdItens += parseInt(i.qtd || 0));
        }

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 border-b border-slate-100 transition-colors";
        tr.innerHTML = `
            <td class="p-4 text-xs font-mono text-slate-500">${dataFormatada}</td>
            <td class="p-4 text-center font-bold text-slate-700">${qtdItens} un</td>
            <td class="p-4 text-right font-black text-indigo-700">R$ ${parseFloat(req.valor_alvo).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</td>
            <td class="p-4 text-center font-bold text-orange-600">${parseFloat(req.desconto_solicitado).toFixed(2)}%</td>
            <td class="p-4 text-center">${statusHtml}</td>
            <td class="p-4 text-center">${acoesHtml}</td>
        `;
        corpo.appendChild(tr);
    });
}

window.verMotivoReprovacao = function(id) {
    const req = window.minhasSolicitacoes.find(s => s.id === id);
    if (!req) return;
    
    document.getElementById('texto-motivo-reprovacao').innerText = req.motivo_reprovacao || "Não foi fornecido um comentário adicional para esta reprovação.";
    document.getElementById('modal-motivo-reprovacao').classList.remove('hidden');
};

window.abrirOrcamentoAprovado = async function(id) {
    document.body.style.cursor = 'wait'; // Muda o mouse para "carregando"
    
    try {
        // OTIMIZAÇÃO: Baixa o snapshot pesado APENAS na hora que clica
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
function gerarNumeroOrcamento(rt, desconto, valorPagamento, filial) {
    const rtFormatado = Math.floor(parseFloat(rt) || 0).toString();
    const descBase = Math.floor(parseFloat(desconto) || 0);
    const descFormatado = descBase.toString().padStart(2, '0');

    // Pega direto o valor numérico que veio do input (0 ou 5)
    const pagFormatado = Math.floor(parseFloat(valorPagamento) || 0).toString(); 
    
    const filialFormatada = String(filial || '1028').trim();
    const numAleatorio = Math.floor(1000 + Math.random() * 9000).toString();

    return `${rtFormatado}${descFormatado}${pagFormatado}${filialFormatada}${numAleatorio}`;
}

window.enviarSolicitacaoSupabase = async function(statusDefinido = 'pendente') {
    const btnEnviar = document.getElementById('btn-enviar-solicitacao');
    const motivo = document.getElementById('input-motivo-solicitacao')?.value || '';
    const inputArquivo = document.getElementById('input-arquivo-solicitacao');
    const valorAlvo = document.getElementById('input-evidencia')?.value || window.dadosParaOrcamento.totalBruto;
    
    if (statusDefinido === 'pendente') {
        if (!motivo) {
            alert("Por favor, preencha o motivo da solicitação.");
            return false;
        }
        
        // A trava que obrigava a ter o inputArquivo foi removida daqui!
        
        if (btnEnviar) {
            btnEnviar.innerText = "Registrando... Aguarde";
            btnEnviar.disabled = true;
            btnEnviar.classList.replace('bg-orange-500', 'bg-slate-400');
        }
    }
    
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Sessão expirada. Faça login novamente.");

        const rtAtual = document.getElementById('input-rt')?.value || 0;
        const descontoAtual = document.getElementById('input-desconto')?.value || 0;
        
        // --- CAPTURA BLINDADA PARA DROPDOWN CUSTOMIZADO ---
        const valorPagamento = document.getElementById('select-pagamento')?.value || 0;
        const elTextoPagamento = document.getElementById('texto-select-pagamento');
        const textoPagamento = elTextoPagamento ? elTextoPagamento.innerText.trim() : 'Á vista 100% antecipado (PIX)';

        // Geração do código passando o NÚMERO
        const numeroOrcamentoGerado = gerarNumeroOrcamento(rtAtual, descontoAtual, valorPagamento, window.filialVendedor);

        // Prepara os dados para o PDF
        window.dadosParaOrcamento.codigoOrcamento = numeroOrcamentoGerado;
        window.dadosParaOrcamento.filial = window.filialVendedor;
        window.dadosParaOrcamento.formaPagamento = textoPagamento;

        let urlEvidencia = null; // Por padrão vai vazio para o sistema

        // Só faz o upload se houver um arquivo selecionado
        if (statusDefinido === 'pendente' && inputArquivo && inputArquivo.files.length > 0) {
            let file = inputArquivo.files[0];
            const fileExt = file.name.split('.').pop().toLowerCase();
            const fileName = `${Date.now()}_${session.user.id}.${fileExt}`;

            // --- MÁGICA DA COMPRESSÃO DE IMAGENS ---
            // Só comprime se for imagem (ignora se o vendedor mandou um PDF)
            if (file.type.startsWith('image/')) {
                console.log(`📸 Tamanho original da foto: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
                
                const options = {
                    maxSizeMB: 0.3, // Limite máximo de 300 KB (excelente para leitura na tela)
                    maxWidthOrHeight: 1280, // Redimensiona fotos gigantes de 4K
                    useWebWorker: true // Faz a compressão sem travar a tela do celular
                };

                try {
                    // O arquivo original pesado é substituído pelo arquivo leve
                    file = await imageCompression(file, options);
                    console.log(`📉 Tamanho após compressão: ${(file.size / 1024 / 1024).toFixed(2)} MB`);
                } catch (error) {
                    console.warn("⚠️ Erro ao comprimir. Enviando foto original como backup:", error);
                }
            }
            // ----------------------------------------------

            const { error: uploadError } = await supabase.storage
                .from('evidencias')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data: publicUrlData } = supabase.storage
                .from('evidencias')
                .getPublicUrl(fileName);
                
            urlEvidencia = publicUrlData.publicUrl;
        }

        const payload = {
            codigo_orcamento: numeroOrcamentoGerado, 
            vendedor_id: session.user.id,
            vendedor_email: session.user.email,
            filial: window.filialVendedor,
            valor_alvo: parseFloat(valorAlvo),
            desconto_solicitado: parseFloat(descontoAtual),
            rt: parseFloat(rtAtual),
            pagamento: textoPagamento,
            motivo: statusDefinido === 'aprovado' ? 'Aprovado Automaticamente pelo Sistema' : motivo,
            url_evidencia: urlEvidencia, // Aqui sobe o arquivo OU fica null
            itens: window.dadosParaOrcamento.itens,
            total_bruto: window.dadosParaOrcamento.totalBruto,
            status: statusDefinido,
            snapshot: window.dadosParaOrcamento 
        };

        const { error: dbError } = await supabase
            .from('solicitacoes_orcamento')
            .insert([payload]);

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
            btnEnviar.classList.replace('bg-slate-400', 'bg-orange-500');
        }
    }
};

function auditarDownload(nomeRequisicao, dataResult) {
    if (!dataResult) return;
    
    // Calcula o peso exato do JSON baixado em bytes
    const bytes = new Blob([JSON.stringify(dataResult)]).size;
    let tamanho = '';
    
    if (bytes > 1024 * 1024) {
        tamanho = (bytes / (1024 * 1024)).toFixed(2) + ' MB 🚨 (ALERTA DE PESO)';
    } else {
        tamanho = (bytes / 1024).toFixed(2) + ' KB 🟢';
    }

    console.log(`📊 [API Supabase] ${nomeRequisicao}: Baixou ${tamanho}`);
}