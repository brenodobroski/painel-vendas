import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqa3pvbGh4dXVxbWt1enRkbGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjE1NTgsImV4cCI6MjA5Mjc5NzU1OH0.37ihEUrCAUHpzOymrPUTau164DXmvhhWal8uX4V0oI0'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

window.minhasSolicitacoes = []; // Armazena as solicitações do usuário ativo

// Verifica se quem esta logando tem conta
async function verificarAcesso() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
        window.location.href = "login.html";
        return; 
    }

    try {
        // Atualiza a Interface com os dados do Vendedor Logado
        const nomeUsuario = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
        document.getElementById('perfil-nome').innerText = nomeUsuario;
        document.getElementById('perfil-email').innerText = session.user.email;
        document.getElementById('perfil-iniciais').innerText = nomeUsuario.substring(0, 2).toUpperCase();

        const { data: perfil, error } = await supabase
            .from('usuarios')
            .select('role, filial')
            .eq('id', session.user.id)
            .single();

        if (error) {
            console.error("Erro ao buscar permissões do usuário:", error);
            return;
        }

        // REGRA 1: Teste de Hipótese (Apenas Filial 1028 ou Admin)
        if (String(perfil?.filial) === '1028' || perfil?.role === 'admin') {
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

supabase.auth.onAuthStateChange((event, session) => {
    if (!session) window.location.href = "login.html";
});

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

async function carregarProdutosSupabase() {
    try {
        const { data, error } = await supabase
            .from('produtos')
            .select(`
                    *,
                    custos (
                        custo,
                        verba
                    )
                `);

        if (error) throw error;

        produtos = data;
        console.log(`${produtos.length} produtos carregados via Supabase!`);
        
        if (caixaMarca && caixaMarca.value) {
            caixaMarca.dispatchEvent(new Event('change'));
        }
    } catch (error) {
        console.error("Erro ao carregar produtos:", error);
    }
}
carregarProdutosSupabase();

// ==========================================
// FAMILIAS E REGRAS (MANTIDO)
// ==========================================
const familiasConfig = {
    "SAMSUNG BI 18K": ["29753"],
    "SAMSUNG TRI 24K": ["29754"],
    "SAMSUNG QUADRI 28K": ["29755"],
    "SAMSUNG PENTA 34K": ["42326", "29764"], 
    "SAMSUNG PENTA 48K": ["42325", "29765"],
    "SAMSUNG HW 7K": ["33872", "29756"], 
    "SAMSUNG HW 9K": ["34076", "29752"], 
    "SAMSUNG HW 12K": ["33806", "34445"], 
    "SAMSUNG HW 18K": ["34078"],
    "SAMSUNG HW 24K": ["34077", "29760"], 
    "SAMSUNG HW BLACK 9K": ["44612"],
    "SAMSUNG HW BLACK 12K": ["44613"],
    "SAMSUNG HW BLACK 18K": ["44614"],
    "SAMSUNG HW BLACK 24K": ["44615"],
    "SAMSUNG K7 4 VIAS 9K": ["41851"],
    "SAMSUNG K7 4 VIAS 12K": ["41797"],
    "SAMSUNG K7 4 VIAS 18K": ["41796"],
    "SAMSUNG GRELHA K7 4 VIAS": ["17105"],
    "SAMSUNG K7 1 VIA 9K": ["44610", "29761", "47977"],
    "SAMSUNG K7 1 VIA 12K": ["43406","44611", "29762"],
    "SAMSUNG K7 1 VIA 18K": ["47978", "29763", "42647"],
    "SAMSUNG K7 1 VIA 24K": ["43408", "42328"],
    "SAMSUNG GRELHA K7 1 VIA 9 A 12K": ["14407"], 
    "SAMSUNG GRELHA K7 1 VIA 18 A 24K": ["16506"],
    "SAMSUNG CONTROLE SEM FIO": ["14412"],
    "SAMSUNG KIT WI-FI": ["21843"],
    "SAMSUNG PLACA DE INTERFACE HW": ["29767"],
    "LG BI 18K": ["43180", "29973"],
    "LG BI 21K FRIO": ["48758"],
    "LG TRI 21K": ["43182", "30310"],
    "LG TRI 24K": ["43632", "24415"],
    "LG TRI 24K FRIO": ["48761"],
    "LG QUADRI 30K": ["43631", "15467"],
    "LG QUADRI 30K FRIO": ["48762"],
    "LG QUADRI 36K FRIO": ["48764"],
    "LG PENTA 36K": ["43679", "15472"],
    "LG PENTA 48K": ["43680", "23774"],
    "LG PENTA 48K FRIO": ["48765"],
    "LG PENTA 54K FRIO": ["48763"],
    "LG HW 7K": ["43638", "32215"],
    "LG HW 9K": ["43224", "15466"],
    "LG HW 12K": ["43681", "32246"],
    "LG HW 18K": ["43226", "32260"],
    "LG HW 24K": ["43227", "32267"],
    "LG HW ARTCOOL 7K": ["32251"],
    "LG HW ARTCOOL 9K": ["32214"],
    "LG HW ARTCOOL 12K": ["32208"],
    "LG HW ARTCOOL 18K": ["34399"],
    "LG HW ARTCOOL 24K": ["35667"],
    "LG PAINEL GALLERY 9K": ["20789"],
    "LG PAINEL GALLERY 12K": ["20788"],
    "LG K7 4 VIAS 9K": ["18517"],
    "LG K7 4 VIAS 12K": ["17465"],
    "LG K7 4 VIAS 18K": ["49980"],
    "LG K7 4 VIAS 24K": ["49981", "43244"],
    "LG GRELHA K7 4 VIAS 9 A 12K": ["30405"],
    "LG GRELHA K7 4 VIAS 18 A 24K": ["42443"],
    "LG K7 1 VIA 7K": ["48445"],
    "LG K7 1 VIA 9K": ["17591"],
    "LG K7 1 VIA 12K": ["17590"],
    "LG K7 1 VIA 18K": ["23773"],
    "LG K7 1 VIA 24K": ["30327"],
    "LG BI 16K FRIO": ["33175"],
    "LG HW 9K FRIO": ["33176"],
    "LG HW 12K FRIO": ["33177"],
    "DAIKIN BI 18K": ["24540"],
    "DAIKIN TRI 18K": ["26426"],
    "DAIKIN TRI 24K": ["24542"],
    "DAIKIN QUADRI 28K": ["24544"],
    "DAIKIN QUADRI 34K": ["24546"],
    "DAIKIN PENTA 38K": ["5836"],
    "DAIKIN HW 9K": ["30312"],
    "DAIKIN HW 12K": ["26429"],
    "DAIKIN HW 18K": ["23647"],
    "DAIKIN HW 20K": ["33390"],
    "DAIKIN HW 24K": ["27177"],
    "DAIKIN K7 4 VIAS 9K": ["5844"],
    "DAIKIN K7 4 VIAS 12K": ["5845"],
    "DAIKIN K7 4 VIAS 17K": ["5846"],
    "DAIKIN K7 4 VIAS 20K": ["5847"],
    "DAIKIN GRELHA K7 4 VIA": ["7443"],
    "DAIKIN K7 1 VIA 9K": ["10178"],
    "DAIKIN K7 1 VIA 12K": ["10179"],
    "DAIKIN K7 1 VIA 18K": ["10180"],
    "DAIKIN GRELHA K7 1 VIA": ["10181"],
    "DAIKIN BUILT IN 9K": ["5840"],
    "DAIKIN BUILT IN 12K": ["5841"],
    "DAIKIN BUILT IN 18K": ["5842"],
    "DAIKIN BUILT IN 21K": ["5843"],
    "DAIKIN CONTROLE SEM FIO": ["5849"],
    "DAIKIN BI 18K R32": ["30456"],
    "DAIKIN HW BI 9K R32": ["30457"],
    "DAIKIN HW BI 12K R32": ["30458"],
    "DAIKIN TRI 18K R32 FRIO": ["33087"],
    "DAIKIN HW TRI 9K R32": ["33085"],
    "DAIKIN HW TRI 12K R32": ["33086"],
    "MIDEA BI 18K": ["35269"],
    "MIDEA TRI 27K": ["33117"],
    "MIDEA QUADRI 36K": ["33118"],
    "MIDEA PENTA 42K": ["32510"],
    "MIDEA HW 9K": ["48165", "33250"],
    "MIDEA HW 12K": ["33251", "48171"],
    "MIDEA HW 18K": ["48721", "35699"],
    "MIDEA HW 24K": ["35700", "48173"],
    "MIDEA HW BLACK 9K": ["33988"],
    "MIDEA HW BLACK 12K": ["33984"],
    "MIDEA HW BLACK 18K": ["33985"],
    "MIDEA HW BLACK 24K": ["33986"],
    "MIDEA K7 1 VIA 12K": ["35850"],
    "MIDEA K7 1 VIA 18K": ["35852"],
    "MIDEA GRELHA K7 1 VIA 12K": ["35857"],
    "MIDEA GRELHA K7 1 VIA 18K": ["35858"],
    "MIDEA BUILT IN 9K": ["22093"],
    "MIDEA BUILT IN 12K": ["22094"],
    "ELGIN BI 18K": ["41232"],
    "ELGIN TRI 27K": ["41235"],
    "ELGIN HW 9K": ["41230"],
    "ELGIN HW 12K": ["41231"],
    "ELGIN HW 18K": ["48623"],
    "GREE BI 18K": ["34545"],
    "GREE TRI 24K": ["34515"],
    "GREE TRI 30K": ["34501"],
    "GREE QUADRI 36K": ["34502"],
    "GREE PENTA 42K": ["34518"],
    "GREE PENTA 48K": ["34519"],
    "GREE HW 9K": ["34541"],
    "GREE HW 12K": ["34543"],
    "GREE HW 18K": ["34540"],
    "GREE HW 24K": ["34544"],
    "GREE HW DIAMOND 9K": ["41426"],
    "GREE HW DIAMOND 12K": ["41423"],
    "GREE HW DIAMOND 18K": ["41424"],
    "GREE HW DIAMOND 24K": ["41421"],
    "GREE K7 1 VIA 9K": ["34513"],
    "GREE K7 1 VIA 12K": ["34514"],
    "GREE K7 1 VIA 18K": ["34496"],
    "GREE K7 1 VIA 24K": ["34492"],
    "GREE GRELHA K7 1 VIA": ["34499"],
    "FUJITSU BI 18K": ["10548"],
    "FUJITSU TRI 18K": ["10549"],
    "FUJITSU TRI 24K": ["10555"],
    "FUJITSU QUADRI 30K": ["10556"],
    "FUJITSU QUADRI 36K": ["10557"],
    "FUJITSU HEXA 45K": ["10561"],
    "FUJITSU HW 7K": ["10581"],
    "FUJITSU HW 9K": ["10567"],
    "FUJITSU HW 12K": ["10571"],
    "FUJITSU HW 18K": ["10582"],
    "FUJITSU HW 24K": ["10562"],
    "FUJITSU PISO 12K": ["7034"],
    "FUJITSU K7 4 VIAS 9K": ["10576"],
    "FUJITSU K7 4 VIAS 12K": ["10577"],
    "FUJITSU K7 4 VIAS 18K": ["10578"],
    "FUJITSU GRELHA K7 4 VIAS": ["10579"],
    "FUJITSU BUILT IN 12K": ["10564"],
    "FUJITSU BUILT IN 18K": ["10565"]
};

const regrasAcessorios = {
    "41851": ["17105" , "14412"], "41797": ["17105" , "14412"], "41796": ["17105" , "14412"], 
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
    
    if (descontoBase === 18) {
        window.testeHipoteseAtivo = false;
        const msgHipotese = document.getElementById('msg-hipotese');
        const textoDescontoVisual = document.getElementById('texto-input-desconto');
        if(msgHipotese) msgHipotese.classList.add('hidden');
        if(textoDescontoVisual) {
            textoDescontoVisual.style.color = ''; 
            textoDescontoVisual.style.fontWeight = '';
        }
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

                totalBrutoTabela += (quantidade * precoNumerico);
                
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
                                <span class="text-[10px] font-mono text-slate-400 shrink-0">SKU: ${skuBuscado}</span>
                            </div>
                            <span class="text-[11px] text-slate-500">Qtd: ${quantidade} x R$ ${precoNumerico.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                        </div>
                    </div>`;
            }
        }
    });

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
            
            btnFinalizar.onclick = () => {
                sessionStorage.setItem('orcamentoDados', JSON.stringify(window.dadosParaOrcamento));
                window.open('orcamento.html', '_blank');
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
    let valorFormatado = novoDesconto.toFixed(2); 

    inputDesconto.value = valorFormatado; 
    
    const textoDescontoVisual = document.getElementById('texto-input-desconto');
    if (textoDescontoVisual) {
        textoDescontoVisual.innerText = `${valorFormatado}% (Alvo)`;
        textoDescontoVisual.style.color = '#4f46e5'; 
        textoDescontoVisual.style.fontWeight = '900';
    }
    
    window.testeHipoteseAtivo = true;
    document.getElementById('msg-hipotese').classList.remove('hidden');
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

window.enviarSolicitacaoSupabase = async function() {
    const btnEnviar = document.getElementById('btn-enviar-solicitacao');
    const motivo = document.getElementById('input-motivo-solicitacao').value;
    const inputArquivo = document.getElementById('input-arquivo-solicitacao');
    const valorAlvo = document.getElementById('input-evidencia').value;
    
    if (!motivo) {
        alert("Por favor, preencha o motivo da solicitação.");
        return;
    }
    if (!inputArquivo.files || inputArquivo.files.length === 0) {
        alert("Por favor, anexe a evidência (PDF ou Imagem).");
        return;
    }
    
    const textoOriginal = btnEnviar.innerText;
    btnEnviar.innerText = "Enviando... Aguarde";
    btnEnviar.disabled = true;
    btnEnviar.classList.replace('bg-orange-500', 'bg-slate-400');

    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Sessão expirada. Faça login novamente.");

        const { data: perfil } = await supabase
            .from('usuarios')
            .select('filial')
            .eq('id', session.user.id)
            .single();

        const file = inputArquivo.files[0];
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${session.user.id}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('evidencias')
            .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
            .from('evidencias')
            .getPublicUrl(fileName);
            
        const urlEvidencia = publicUrlData.publicUrl;

        const rtAtual = document.getElementById('input-rt').value || 0;
        const pagamentoAtual = document.getElementById('texto-select-pagamento')?.innerText || 'À vista';
        const descontoSolicitado = document.getElementById('input-desconto').value;

        const payload = {
            vendedor_id: session.user.id,
            vendedor_email: session.user.email,
            filial: perfil?.filial || 'Indefinida',
            valor_alvo: parseFloat(valorAlvo),
            desconto_solicitado: parseFloat(descontoSolicitado),
            rt: parseFloat(rtAtual),
            pagamento: pagamentoAtual,
            motivo: motivo,
            url_evidencia: urlEvidencia,
            itens: window.dadosParaOrcamento.itens,
            total_bruto: window.dadosParaOrcamento.totalBruto,
            status: 'pendente',
            snapshot: window.dadosParaOrcamento // Salva o estado perfeito da tela no banco
        };

        const { error: dbError } = await supabase
            .from('solicitacoes_orcamento')
            .insert([payload]);

        if (dbError) throw dbError;

        alert("Solicitação enviada com sucesso!");
        fecharModalSolicitacao();
        
        // Recarrega a tabela de acompanhamento e muda de aba
        carregarMinhasSolicitacoes(session.user.id);
        if(typeof mudarAba === 'function') mudarAba('solicitacoes');

    } catch (error) {
        console.error("Erro no fluxo de envio:", error);
        alert("Erro ao enviar: " + error.message);
    } finally {
        btnEnviar.innerText = textoOriginal;
        btnEnviar.disabled = false;
        btnEnviar.classList.replace('bg-slate-400', 'bg-orange-500');
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
            .select('*')
            .eq('vendedor_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;

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
        corpo.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-500 italic">Você ainda não enviou nenhuma solicitação.</td></tr>`;
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

        // Calcula a quantidade de máquinas totais no pedido
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

// Ações dos Botões da Tabela
window.verMotivoReprovacao = function(id) {
    const req = window.minhasSolicitacoes.find(s => s.id === id);
    if (!req) return;
    
    document.getElementById('texto-motivo-reprovacao').innerText = req.motivo_reprovacao || "Não foi fornecido um comentário adicional para esta reprovação.";
    document.getElementById('modal-motivo-reprovacao').classList.remove('hidden');
};

window.abrirOrcamentoAprovado = function(id) {
    const req = window.minhasSolicitacoes.find(s => s.id === id);
    if (!req || !req.snapshot) {
        alert("Erro: O snapshot deste orçamento não foi encontrado no banco de dados.");
        return;
    }

    // Passa o objeto perfeito da época direto para a página de impressão
    sessionStorage.setItem('orcamentoDados', JSON.stringify(req.snapshot));
    window.open('orcamento.html', '_blank');
};