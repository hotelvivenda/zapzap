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

## Aviso de cliente parado
Cada etapa tem o campo "Avisar após (dias)" (em Funil > Editar etapas). Cliente que fica mais tempo
que isso na etapa ganha um aviso no cartão e entra na lista do topo do funil. Por padrão:
Proposta enviada = 2 dias, Aguardando pagamento = 1 dia. Mover o cliente zera a contagem.

## Instalar em um servidor (VPS)
Veja `deploy/GUIA-INSTALACAO.md` (passo a passo para quem não é programador) e `deploy/install.sh`.
O servidor exige senha (`CRM_PASSWORD_HASH`) e só aceita conexões locais; o HTTPS fica por conta do Caddy.
Para gerar o hash de uma senha: `printf '%s' 'sua-senha' | npm run --silent set-password`.

## Vários atendentes
Cada atendente tem usuário e senha próprios e o nome aparece em cada mensagem enviada.
O primeiro administrador (usuário `admin`) é criado na primeira execução a partir de
`CRM_PASSWORD_HASH` e `CRM_ADMIN_NAME`; os demais são criados na aba Equipe.
Atendentes não gerenciam a equipe nem editam as etapas do funil. Recuperar acesso pelo terminal:
`printf '%s' 'nova-senha' | node server/src/reset-password.js admin`.
