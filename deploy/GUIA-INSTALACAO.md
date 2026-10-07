# Guia de instalação do ZapZap CRM na Hostinger

Este guia é para quem não é programador. Você vai fazer 4 coisas: comprar a VPS, apontar um endereço para ela, colar um comando e abrir o CRM no navegador. Leva cerca de 30 minutos, fora a espera do endereço começar a funcionar.

Os nomes exatos dos botões no site da Hostinger podem mudar de vez em quando. Se não achar algum, procure um nome parecido ou me mande uma foto da tela.

## Antes de começar, tenha à mão
- Um cartão para pagar a VPS.
- O domínio do hotel (por exemplo `hotelvivenda.com.br`). Você vai usar um endereço dentro dele, como `crm.hotelvivenda.com.br`.

## Passo 1. Comprar a VPS
1. No site da Hostinger, escolha **VPS** (plano KVM). O plano mais barato com 2 GB de memória ou mais é suficiente para um hotel.
2. Ao configurar, escolha o sistema **Ubuntu 24.04** simples. **Não** escolha as opções com painel, com aplicativos prontos ou "com Docker".
3. Anote a **senha de administrador (root)** que você criar. Guarde num lugar seguro.
4. Quando terminar, abra o painel da VPS e anote o **endereço IP** dela, um número como `203.0.113.45`.

## Passo 2. Apontar o endereço para a VPS
Esta parte é feita onde o seu domínio está registrado (pode ser a própria Hostinger ou o Registro.br).

1. Abra as configurações de **DNS** do domínio.
2. Crie um registro com estes dados:
   - **Tipo:** `A`
   - **Nome:** `crm`
   - **Valor (aponta para):** o IP da VPS do passo 1
3. Salve. Pode levar de alguns minutos até algumas horas para valer.

## Passo 3. Instalar
1. No painel da VPS, abra o **Terminal do navegador** (uma tela preta onde você digita comandos). Você já entra como administrador.
2. Cole o comando abaixo e aperte Enter:

```
curl -fsSL https://raw.githubusercontent.com/hotelvivenda/zapzap/claude/awesome-curie-6g5pgw/deploy/install.sh | bash
```

   Se o repositório do CRM no GitHub for **privado**, esse comando não funciona. Nesse caso, peça a quem cuida do GitHub do hotel um "token de leitura" e use esta versão, trocando `SEU_TOKEN`:

```
curl -fsSL -H "Authorization: Bearer SEU_TOKEN" https://raw.githubusercontent.com/hotelvivenda/zapzap/claude/awesome-curie-6g5pgw/deploy/install.sh -o install.sh && ZAP_GIT_TOKEN=SEU_TOKEN bash install.sh
```

3. O instalador faz três perguntas:
   - **Seu nome:** é o nome que vai aparecer nas mensagens que você enviar aos clientes.
   - **Endereço do CRM:** digite, por exemplo, `crm.hotelvivenda.com.br`.
   - **Senha:** crie uma senha com pelo menos 8 caracteres e repita. Enquanto você digita, nada aparece na tela. É normal.
4. Espere. Ele instala tudo sozinho e leva alguns minutos. No final mostra "Pronto!".

Se ele avisar que o endereço não aponta para a VPS, o passo 2 ainda não terminou. Espere um pouco e rode o comando de novo.

## Passo 4. Abrir o CRM
1. No navegador, abra `https://crm.hotelvivenda.com.br` (o seu endereço).
2. O cadeado pode levar 1 ou 2 minutos para aparecer na primeira vez.
3. Entre com o usuário **admin** e a senha que você criou.

Neste ponto o CRM funciona em **modo de teste**: você cadastra clientes, usa o funil e responde, mas nada é enviado ao WhatsApp. A ligação com o WhatsApp de verdade é feita depois, em um guia à parte.

## Vários atendentes
Cada pessoa da equipe entra com o próprio usuário e senha, e o **nome dela aparece em cada mensagem que enviar**.

1. Entre como `admin` e abra a aba **Equipe**.
2. Em **Novo atendente**, preencha o nome (o que aparece nas mensagens), o usuário para entrar (por exemplo `carla`) e uma senha inicial. Depois passe esses dados para a pessoa. Ela pode trocar a senha na própria aba **Equipe**.
3. Escolha o tipo de acesso:
   - **Atendente:** conversa com os clientes, usa o funil e mexe nos cartões. Não vê a lista da equipe e não muda as etapas do funil.
   - **Administrador:** tudo isso, mais gerenciar a equipe e editar as etapas do funil.
4. Quando alguém sair da equipe, clique em **Desativar**. O acesso some na hora, e as mensagens que a pessoa enviou continuam com o nome dela.

## Follow-up e respostas prontas
- **Próximo contato:** abra a conversa de um cliente e, no painel da direita, diga em quanto tempo falar de novo com ele, usando os botões **Em 24h**, **Em 48h**, **Em 72h** ou **Em 1 semana** (ou escolha uma data). Quem decide o prazo é a atendente: o sistema não sugere nem decide nada sozinho. Quando o dia chega, o cartão no funil e a faixa amarela do topo avisam. Ao enviar uma mensagem para esse cliente, o follow-up vencido é dado como concluído.
- **Respostas prontas:** na conversa, clique em **Respostas** ou digite `/` para escolher um texto pronto. Ele entra no campo de mensagem e você pode editar antes de enviar. Quem edita os textos é o administrador, na aba **Respostas**. Use `{nome}` onde entra o primeiro nome do cliente e `{atendente}` onde entra o primeiro nome de quem atende.

## Nome do atendente na conversa
- No topo de cada conversa aparece **"Atendido por"** e o nome de quem respondeu por último ao hóspede.
- Quando o WhatsApp de verdade estiver ligado, cada mensagem enviada começa com o nome de quem a escreveu, em negrito. Por exemplo: **Carla Reis · Hotel Vivenda**, e na linha de baixo o texto. Assim o hóspede sabe com quem está falando.
- Acima do campo de mensagem você vê exatamente como o seu nome vai aparecer para o hóspede.
- O administrador liga ou desliga isso, e define o nome do hotel que vem depois do nome do atendente, na aba **Equipe**, em **Mensagens enviadas ao hóspede**. Vem ligado por padrão.
- No CRM, a mensagem fica guardada só com o texto, sem a assinatura, e o nome aparece acima dela.

## Clientes que já fecharam
- Todas as conversas são abertas a **todos os atendentes**: não existe conversa de uma pessoa só. Quem estiver logado pode responder qualquer cliente, e o nome aparece na mensagem.
- Fechado e Perdido são **etapas finais**: não têm follow-up nem aviso de parado.
- Se um cliente de etapa final **voltar a escrever** (por exemplo, meses depois da estadia), o cartão reaparece sozinho na primeira etapa, como uma consulta nova. O valor antigo sai do cartão (para não contar duas vezes) e fica registrado nas anotações com a data. A partir daí o follow-up volta a funcionar.
- Para mudar quais etapas são finais: **Funil > Editar etapas > Etapa final** (a primeira etapa não pode ser final).

## Cópia de segurança
- Todo dia às 3h30 o sistema guarda uma cópia dos dados em `/var/backups/zapzap` e mantém as últimas 14.
- Essa cópia fica **na mesma VPS**. Se a VPS for perdida, a cópia vai junto. Por isso, ative também os **backups automáticos da Hostinger** para a VPS (procure "Backups" ou "Snapshots" no painel).

## Comandos úteis (no Terminal do navegador)
| Para quê | Comando |
| --- | --- |
| Atualizar o CRM | `zapzap-update` (faz uma cópia de segurança, baixa a versão nova e reinstala; a senha, os atendentes e as conversas são mantidos) |
| Recuperar o acesso (esqueci a senha) | `zapzap-password` |
| Ver se está funcionando | `systemctl status zapzap` |
| Ver mensagens de erro | `journalctl -u zapzap -n 50 --no-pager` |

## Se algo der errado
- **A página não abre ou não tem cadeado:** o endereço (passo 2) ainda não valeu. Espere e tente de novo.
- **O instalador parou com um erro:** copie a mensagem de erro e me mande.
- **Esqueci a senha:** abra o Terminal do navegador, rode `zapzap-password`, informe o usuário (Enter para `admin`) e crie uma nova senha. Um administrador também pode redefinir a senha de qualquer atendente na aba **Equipe**.

## Como atualizar
O CRM **nunca se atualiza sozinho**: você decide quando. Quando houver uma versão nova (uma funcionalidade nova, por exemplo), você fica sabendo por quem cuida do código, e a atualização é aplicada assim:

1. Abra o **Terminal do navegador** da VPS na Hostinger.
2. Digite `zapzap-update` e aperte Enter.
3. Ele faz uma cópia de segurança dos dados, baixa a versão nova e reinstala. Leva poucos minutos, e o CRM fica fora do ar só alguns segundos.
4. No navegador, atualize a página com Ctrl+F5.

Se o repositório do GitHub for privado, ele pede o token de leitura na hora. Se não conseguir baixar, ele cancela sem alterar nada.
