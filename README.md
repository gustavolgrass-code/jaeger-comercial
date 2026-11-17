# Jaeger's Comercial

Sistema comercial da Jaeger's Doces: mapa de PDVs, funil com esteira de avaliação, abertura de cliente, rota e reposição com contagem por sabor.

## Estrutura

```
app/                 o site (HTML, CSS e JavaScript, sem etapa de build)
  index.html
  styles.css
  app.js             telas e regras do app
  db.js              leitura e gravação no Supabase
  config.js          endereço do Supabase e chave pública
supabase/
  001_estrutura.sql  tabelas, visões e segurança
  002_dados_iniciais.sql  produtos, expositores, regiões e regras
```

## Publicar na Vercel

1. Em vercel.com, **Add New → Project** e escolha este repositório.
2. Em **Root Directory**, selecione `app`.
3. Framework Preset: **Other**. Não precisa de comando de build.
4. **Deploy**.

## Primeiro acesso

1. No Supabase, crie os usuários em **Authentication → Users** (marque *Auto Confirm User*).
2. Entre no site com o e-mail e a senha. No primeiro acesso, o app pede o nome e a área (comercial ou operação).

## Segurança

- `config.js` tem só a chave **publishable**, que é pública por natureza.
- A chave **secret / service_role** nunca entra no código.
