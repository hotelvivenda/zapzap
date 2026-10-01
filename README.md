# ZapZap CRM

CRM simples para atender clientes pelo WhatsApp: lista de conversas, histórico,
cadastro de contatos, etapa do funil (Novo → Em conversa → Proposta → Fechado/Perdido)
e anotações.

## Rodar

    cp .env.example .env      # opcional
    npm run install:all
    npm run build
    npm start                 # http://localhost:3000

Em desenvolvimento: `npm run dev:server` e, em outro terminal, `npm run dev:web`.
Requer Node 22.13+.

## Modo teste (padrão)
Nada é enviado ao WhatsApp. Use o botão "Simular resposta" para fingir mensagens do cliente.

## Conectar ao WhatsApp de verdade (API oficial da Meta)
1. Crie um app em developers.facebook.com e adicione o produto WhatsApp.
2. Copie o token e o Phone Number ID para o `.env` e use `WHATSAPP_PROVIDER=cloud`.
3. No painel da Meta, configure o webhook para `https://SEU-DOMINIO/webhook`
   com o mesmo valor de `WHATSAPP_VERIFY_TOKEN`, e assine o campo `messages`.

Obs.: pela API oficial, só é possível iniciar conversa com um cliente usando um
template aprovado; dentro de 24h após a última mensagem dele, texto livre funciona.

## Movimentos automáticos
- Cliente novo entra na primeira coluna do funil.
- Na primeira resposta enviada a um cliente da primeira coluna, ele vai para a segunda.
- Todo o resto é movido à mão.
