export async function onRequestGet(context) {
    const { request } = context;
    
    // A Cloudflare injeta o objeto "cf" em todas as requisições com os dados de roteamento do usuário
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'Desconhecido';
    const city = request.cf?.city || 'Desconhecida';
    const region = request.cf?.region || 'Desconhecido';

    // Retorna os dados como se nós fossemos o ipapi.co
    return new Response(JSON.stringify({ 
        ip: ip, 
        city: city, 
        region: region 
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}