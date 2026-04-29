// 1. Importação do SDK do Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// 2. Configuração
const SUPABASE_URL = 'https://ijkzolhxuuqmkuztdliv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqa3pvbGh4dXVxbWt1enRkbGl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMjE1NTgsImV4cCI6MjA5Mjc5NzU1OH0.37ihEUrCAUHpzOymrPUTau164DXmvhhWal8uX4V0oI0'; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const loginForm = document.getElementById('login-form');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const btnLogin = loginForm.querySelector('button');

        const textoOriginal = btnLogin.innerText;
        btnLogin.innerText = "Verificando...";
        btnLogin.disabled = true;

        try {
            // 3. Autenticação no Supabase
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) throw error;

            // --- INÍCIO DA TRAVA DE SESSÃO ÚNICA ---
            // A. Gera um Token de Sessão Único para esta máquina/navegador
            const tokenSessao = crypto.randomUUID();
            
            // B. Salva o token na memória do navegador do vendedor
            localStorage.setItem('climario_token_sessao', tokenSessao);

            // C. Grava no banco de dados (derrubando qualquer outro login anterior desta conta)
            await supabase
                .from('usuarios')
                .update({ token_sessao: tokenSessao })
                .eq('id', data.user.id);
            // --- FIM DA TRAVA ---

            // 4. Verificação de Cadastro (Garante que o usuário está na tabela 'usuarios')
            const { data: perfil, error: erroPerfil } = await supabase
                .from('usuarios')
                .select('role') // Buscamos apenas para confirmar existência
                .eq('id', data.user.id)
                .single();

            if (erroPerfil || !perfil) {
                // Se o usuário não estiver na tabela, deslogamos ele por segurança
                await supabase.auth.signOut();
                alert("Acesso negado: Usuário não encontrado no cadastro da Climario.");
                btnLogin.innerText = textoOriginal;
                btnLogin.disabled = false;
                return;
            }

            // 5. Redirecionamento Único
            // Aqui, tanto Admin quanto Vendedor vão para o simulador (index.html)
            window.location.href = "index.html";

        } catch (error) {
            console.error("Erro no login:", error.message);
            alert("Erro ao acessar: Verifique seu e-mail e senha.");
            
            btnLogin.innerText = textoOriginal;
            btnLogin.disabled = false;
        }
    });
}