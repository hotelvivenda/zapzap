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

## Follow-up e respostas prontas
Cada cliente pode ter uma data de "Próximo contato". Follow-ups de hoje ou atrasados aparecem no cartão,
na lista de conversas e na faixa de atenção do funil (junto com os clientes parados). Enviar uma mensagem
conclui um follow-up vencido. As respostas prontas ficam na aba Respostas (administrador edita);
na conversa, use o botão Respostas ou digite `/`. Variáveis: `{nome}` e `{atendente}`.

## Etapas finais e clientes que voltam
Etapas marcadas como finais (Fechado e Perdido por padrão) não têm follow-up nem aviso de parado.
Quando um cliente de etapa final escreve de novo, ele volta para a primeira etapa; o valor anterior é zerado
e registrado nas anotações. A "primeira resposta" que avança o cliente da primeira para a segunda etapa
conta desde que ele entrou na primeira etapa. Todas as conversas são visíveis a todos os atendentes.

## Nome do atendente
O topo da conversa mostra quem atendeu por último. As mensagens enviadas ao hóspede começam com
`*Nome do atendente · Nome do hotel*` (negrito do WhatsApp); o CRM guarda o texto sem a assinatura.
Ligar/desligar e nome do hotel: aba Equipe (administrador). Sem login (uso local) não há assinatura.

## Atualizar na VPS
`zapzap-update` (instalado pelo `deploy/install.sh`): faz backup, baixa a versão mais nova do GitHub e roda o
instalador novo. Dados, senha e configuração são mantidos. Nada se atualiza sozinho.

## Mídia recebida (WhatsApp oficial)
O webhook baixa fotos, áudios, vídeos, documentos e figurinhas na hora e guarda em `data/media` (nome aleatório).
Áudio é convertido para MP3 com ffmpeg (toca em qualquer navegador). Só tipos seguros abrem na tela; o resto
baixa com `Content-Disposition: attachment`. Falhas e tipos não suportados viram um aviso na conversa.
Limite de 64 MB por arquivo. Só recebe; ainda não envia mídia.

## Tipos de contato
`contacts.kind`: hospede (padrão), fornecedor, manutencao, mercado, equipe, outro. Só hóspedes aparecem no funil e recebem
regras de etapa (avanço na primeira resposta, volta de etapa final, aviso de parado). O tipo de um número já cadastrado
é mantido quando ele escreve. Follow-up vale para todos os tipos. Grupos do WhatsApp não são suportados pela API oficial.
