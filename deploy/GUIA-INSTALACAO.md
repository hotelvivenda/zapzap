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

3. O instalador faz duas perguntas:
   - **Endereço do CRM:** digite, por exemplo, `crm.hotelvivenda.com.br`.
   - **Senha de acesso:** crie uma senha com pelo menos 8 caracteres e repita. Enquanto você digita, nada aparece na tela. É normal.
4. Espere. Ele instala tudo sozinho e leva alguns minutos. No final mostra "Pronto!".

Se ele avisar que o endereço não aponta para a VPS, o passo 2 ainda não terminou. Espere um pouco e rode o comando de novo.

## Passo 4. Abrir o CRM
1. No navegador, abra `https://crm.hotelvivenda.com.br` (o seu endereço).
2. O cadeado pode levar 1 ou 2 minutos para aparecer na primeira vez.
3. Entre com a senha que você criou.

Neste ponto o CRM funciona em **modo de teste**: você cadastra clientes, usa o funil e responde, mas nada é enviado ao WhatsApp. A ligação com o WhatsApp de verdade é feita depois, em um guia à parte.

## Cópia de segurança
- Todo dia às 3h30 o sistema guarda uma cópia dos dados em `/var/backups/zapzap` e mantém as últimas 14.
- Essa cópia fica **na mesma VPS**. Se a VPS for perdida, a cópia vai junto. Por isso, ative também os **backups automáticos da Hostinger** para a VPS (procure "Backups" ou "Snapshots" no painel).

## Comandos úteis (no Terminal do navegador)
| Para quê | Comando |
| --- | --- |
| Atualizar o CRM | rodar de novo o comando do passo 3 (a senha e os dados são mantidos) |
| Trocar a senha | `zapzap-password` |
| Ver se está funcionando | `systemctl status zapzap` |
| Ver mensagens de erro | `journalctl -u zapzap -n 50 --no-pager` |

## Se algo der errado
- **A página não abre ou não tem cadeado:** o endereço (passo 2) ainda não valeu. Espere e tente de novo.
- **O instalador parou com um erro:** copie a mensagem de erro e me mande.
- **Esqueci a senha:** no terminal, rode `zapzap-password` e crie uma nova.
