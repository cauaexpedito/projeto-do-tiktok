# Ritmo

## Conectar ao TikTok

A conexão usa o OAuth oficial do TikTok. O app mantém o `client_secret` no servidor e grava os tokens do usuário criptografados em `.data/`.

1. Crie um app em [TikTok for Developers](https://developers.tiktok.com/).
2. Adicione o **Login Kit** e, para permitir publicação posteriormente, o **Content Posting API**. Solicite/aprove os escopos `user.info.basic` e `video.publish`.
3. Configure uma URL de callback HTTPS exatamente como:
   `https://SEU-DOMINIO/auth/tiktok/callback`
   A URL pública do app e a callback devem usar o mesmo domínio HTTPS. Cadastre a callback nas configurações de Login Kit do app.
4. Copie `.env.example` para `.env` e preencha `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` e `TIKTOK_REDIRECT_URI` com os valores do app.
5. Gere uma chave local para criptografar os tokens:
   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```
   Coloque o resultado em `TIKTOK_TOKEN_ENCRYPTION_KEY` no `.env`. Não compartilhe essa chave nem o `client_secret`.
6. Rode `node server.js` e abra `http://127.0.0.1:8765`.

O fluxo OAuth exige que o app esteja acessível pelo domínio HTTPS cadastrado; o endereço local sozinho não conclui o login do TikTok. Em produção, use um host HTTPS e um proxy reverso para encaminhar o tráfego ao servidor Ritmo.

O fluxo conecta/autoriza a conta e renova tokens no servidor. A publicação de vídeos pela API ainda depende da aprovação do app pelo TikTok e da implementação do envio do conteúdo.

## Publicar no Render

1. Envie o projeto para um repositório privado, sem incluir `.env`, `.data/` ou `node_modules/`.
2. No Render, crie um **Blueprint** a partir desse repositório. O arquivo `render.yaml` define o serviço Node e solicita as credenciais como variáveis privadas.
3. Após o serviço ser criado, copie sua URL HTTPS e defina `TIKTOK_REDIRECT_URI` como `https://SUA-URL/auth/tiktok/callback`.
4. Cadastre essa mesma callback no app do TikTok for Developers e preencha as credenciais do TikTok e a chave de criptografia nos Environment Variables do Render.
5. Se usar domínio próprio, adicione-o ao serviço no Render e siga os registros DNS indicados pelo painel. A InfinityFree não executa o servidor Node.

Não publique segredos no repositório. Mesmo com a conexão OAuth configurada, a publicação de vídeos ainda não está implementada.
