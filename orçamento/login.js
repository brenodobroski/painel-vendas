// 1. Importação do SDK do Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// 2. Configuração
const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqa3pvbGh4dXVxbWt1enRkbGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjE1NTgsImV4cCI6MjA5Mjc5NzU1OH0.37ihEUrCAUHpzOymrPUTau164DXmvhhWal8uX4V0oI0';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DOMINIO_PERMITIDO = '@climario.com.br';

// ==========================================================
// HELPERS DE MODAL E ALERTA
// ==========================================================
function abrirModal(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
}
function fecharModal(id) {
    const m = document.getElementById(id);
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    const alerta = m?.querySelector('[id^="alerta-modal"]');
    if (alerta) alerta.classList.add('hidden');
}
function alerta(id, mensagem, tipo = 'erro') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = mensagem;
    el.className = 'mb-4 px-3 py-2.5 rounded text-xs font-medium ' + (
        tipo === 'erro'
            ? 'bg-red-50 text-red-700 border border-red-200'
            : 'bg-green-50 text-green-700 border border-green-200'
    );
    el.classList.remove('hidden');
}

// ==========================================================
// LOGIN (fluxo original mantido)
// ==========================================================
const loginForm = document.getElementById('login-form');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        function obterAncoraDispositivo() {
            let anchor = localStorage.getItem('_ga_device_sync_');
            if (!anchor) {
                anchor = crypto.randomUUID();
                localStorage.setItem('_ga_device_sync_', anchor);
            }
            return anchor;
        }

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const btnLogin = loginForm.querySelector('button[type="submit"]');

        const textoOriginal = btnLogin.innerText;
        btnLogin.innerText = "Verificando...";
        btnLogin.disabled = true;

        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) throw error;

            // --- TRAVA DE SESSÃO ÚNICA ---
            const uuidSessao = crypto.randomUUID();
            const ancora = obterAncoraDispositivo();
            localStorage.setItem('climario_token_sessao', uuidSessao);
            const tokenSessao = `${ancora}|${uuidSessao}`;

            const { error: erroToken } = await supabase
                .from('usuarios')
                .update({ token_sessao: tokenSessao })
                .eq('id', data.user.id);

            if (erroToken) console.error("Erro ao salvar trava de sessão:", erroToken);
            // --- FIM DA TRAVA ---

            const { data: perfil, error: erroPerfil } = await supabase
                .from('usuarios')
                .select('role')
                .eq('id', data.user.id)
                .single();

            if (erroPerfil || !perfil) {
                await supabase.auth.signOut();
                alert("Acesso negado: seu cadastro ainda não foi aprovado pela administração.");
                btnLogin.innerText = textoOriginal;
                btnLogin.disabled = false;
                return;
            }

            if (typeof window.mostrarLoading === 'function') window.mostrarLoading();
            setTimeout(() => { window.location.href = "index.html"; }, 3000);

        } catch (error) {
            console.error("Erro no login:", error.message);
            alert("Erro ao acessar: Verifique seu e-mail e senha.");
            btnLogin.innerText = textoOriginal;
            btnLogin.disabled = false;
        }
    });
}

// ==========================================================
// MODAL CADASTRO
// ==========================================================
let filiaisCarregadas = false;

async function carregarFiliaisDropdown() {
    const container = document.getElementById('itens-cad-filial');
    if (!container) return;
    container.innerHTML = '<div class="dropdown-item text-slate-400">Carregando filiais...</div>';

    const { data, error } = await supabase
        .from('filiais')
        .select('codigo, nome')
        .eq('ativa', true)
        .order('codigo');

    if (error || !data || data.length === 0) {
        container.innerHTML = '<div class="dropdown-item text-slate-400">Nenhuma filial disponível</div>';
        return;
    }

    container.innerHTML = '';
    data.forEach(f => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.dataset.value = f.codigo;
        item.textContent = f.nome ? `${f.codigo} - ${f.nome}` : `Filial ${f.codigo}`;
        item.onclick = () => {
            document.getElementById('cad-filial').value = f.codigo;
            const texto = document.getElementById('texto-cad-filial');
            texto.textContent = item.textContent;
            texto.classList.remove('text-slate-400');
            texto.classList.add('text-slate-900');
            container.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selecionado'));
            item.classList.add('selecionado');
            document.getElementById('lista-cad-filial').classList.remove('aberto');
        };
        container.appendChild(item);
    });
    filiaisCarregadas = true;
}

document.getElementById('btn-cad-filial')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('lista-cad-filial').classList.toggle('aberto');
});

window.abrirModalCadastro = function () {
    abrirModal('modal-cadastro');
    if (!filiaisCarregadas) carregarFiliaisDropdown();
};
window.fecharModalCadastro = function () { fecharModal('modal-cadastro'); };

const cadastroForm = document.getElementById('cadastro-form');

if (cadastroForm) {
    cadastroForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nome = document.getElementById('cad-nome').value.trim();
        const email = document.getElementById('cad-email').value.trim().toLowerCase();
        const filial = document.getElementById('cad-filial').value;
        const rca = document.getElementById('cad-rca').value.trim();
        const password = document.getElementById('cad-password').value;
        const passwordConfirm = document.getElementById('cad-password-confirm').value;
        const btn = document.getElementById('btn-solicitar-cadastro');

        if (!email.endsWith(DOMINIO_PERMITIDO)) {
            alerta('alerta-modal-cadastro', `Apenas e-mails ${DOMINIO_PERMITIDO} podem se cadastrar.`);
            return;
        }
        if (!filial) {
            alerta('alerta-modal-cadastro', 'Selecione a filial.');
            return;
        }
        if (password !== passwordConfirm) {
            alerta('alerta-modal-cadastro', 'As senhas não coincidem.');
            return;
        }
        if (password.length < 6) {
            alerta('alerta-modal-cadastro', 'A senha deve ter no mínimo 6 caracteres.');
            return;
        }

        const textoOriginal = btn.innerText;
        btn.innerText = 'Enviando...';
        btn.disabled = true;

        try {
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: { data: { nome, filial, rca } }
            });

            if (error) {
                if (error.message.includes('already registered')) {
                    throw new Error('Este e-mail já possui cadastro. Tente fazer login.');
                }
                throw error;
            }
            if (!data.user) throw new Error('Não foi possível criar o usuário.');

            const { error: erroFila } = await supabase
                .from('solicitacoes_cadastro')
                .insert([{
                    user_id: data.user.id,
                    nome, email, filial, rca,
                    status: 'pendente'
                }]);

            if (erroFila) console.error('Erro ao entrar na fila:', erroFila);

            await supabase.auth.signOut();

            alerta('alerta-modal-cadastro', 'Cadastro enviado! Aguarde a aprovação da administração para acessar o sistema.', 'ok');
            cadastroForm.reset();
            document.getElementById('cad-filial').value = '';
            const texto = document.getElementById('texto-cad-filial');
            texto.textContent = 'Selecione a filial';
            texto.classList.add('text-slate-400');
            texto.classList.remove('text-slate-900');

            setTimeout(() => { fecharModal('modal-cadastro'); btn.innerText = textoOriginal; btn.disabled = false; }, 3000);

        } catch (error) {
            console.error('Erro no cadastro:', error.message);
            alerta('alerta-modal-cadastro', error.message || 'Erro ao solicitar cadastro. Tente novamente.');
            btn.innerText = textoOriginal;
            btn.disabled = false;
        }
    });
}

// ==========================================================
// MODAL ESQUECI A SENHA
// ==========================================================
window.abrirModalEsqueceu = function () {
    fecharModal('modal-cadastro');
    abrirModal('modal-esqueceu');
    setTimeout(() => document.getElementById('esq-email')?.focus(), 100);
};
window.fecharModalEsqueceu = function () { fecharModal('modal-esqueceu'); };

const esqueceuForm = document.getElementById('esqueceu-form');

if (esqueceuForm) {
    esqueceuForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('esq-email').value.trim().toLowerCase();
        const btn = document.getElementById('btn-enviar-recuperacao');

        if (!email.endsWith(DOMINIO_PERMITIDO)) {
            alerta('alerta-modal-esqueceu', `Informe um e-mail ${DOMINIO_PERMITIDO}.`);
            return;
        }

        const textoOriginal = btn.innerText;
        btn.innerText = 'Enviando...';
        btn.disabled = true;

        try {
            // Envia o e-mail com link que volta para o login.html
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/login.html'
            });

            if (error) throw error;

            alerta('alerta-modal-esqueceu', 'Link enviado! Verifique sua caixa de entrada (e o spam).', 'ok');
            esqueceuForm.reset();

        } catch (error) {
            console.error('Erro ao enviar recuperação:', error.message);
            alerta('alerta-modal-esqueceu', 'Não foi possível enviar o e-mail. Verifique o endereço e tente novamente.');
        }

        btn.innerText = textoOriginal;
        btn.disabled = false;
    });
}

// ==========================================================
// MODAL NOVA SENHA (abre sozinho ao voltar pelo link do e-mail)
// ==========================================================
window.abrirModalNovaSenha = function () {
    fecharModal('modal-esqueceu');
    abrirModal('modal-nova-senha');
};
window.fecharModalNovaSenha = function () { fecharModal('modal-nova-senha'); };

// Detecta quando o usuário chega pelo link de recuperação do e-mail
supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
        window.abrirModalNovaSenha();
    }
});

const novaSenhaForm = document.getElementById('nova-senha-form');

if (novaSenhaForm) {
    novaSenhaForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const password = document.getElementById('nova-password').value;
        const passwordConfirm = document.getElementById('nova-password-confirm').value;
        const btn = document.getElementById('btn-salvar-nova-senha');

        if (password !== passwordConfirm) {
            alerta('alerta-modal-nova-senha', 'As senhas não coincidem.');
            return;
        }
        if (password.length < 6) {
            alerta('alerta-modal-nova-senha', 'A senha deve ter no mínimo 6 caracteres.');
            return;
        }

        const textoOriginal = btn.innerText;
        btn.innerText = 'Salvando...';
        btn.disabled = true;

        try {
            const { error } = await supabase.auth.updateUser({ password });

            if (error) throw error;

            alerta('alerta-modal-nova-senha', 'Senha alterada com sucesso! Faça login com a nova senha.', 'ok');
            await supabase.auth.signOut();
            novaSenhaForm.reset();

            setTimeout(() => {
                fecharModal('modal-nova-senha');
                btn.innerText = textoOriginal;
                btn.disabled = false;
            }, 2500);

        } catch (error) {
            console.error('Erro ao atualizar senha:', error.message);
            alerta('alerta-modal-nova-senha', 'Não foi possível alterar a senha. O link pode ter expirado — solicite um novo.');
            btn.innerText = textoOriginal;
            btn.disabled = false;
        }
    });
}

// Fecha qualquer modal ao clicar no fundo escuro
document.addEventListener('click', (e) => {
    ['modal-cadastro', 'modal-esqueceu', 'modal-nova-senha'].forEach(id => {
        const m = document.getElementById(id);
        if (m && e.target === m) fecharModal(id);
    });
    // Fecha dropdown de filial ao clicar fora
    const lista = document.getElementById('lista-cad-filial');
    const btnFilial = document.getElementById('btn-cad-filial');
    if (lista && btnFilial && !btnFilial.contains(e.target) && !lista.contains(e.target)) {
        lista.classList.remove('aberto');
    }
});